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
  ExecutionPlan,
} from "../types/index.js";
import { parseAndValidate } from "../orchestrator/decision-validator.js";
import { triggerSlowModelBackground, type SlowModelCommand } from "./orchestrator.js";
import { taskPlanner } from "./task-planner.js";

// ── Manager Prompt ────────────────────────────────────────────────────────────

function buildManagerSystemPrompt(lang: "zh" | "en"): string {
  // 中文版 prompt
  const zhPrompt = `你是 SmartRouter Pro 的 Manager（管理模型）。

理解用户请求后，决定最优处理路径，严格按以下 JSON Schema 输出。

【四种决策类型 — 必须严格使用以下 JSON 格式】

1. direct_answer（直接回答）
{
  "schema_version": "manager_decision_v1",
  "decision_type": "direct_answer",
  "direct_response": { "content": "你的回复内容" },
  "reason": "为什么直接回答",
  "confidence": 1.0
}

2. ask_clarification（请求澄清）
{
  "schema_version": "manager_decision_v1",
  "decision_type": "ask_clarification",
  "clarification": { "question_text": "你的问题", "options": [{ "label": "选项A" }] },
  "reason": "为什么需要澄清",
  "confidence": 1.0
}

3. delegate_to_slow（委托慢模型）
{
  "schema_version": "manager_decision_v1",
  "decision_type": "delegate_to_slow",
  "command": { "task_brief": "压缩后的任务摘要", "constraints": ["约束1"] },
  "reason": "为什么委托慢模型",
  "confidence": 1.0
}

4. execute_task（执行任务）
{
  "schema_version": "manager_decision_v1",
  "decision_type": "execute_task",
  "command": { "goal": "任务目标描述" },
  "reason": "为什么需要执行任务",
  "confidence": 1.0
}

【决策原则】
- direct_answer: 闲聊/打招呼/情绪表达/简单问答，不需要外部数据
- ask_clarification: 请求模糊、缺少关键信息（目标/范围/格式不明确）
- delegate_to_slow: 深度分析/多步推理/复杂推理/知识截止日期外的内容
- execute_task: 需要工具调用/代码执行/搜索/多步操作
- 能直接答就不委托，委托时 task_brief 压缩到最小必要信息

【输出规则】
- 只输出 JSON 对象，不输出其他文字
- JSON 用代码块包裹：\`\`\`json ... \`\`\`
- 必须包含 schema_version / decision_type / reason / confidence`;

  // 英文版 prompt
  const enPrompt = `You are SmartRouter Pro's Manager model.

Understand the user's request, decide the optimal next step, and output strictly following the JSON Schema below.

【Four Decision Types — EXACT JSON format required】

1. direct_answer
{
  "schema_version": "manager_decision_v1",
  "decision_type": "direct_answer",
  "direct_response": { "content": "Your reply content" },
  "reason": "Why direct answer",
  "confidence": 1.0
}

2. ask_clarification
{
  "schema_version": "manager_decision_v1",
  "decision_type": "ask_clarification",
  "clarification": { "question_text": "Your question here", "options": [{ "label": "Option A" }] },
  "reason": "Why clarification is needed",
  "confidence": 1.0
}

3. delegate_to_slow
{
  "schema_version": "manager_decision_v1",
  "decision_type": "delegate_to_slow",
  "command": { "task_brief": "Compressed task summary", "constraints": ["constraint1"] },
  "reason": "Why delegate to slow model",
  "confidence": 1.0
}

4. execute_task
{
  "schema_version": "manager_decision_v1",
  "decision_type": "execute_task",
  "command": { "goal": "Task goal description" },
  "reason": "Why execute task",
  "confidence": 1.0
}

【Decision Rules】
- direct_answer: chat/greeting/emotional/simple Q&A, no external data needed
- ask_clarification: ambiguous request, missing key info (goal/scope/format unclear)
- delegate_to_slow: deep analysis/multi-step reasoning/complex reasoning/knowledge cutoff exceeded
- execute_task: requires tool calling/code execution/search/multi-step operations
- Prefer direct_answer when possible; compress task_brief to minimum when delegating

【Output Rules】
- Output JSON ONLY, no other text
- Wrap JSON in code block: \`\`\`json ... \`\`\`
- Must include: schema_version / decision_type / reason / confidence`;

  return lang === "zh" ? zhPrompt : enPrompt;
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
  /** execute_task 的执行计划（Phase 2 新增） */
  execution_plan?: ExecutionPlan;
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

      // Phase 3.0: 写入 TaskArchive
      try {
        const { TaskArchiveRepo } = await import("../db/task-archive-repo.js");
        await TaskArchiveRepo.create({
          task_id: taskId,
          user_id,
          session_id,
          decision,
          user_input: message,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] TaskArchive create failed:", e.message);
      }

      // Phase 3.0: 写入 task_commands
      try {
        const { TaskCommandRepo } = await import("../db/task-archive-repo.js");
        if (command) {
          await TaskCommandRepo.create({
            task_id: taskId,
            archive_id: taskId,
            user_id,
            command_type: command.command_type,
            worker_hint: command.worker_hint,
            priority: command.priority ?? "normal",
            payload: command,
          });
        }
      } catch (e: any) {
        console.warn("[llm-native-router] TaskCommand create failed:", e.message);
      }

      // 触发慢模型后台执行
      const taskBrief: SlowModelCommand = command
        ? {
            action: (command.task_type ?? "analysis") as SlowModelCommand["action"],
            task: command.task_brief,
            constraints: command.constraints ?? [],
            query_keys: [],
            relevant_facts: [],
            user_preference_summary: "",
            priority: command.priority ?? "normal",
            max_execution_time_ms: (command.timeout_sec ?? 60) * 1000,
          }
        : {
            action: "analysis",
            task: message,
            constraints: [],
            query_keys: [],
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
      const command = decision.command as CommandPayload | undefined;
      const taskId = uuid();

      // Step 1: 调用 TaskPlanner 生成执行计划
      let executionPlan: ExecutionPlan | undefined;
      try {
        executionPlan = await taskPlanner.plan({
          taskId,
          goal: command?.goal ?? message,
          userId: user_id,
          sessionId: session_id,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] TaskPlanner.plan failed:", e.message);
      }

      // Step 2: 写入 TaskArchive（state: executing）
      try {
        const { TaskArchiveRepo } = await import("../db/task-archive-repo.js");
        await TaskArchiveRepo.create({
          task_id: taskId,
          user_id,
          session_id,
          decision,
          user_input: message,
          task_brief: command?.task_brief,
          goal: command?.goal,
        });
        if (executionPlan) {
          await TaskArchiveRepo.updateState(taskId, "executing");
        }
      } catch (e: any) {
        console.warn("[llm-native-router] TaskArchive create failed:", e.message);
      }

      // Step 3: 写入 task_commands
      try {
        const { TaskCommandRepo } = await import("../db/task-archive-repo.js");
        if (command) {
          await TaskCommandRepo.create({
            task_id: taskId,
            archive_id: taskId,
            user_id,
            command_type: command.command_type,
            worker_hint: command.worker_hint,
            priority: command.priority ?? "normal",
            payload: command,
            timeout_sec: command.timeout_sec,
          });
        }
      } catch (e: any) {
        console.warn("[llm-native-router] TaskCommand create failed:", e.message);
      }

      const planStepCount = executionPlan?.steps.length ?? 0;
      const fastReply = language === "zh"
        ? planStepCount > 0
          ? `好的，已为你规划了 ${planStepCount} 个步骤，正在执行中...`
          : "好的，正在处理这个任务。"
        : planStepCount > 0
          ? `Got it. I've planned ${planStepCount} step(s) and am executing them...`
          : "Got it. Processing this task.";

      return {
        message: fastReply,
        decision,
        delegation: { task_id: taskId, status: "triggered" },
        routing_layer: "L3",
        decision_type: "execute_task",
        execution_plan: executionPlan,
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
