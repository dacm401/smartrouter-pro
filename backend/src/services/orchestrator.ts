/**
 * Orchestrator v0.4 — LLM-Native 路由架构
 *
 * 核心变化（v0.3 → v0.4）：
 * - 删除了 shouldDelegate() 硬编码判断规则
 * - Fast 模型自判断：直接回复 / 调用 web_search / 请求升级慢模型
 * - Fast → Slow = 结构化 JSON command，不再传上下文
 * - Archive 为唯一事实源（Phase 1 引入后生效）
 *
 * 决策流程（Fast 模型自判断）：
 * 1. 用户是否闲聊/打招呼？ → 直接回复，1-2句话
 * 2. 是否需要实时数据？ → 调用 web_search → 返回结果
 * 3. 是否需要慢模型？ → 输出【SLOW_MODEL_REQUEST】JSON command
 * 4. 以上都不是 → 直接回复
 */

import { v4 as uuid } from "uuid";
import type { ChatMessage } from "../types/index.js";
import { callModelFull } from "../models/model-gateway.js";
import { callOpenAIWithOptions } from "../models/providers/openai.js";
import type { ModelResponse } from "../models/providers/base-provider.js";
import { TaskRepo, MemoryEntryRepo, DelegationArchiveRepo, TaskArchiveRepo } from "../db/repositories.js";
import { config } from "../config.js";
import { runRetrievalPipeline, buildCategoryAwareMemoryText } from "./memory-retrieval.js";
import { FAST_MODEL_TOOLS } from "./fast-model-tools.js";
import { toolExecutor } from "../tools/executor.js";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  message: string;
  language: "zh" | "en";
  user_id: string;
  session_id: string;
  history?: ChatMessage[];
  reqApiKey?: string;
  hasPendingTask?: boolean;       // O-007: 是否有 pending 慢任务（安抚用）
  pendingTaskMessage?: string;     // O-007: pending 任务原始消息
}

export interface OrchestratorResult {
  fast_reply: string;
  delegation?: {
    task_id: string;
    status: "triggered";
  };
  routing_info: {
    delegated: boolean;
    tool_used?: string;            // 如 "web_search"
    is_reassuring?: boolean;       // O-007: 是否是安抚回复
  };
}

/** Slow 模型升级命令（从 Fast 模型输出中解析） */
export interface SlowModelCommand {
  action: "research" | "analysis" | "code" | "creative";
  task: string;
  constraints: string[];
  query_keys: string[];
}

// ── O-007 安抚 prompt ─────────────────────────────────────────────────────────

function buildReassuringFastPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是 SmartRouter Pro 的快模型助手。职责：快速回复用户，口语化，自然，1-2句话足够。
当检测到用户询问之前委托任务的进度时（如"出来了吗"、"好了吗"、"还在处理吗"等），
请用人格化的方式安抚用户，告知正在处理中，不要暴露"委托"或"慢模型"等技术细节。
示例回复：
- "还在分析中哦，请稍候～"
- "老板，稍等一下，马上就好啦～"
- "正在为您处理，马上呈现结果～"`;
  }
  return `You are SmartRouter Pro's fast model assistant.
When user asks about task progress (e.g., "done?", "is it ready?", "still processing?"),
reply in a friendly, reassuring way without mentioning technical details like "delegation" or "slow model".`;
}

// ── Fast 模型系统 prompt（LLM-Native 路由版）─────────────────────────────────

function buildFastModelSystemPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是 SmartRouter Pro 的快模型助手。

【决策规则】
收到用户请求后，依次判断：

1. 用户是否只是闲聊/打招呼/情绪表达？
   → 直接回复，1-2句话，有温度

2. 问题是否需要实时数据（天气/新闻/股价/比分/任何你不确定的事）？
   → 调用 web_search 工具获取数据，再回答

3. 问题是否超出你的知识截止日期，或需要多步复杂推理？
   → 用【SLOW_MODEL_REQUEST】格式输出（见下方），我们会把请求升级到更强模型处理

4. 以上都不是？
   → 用你的内建知识直接回答，简短，自然

【web_search 使用时机】
- 天气查询
- 实时股价、指数、基金净值
- 最新新闻、公告
- 比分、赛果
- 任何你不确定、需要确认的实时信息
- 你的知识截止日期之后发生的事

【慢模型请求格式】
当需要升级慢模型时，先用 1-2 句自然语言告知用户（如"让我想想"、"这个问题有点深"），
然后输出结构化 JSON（放在一行内，不要包裹代码块）：

【SLOW_MODEL_REQUEST】
{"action": "research | analysis | code | creative", "task": "一句话任务描述", "constraints": ["约束1", "约束2"], "query_keys": ["关键词1", "关键词2"]}
【/SLOW_MODEL_REQUEST】

然后停止输出，等待处理。`;
  }
  return `You are SmartRouter Pro's fast model assistant.

【Decision Rules】
After receiving the user's request, judge in order:

1. Is the user just chatting/greeting/emotional expression?
   → Reply directly, 1-2 sentences, with warmth

2. Does the question need real-time data (weather/news/stocks/scores/anything you're unsure about)?
   → Call web_search tool to get data, then answer

3. Does the question exceed your knowledge cutoff, or require multi-step complex reasoning?
   → Output in 【SLOW_MODEL_REQUEST】 format (see below), we will escalate to a stronger model

4. None of the above?
   → Answer directly with your built-in knowledge, concise and natural.

【web_search When to Use】
- Weather queries
- Real-time stock prices, indices, fund NAVs
- Latest news, announcements
- Scores, match results
- Anything you're unsure about or beyond your knowledge cutoff

【Slow Model Request Format】
When needing to escalate, first say 1-2 natural sentences to the user (e.g. "Let me think about this"), then output a single-line JSON (no code block):

【SLOW_MODEL_REQUEST】
{"action": "research | analysis | code | creative", "task": "one-line task description", "constraints": ["constraint1", "constraint2"], "query_keys": ["keyword1", "keyword2"]}
【/SLOW_MODEL_REQUEST】

Then stop outputting and wait for processing.`;
}

// ── Slow 模型升级命令解析 ─────────────────────────────────────────────────────

/**
 * 从 Fast 模型输出中解析【SLOW_MODEL_REQUEST】命令
 */
function parseSlowModelCommand(text: string): SlowModelCommand | null {
  let jsonStr: string | null = null;

  // 格式 1：代码块内的 JSON
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) { jsonStr = codeBlockMatch[1].trim(); }

  // 格式 2：单独一行的 JSON
  if (!jsonStr) {
    const jsonLineMatch = text.match(/(\{[^{}]*"action"[\s\S]*?\})/);
    if (jsonLineMatch) { jsonStr = jsonLineMatch[1]; }
  }

  // 格式 3：包含在【SLOW_MODEL_REQUEST】标记中
  if (!jsonStr) {
    const tagMatch = text.match(/【SLOW_MODEL_REQUEST】\s*(\{[\s\S]*?\})\s*【\/SLOW_MODEL_REQUEST】/);
    if (tagMatch) { jsonStr = tagMatch[1]; }
  }

  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.action || !parsed.task) return null;
    return {
      action: parsed.action,
      task: parsed.task,
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
      query_keys: Array.isArray(parsed.query_keys) ? parsed.query_keys : [],
    };
  } catch {
    return null;
  }
}

// ── Fast 模型工具调用循环 ────────────────────────────────────────────────────

async function callFastModelWithTools(
  messages: ChatMessage[],
  reqApiKey?: string,
  lang: "zh" | "en"
): Promise<{ reply: string; toolUsed?: string; command?: SlowModelCommand }> {
  const MAX_TOOL_ROUNDS = 5;
  let currentMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: ModelResponse;

    if (reqApiKey) {
      // 使用 callOpenAIWithOptions（已支持 tools）
      response = await callOpenAIWithOptions(
        config.fastModel, currentMessages, reqApiKey, config.openaiBaseUrl || undefined, FAST_MODEL_TOOLS
      );
    } else {
      // 无 reqApiKey 时，使用 callModelFull（已支持 tools 参数）
      response = await callModelFull(config.fastModel, currentMessages, FAST_MODEL_TOOLS);
    }

    const { content, tool_calls } = response;

    // 情况 1：有 tool_calls → 执行 → 注入结果 → 继续
    if (tool_calls && tool_calls.length > 0) {
      const toolResults: ChatMessage[] = [];

      for (const tc of tool_calls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }

        const result = await toolExecutor.execute(
          { id: tc.id, tool_name: toolName, arguments: args },
          { userId: "fast-model", sessionId: "fast-session" }
        );

        const resultContent = result.success
          ? JSON.stringify(result.result)
          : `工具执行失败: ${result.error}`;

        toolResults.push({
          role: "tool" as const,
          content: resultContent,
          tool_call_id: tc.id,
        });
      }

      currentMessages.push({ role: "assistant", content });
      currentMessages.push(...toolResults);
      continue;
    }

    // 情况 2：无 tool_calls → 检查慢模型升级请求
    if (content) {
      const command = parseSlowModelCommand(content);
      if (command) {
        const prefix = content
          .replace(/【SLOW_MODEL_REQUEST】[\s\S]*?【\/SLOW_MODEL_REQUEST】/, "")
          .trim();
        return {
          reply: prefix || (lang === "zh" ? "让我想想..." : "Let me think..."),
          command,
        };
      }
      // 情况 3：普通回复
      return { reply: content };
    }

    return { reply: "" };
  }

  // 超过最大轮次
  return { reply: currentMessages[currentMessages.length - 1]?.content || "" };
}

// ── Orchestrator 主函数 ───────────────────────────────────────────────────────

export async function orchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const {
    message, language,
    user_id, session_id, history = [], reqApiKey,
    hasPendingTask = false, pendingTaskMessage
  } = input;

  // Step 0: O-007 安抚
  if (hasPendingTask) {
    const reassuringPrompt = buildReassuringFastPrompt(language);
    const historyContext = history.filter((m) => m.role !== "system").slice(-6);
    const pendingContext = pendingTaskMessage ? `\n\n【当前正在处理的任务】${pendingTaskMessage}` : "";

    const messages: ChatMessage[] = [
      { role: "system", content: reassuringPrompt },
      ...historyContext,
      { role: "user", content: `用户问题是："${message}"${pendingContext}` },
    ];

    let fastReply: string;
    try {
      if (reqApiKey) {
        const resp = await callOpenAIWithOptions(config.fastModel, messages, reqApiKey, config.openaiBaseUrl || undefined);
        fastReply = resp.content;
      } else {
        const resp = await callModelFull(config.fastModel, messages);
        fastReply = resp.content;
      }
    } catch (e: any) {
      console.error("[orchestrator] Reassuring call failed:", e.message);
      fastReply = language === "zh" ? "正在为您处理中，请稍候～" : "Still processing, please wait...";
    }

    return { fast_reply: fastReply, routing_info: { delegated: false, is_reassuring: true } };
  }

  // Step 1: 读取用户记忆（Fast 模型内建知识补充）
  const memories = config.memory.enabled
    ? await MemoryEntryRepo.getTopForUser(user_id, config.memory.maxEntriesToInject)
    : [];

  let memoryText = "";
  if (memories.length > 0) {
    const retrievalResults = memories.map((m) => ({ entry: m, score: m.importance, reason: "v1" }));
    if (config.memory.retrieval.strategy === "v2") {
      const candidates = await MemoryEntryRepo.getTopForUser(user_id, Math.ceil(config.memory.maxEntriesToInject * 1.5));
      const scored = runRetrievalPipeline({
        entries: candidates,
        context: { userMessage: message },
        categoryPolicy: config.memory.retrieval.categoryPolicy,
        maxTotalEntries: config.memory.maxEntriesToInject,
      });
      if (scored.length > 0) memoryText = buildCategoryAwareMemoryText(scored as any).combined;
    }
    if (!memoryText) memoryText = buildCategoryAwareMemoryText(retrievalResults as any).combined;
  }
  void memoryText; // 暂时保留，Slow 模型从 Archive 查上下文，不再传 memoryText

  // Step 2: 构造 Fast 模型消息
  const systemPrompt = buildFastModelSystemPrompt(language);
  const historyMessages = history.filter((m) => m.role !== "system").slice(-10);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: message },
  ];

  // Step 3: 调用 Fast 模型（带工具）
  const { reply, toolUsed, command } = await callFastModelWithTools(messages, reqApiKey, language);

  // Step 4: Fast 请求慢模型升级 → 创建 TaskArchive → 后台执行
  if (command) {
    const taskId = uuid();

    // 写入 TaskArchive（Fast → Slow 的结构化命令）
    try {
      await TaskArchiveRepo.create({
        task_id: taskId,
        session_id,
        command,
        user_input: message,
        constraints: command.constraints,
      });
    } catch (e: any) {
      console.warn("[orchestrator] TaskArchive create failed:", e.message);
      // Archive 写失败不阻止慢模型执行，继续
    }

    // 后台触发慢模型
    triggerSlowModelBackground({
      taskId,
      message,
      command,
      user_id,
      session_id,
      reqApiKey,
    }).catch((e) => console.error("[orchestrator] Slow model trigger failed:", e.message));

    return {
      fast_reply: reply,
      delegation: { task_id: taskId, status: "triggered" },
      routing_info: { delegated: true },
    };
  }

  // Step 5: Fast 直接回复
  return {
    fast_reply: reply,
    routing_info: { delegated: false, tool_used: toolUsed },
  };
}

// ── 后台慢模型触发 ───────────────────────────────────────────────────────────

interface SlowModelBackgroundInput {
  taskId: string;
  message: string;
  command: SlowModelCommand;
  user_id: string;
  session_id: string;
  reqApiKey?: string;
}

async function triggerSlowModelBackground(input: SlowModelBackgroundInput): Promise<void> {
  const { taskId, message, command, user_id, session_id, reqApiKey } = input;
  const startTime = Date.now();

  try {
    // Step 1: 更新 Archive 状态为 running
    await TaskArchiveRepo.updateStatus(taskId, "running");

    // Step 2: 查历史档案获取相关上下文
    const recentArchives = await DelegationArchiveRepo.getRecentByUser(user_id, 3);
    let archiveContext = "";
    if (recentArchives.length > 0) {
      const lines = recentArchives.map(
        (a) => `[历史任务] ${a.original_message}\n[结果摘要] ${a.slow_result?.substring(0, 200) ?? "(无结果)"}`
      );
      archiveContext = `\n【相关历史背景】\n${lines.join("\n\n")}`;
    }

    // Step 3: 从 command 构造慢模型任务卡（结构化，不依赖 Fast 二次调用）
    const taskCard = `【任务类型】${command.action}\n【用户请求】${command.task}\n【输出约束】\n${command.constraints.map((c) => `- ${c}`).join("\n")}\n${archiveContext ? `\n${archiveContext}` : ""}`;

    // Step 4: 慢模型执行（独立对话，无历史累积）
    const slowModel = config.slowModel;
    const slowMessages: ChatMessage[] = [
      { role: "system", content: taskCard },
      { role: "user", content: message },
    ];

    let slowResult: string;
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(slowModel, slowMessages, reqApiKey, config.openaiBaseUrl || undefined);
      slowResult = resp.content;
    } else {
      const resp = await callModelFull(slowModel, slowMessages);
      slowResult = resp.content;
    }

    const totalMs = Date.now() - startTime;

    // Step 5: 写入 Archive 执行结果
    await TaskArchiveRepo.writeExecution({
      id: taskId,
      status: "done",
      result: slowResult,
      started_at: new Date(startTime).toISOString(),
      deviations: [],
    });

    // Step 6: 写入 delegation_archive（兼容旧接口，供 hasPending 查询使用）
    await DelegationArchiveRepo.create({
      task_id: taskId,
      user_id,
      session_id,
      original_message: message,
      delegation_prompt: taskCard,
      slow_result: slowResult,
      processing_ms: totalMs,
    });

    // Step 7: 任务记录
    await TaskRepo.create({
      id: taskId, user_id, session_id,
      title: message.substring(0, 100),
      mode: "llm_native_delegated",
      complexity: "high",
      risk: "low",
      goal: message,
      status: "responding",
    }).catch(() => {});
    await TaskRepo.setStatus(taskId, "completed").catch(() => {});

    // Step 8: 写 trace
    await TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "llm_native_delegated",
      detail: { original_message: message, command, slow_result: slowResult, processing_ms: totalMs, archived: true },
    }).catch(() => {});

  } catch (e: any) {
    console.error(`[orchestrator] Slow model failed for task ${taskId}:`, e.message);
    await TaskArchiveRepo.writeExecution({
      id: taskId,
      status: "failed",
      errors: [e.message],
    }).catch(() => {});
    await DelegationArchiveRepo.fail(taskId, e.message).catch(() => {});
    await TaskRepo.setStatus(taskId, "failed").catch(() => {});
    await TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "llm_native_delegation_failed",
      detail: { error: e.message, failed_at: Date.now() },
    }).catch(() => {});
  }
}

// ── SSE 轮询 loop（含用户体验安抚）───────────────────────────────────────────

export interface SSEEvent {
  type: "status" | "result" | "error";
  stream: string;
}

/**
 * 轮询 TaskArchive，感知状态变化，推送 SSE 事件
 * 嵌入用户体验安抚消息（30s/60s/120s 节点）
 */
export async function* pollArchiveAndYield(
  taskId: string,
  lang: "zh" | "en"
): AsyncGenerator<SSEEvent> {
  // 自适应轮询间隔：任务初期频繁检查，后期降低频率
  // - < 10s：2s（快速感知完成）
  // - 10s ~ 60s：3s（正常等待）
  // - > 60s：5s（减少数据库压力）
  const getPollInterval = (elapsedMs: number): number => {
    if (elapsedMs < 10000) return 2000;
    if (elapsedMs < 60000) return 3000;
    return 5000;
  };

  const MESSAGES = {
    zh: {
      running30s: "🔄 任务比较复杂，正在深度分析...",
      running60s: "⏳ 资料已找到，正在整理对比...",
      running120s: "🔄 仍在执行，请继续等待...",
      done: "慢模型分析完成，结果如下：",
    },
    en: {
      running30s: "🔄 Task is complex, analyzing deeply...",
      running60s: "⏳ Data found, comparing results...",
      running120s: "🔄 Still running, please wait...",
      done: "Slow model analysis complete:",
    },
  };

  const msgs = MESSAGES[lang] ?? MESSAGES.zh;
  const startTime = Date.now();
  let lastStatusTime = startTime;

  while (true) {
    const task = await TaskArchiveRepo.getById(taskId);
    if (!task) break;

    const elapsed = Date.now() - startTime;

    // 安抚消息（用 elapsed < X+1000 而非 >= X，只发一次）
    if (task.status === "running" || task.status === "pending") {
      if (elapsed > 30000 && elapsed < 31000 && lastStatusTime < 30000) {
        yield { type: "status", stream: msgs.running30s };
        lastStatusTime = Date.now();
      } else if (elapsed > 60000 && elapsed < 61000 && lastStatusTime < 60000) {
        yield { type: "status", stream: msgs.running60s };
        lastStatusTime = Date.now();
      } else if (elapsed > 120000 && elapsed < 121000) {
        // 120s 后每 60s 发一次
        const sixtySecondMarker = Math.floor((elapsed - 120000) / 60000);
        if (elapsed < 120000 + 60000 * sixtySecondMarker + 1000 && elapsed >= 120000 + 60000 * sixtySecondMarker) {
          yield { type: "status", stream: msgs.running120s };
          lastStatusTime = Date.now();
        }
      }
    }

    if (task.status === "done") {
      if (!task.delivered) {
        const result = task.slow_execution?.result ?? "";
        yield {
          type: "result",
          stream: `${msgs.done}\n\n${result}`,
        };
        await TaskArchiveRepo.markDelivered(taskId).catch(() => {});
      }
      break;
    }

    if (task.status === "failed") {
      const errors = task.slow_execution?.errors ?? [];
      yield { type: "error", stream: `任务执行失败: ${errors[0] ?? "Unknown error"}` };
      break;
    }

    const interval = getPollInterval(Date.now() - startTime);
    await sleep(interval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 查询委托结果（供轮询接口使用）──────────────────────────────────────────────

export interface DelegationResult {
  task_id: string;
  status: "pending" | "completed" | "failed";
  slow_result?: string;
  fast_reply?: string;
  error?: string;
}

export async function getDelegationResult(taskId: string): Promise<DelegationResult | null> {
  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return null;

    const traces = await TaskRepo.getTraces(taskId);
    const delegatedTrace = traces.find((t) => t.type === "llm_native_delegated");
    const failedTrace = traces.find((t) => t.type === "llm_native_delegation_failed");

    if (failedTrace) {
      return { task_id: taskId, status: "failed", error: (failedTrace.detail as any)?.error || "Unknown error" };
    }
    if (delegatedTrace) {
      const detail = delegatedTrace.detail as any;
      return { task_id: taskId, status: "completed", slow_result: detail?.slow_result };
    }
    return { task_id: taskId, status: "pending" };
  } catch (e: any) {
    console.error("[orchestrator] getDelegationResult failed:", e.message);
    return null;
  }
}
