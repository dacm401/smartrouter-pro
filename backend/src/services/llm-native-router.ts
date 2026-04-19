// Phase 3.0: LLM-Native Router — ManagerDecision 驱动的路由
// backend/src/services/llm-native-router.ts
//
// 职责：
// 1. 调用 Fast 模型生成 ManagerDecision JSON
// 2. 用 parseAndValidate() 校验
// 3. 按 decision_type 路由：direct_answer / ask_clarification / delegate_to_slow / execute_task
//
// Phase 1：轻量接入，不改旧 orchestrator，双轨并行

import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { callModelFull, callOpenAIWithOptions } from "../models/model-gateway.js";
import type { ChatMessage } from "../types/index.js";
import type {
  ManagerDecision,
  ManagerDecisionType,
  RoutingLayer,
  DirectResponse,
  ClarifyQuestion,
  CommandPayload,
} from "../types/index.js";
import { parseAndValidate } from "../orchestrator/decision-validator.js";
import { triggerSlowModelBackground } from "./orchestrator.js";

// ── Manager Prompt ────────────────────────────────────────────────────────────

function buildManagerSystemPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是 SmartRouter Pro 的 Manager（管理模型）。

【你的职责】
理解用户请求后，决定下一步最优处理路径，并严格按以下 JSON Schema 输出。

【决策类型】

1. direct_answer（直接回答）
   - 适用：闲聊/打招呼/情绪表达/简单问答/不需要外部数据的请求
   - 输出：符合用户风格的简短回复草稿

2. ask_clarification（请求澄清）
   - 适用：请求模糊、缺少关键信息（目标/范围/格式/对象不明确）
   - 输出：一个自然语言问题，给出选项（如果有）

3. delegate_to_slow（委托慢模型）
   - 适用：需要深度分析/多步推理/复杂推理/超出知识截止日期的任务
   - 输出：结构化的 task_brief 和 goal，给出约束条件

4. execute_task（执行任务）
   - 适用：需要工具调用/代码执行/搜索/多步操作
   - 输出：执行计划，列出允许的工具

【输出规则】
- 只输出 JSON 对象，不输出其他文字
- JSON 用代码块包裹：\`\`\`json ... \`\`\`
- schema_version 固定为 "manager_decision_v1"
- reason 字段说明你的决策原因（供调试/日志使用）
- confidence 是你对决策的置信度（0.0 ~ 1.0）

【决策原则】
- 能直接答就不委托
- 委托慢模型时，task_brief 要压缩到最小必要信息
- 只有在不确定、需要外部数据、或者需要深度推理时才委托`;
  }
  return `You are SmartRouter Pro's Manager model.

【Your Role】
Understand the user's request, decide the optimal next step, and output strictly in the JSON Schema below.

【Decision Types】

1. direct_answer
   - Use for: chat/greeting/emotional expression/simple Q&A/no external data needed
   - Output: brief reply draft matching user style

2. ask_clarification
   - Use for: ambiguous request, missing key info (goal/scope/format/target unclear)
   - Output: one natural language question, with options if applicable

3. delegate_to_slow
   - Use for: deep analysis/multi-step reasoning/complex reasoning/knowledge cutoff exceeded
   - Output: structured task_brief and goal with constraints

4. execute_task
   - Use for: requires tool calling/code execution/search/multi-step operations
   - Output: execution plan with allowed tools listed

【Output Rules】
- Output JSON object ONLY, no other text
- Wrap JSON in code block: \`\`\`json ... \`\`\`
- schema_version is always "manager_decision_v1"
- reason field: explain your decision (for debug/logging)
- confidence: your confidence in the decision (0.0 ~ 1.0)`;
}

// ── 入参 ─────────────────────────────────────────────────────────────────────

export interface LLMNativeRouterInput {
  message: string;
  user_id: string;
  session_id: string;
  history: ChatMessage[];
  language: "zh" | "en";
  reqApiKey?: string;
}

export interface LLMNativeRouterResult {
  /** 最终返回给用户的文本 */
  message: string;
  /** ManagerDecision（供 SSE 推送） */
  decision: ManagerDecision | null;
  /** 委托信息（有委托时返回 task_id） */
  delegation?: { task_id: string; status: "triggered" };
  /** 澄清问题（有澄清请求时返回） */
  clarifying?: ClarifyQuestion;
  /** 路由层 */
  routing_layer: RoutingLayer;
  /** 决策类型 */
  decision_type: ManagerDecisionType | null;
  /** Manager JSON 原始文本（调试用） */
  raw_manager_output?: string;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

export async function routeWithManagerDecision(
  input: LLMNativeRouterInput
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, history, language, reqApiKey } = input;

  // Step 1: 调用 Fast 模型，传递 Manager Prompt
  const managerOutput = await callManagerModel({ message, history, language, reqApiKey });

  // Step 2: 解析 JSON（Phase 0 使用正则解析）
  const decision = parseAndValidate(managerOutput);

  // Step 3: 不合法 → fallback，返回 L0 direct_answer
  if (!decision) {
    console.warn("[llm-native-router] ManagerDecision parse failed, fallback to direct_answer");
    return {
      message: managerOutput.trim() || (language === "zh" ? "好的，让我看看。" : "Got it, let me check."),
      decision: null,
      routing_layer: "L0",
      decision_type: null,
      raw_manager_output: managerOutput,
    };
  }

  // Step 4: 按 decision_type 路由
  return routeByDecision(decision, { message, user_id, session_id, language, reqApiKey, raw: managerOutput });
}

// ── Fast Manager 调用 ─────────────────────────────────────────────────────────

async function callManagerModel(input: {
  message: string;
  history: ChatMessage[];
  language: "zh" | "en";
  reqApiKey?: string;
}): Promise<string> {
  const { message, history, language, reqApiKey } = input;

  const systemPrompt = buildManagerSystemPrompt(language);
  // 保留最近 6 轮对话作为上下文，不传全量 history（Manager 只读当前任务）
  const recentHistory = history.filter((m) => m.role !== "system").slice(-6);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory,
    { role: "user", content: message },
  ];

  try {
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(
        config.fastModel,
        messages,
        reqApiKey,
        config.openaiBaseUrl || undefined
      );
      return resp.content;
    }
    const resp = await callModelFull(config.fastModel, messages);
    return resp.content;
  } catch (e: any) {
    console.error("[llm-native-router] Manager model call failed:", e.message);
    throw e;
  }
}

// ── 决策路由 ─────────────────────────────────────────────────────────────────

interface RouteContext {
  message: string;
  user_id: string;
  session_id: string;
  language: "zh" | "en";
  reqApiKey?: string;
  raw: string;
}

async function routeByDecision(
  decision: ManagerDecision,
  ctx: RouteContext
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, language, reqApiKey, raw } = ctx;

  switch (decision.decision_type) {
    case "direct_answer": {
      const dr = decision.direct_response as DirectResponse | undefined;
      const reply = dr?.content ?? (language === "zh" ? "好的。" : "Got it.");
      return {
        message: reply,
        decision,
        routing_layer: "L0",
        decision_type: "direct_answer",
        raw_manager_output: raw,
      };
    }

    case "ask_clarification": {
      const cq = decision.clarification as ClarifyQuestion | undefined;
      // 返回一个问题（clarifying 状态由 chat.ts 调用方处理）
      const questionText = cq?.question_text ?? (language === "zh" ? "能再具体一点吗？" : "Could you be more specific?");
      const clarifyingMessage = cq?.options?.length
        ? `${questionText} ${cq.options.map((o) => `"${o.label}"`).join(" / ")}`
        : questionText;
      return {
        message: clarifyingMessage,
        decision,
        routing_layer: "L0",
        decision_type: "ask_clarification",
        clarifying: cq,
        raw_manager_output: raw,
      };
    }

    case "delegate_to_slow": {
      const command = decision.command as CommandPayload | undefined;
      const taskId = uuid();

      // Phase 3.0: 写入 TaskArchive（新 Phase 3 表）
      try {
        const { TaskArchiveRepo } = await import("../db/task-archive-repo.js");
        await TaskArchiveRepo.create({
          task_id: taskId,
          user_id,
          session_id,
          decision,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] TaskArchive create failed:", e.message);
        // Archive 写失败不阻止慢模型执行
      }

      // Phase 3.0: 写入 task_commands（新 Phase 3 表）
      try {
        const { TaskCommandRepo } = await import("../db/task-archive-repo.js");
        if (command) {
          await TaskCommandRepo.create({
            task_id: taskId,
            archive_id: taskId, // Phase 1: archive_id = task_id（简单处理）
            user_id,
            command_type: command.command_type,
            worker_hint: command.worker_hint,
            priority: command.priority ?? "normal",
            status: "queued",
            payload_json: command,
          });
        }
      } catch (e: any) {
        console.warn("[llm-native-router] TaskCommand create failed:", e.message);
      }

      // 触发慢模型后台执行（复用 orchestrator 的 triggerSlowModelBackground）
      // 注意：Phase 1 使用 Phase 1.5 SlowModelCommand 格式，与 Phase 3 CommandPayload 有差异
      // Phase 1 直接传 message，不传 Phase 3 command_payload
      const taskBrief = command
        ? {
            action: (command.task_type ?? "analysis") as any,
            task: command.task_brief,
            constraints: command.constraints ?? [],
            relevant_facts: [],
            user_preference_summary: "",
            priority: command.priority ?? "normal",
            max_execution_time_ms: (command.timeout_sec ?? 60) * 1000,
          }
        : {
            action: "analysis",
            task: message,
            constraints: [],
            relevant_facts: [],
            user_preference_summary: "",
            priority: "normal",
            max_execution_time_ms: 60000,
          };

      triggerSlowModelBackground({
        taskId,
        message,
        command: taskBrief,
        user_id,
        session_id,
        reqApiKey,
      }).catch((e) => console.error("[llm-native-router] Slow trigger failed:", e.message));

      // 快速安抚回复
      const fastReply = language === "zh"
        ? "这个问题比较深，我正在请更专业的模型帮你分析，稍等一下～"
        : "This is complex. I'm getting a more specialized model to analyze it, please wait...";

      return {
        message: fastReply,
        decision,
        delegation: { task_id: taskId, status: "triggered" },
        routing_layer: "L2",
        decision_type: "delegate_to_slow",
        raw_manager_output: raw,
      };
    }

    case "execute_task": {
      // Phase 1: execute_task 暂时回退到旧链路
      // Phase 2+ 才接入 TaskPlanner + ExecutionLoop
      console.warn("[llm-native-router] execute_task not yet implemented in Phase 1, fallback to direct_answer");
      return {
        message: language === "zh"
          ? "好的，我来帮你处理这个任务。"
          : "Got it, I'll help you with this task.",
        decision,
        routing_layer: "L3",
        decision_type: "execute_task",
        raw_manager_output: raw,
      };
    }

    default: {
      console.warn("[llm-native-router] Unknown decision_type:", (decision as any).decision_type);
      return {
        message: language === "zh" ? "好的，让我看看。" : "Got it.",
        decision,
        routing_layer: "L0",
        decision_type: null,
        raw_manager_output: raw,
      };
    }
  }
}
