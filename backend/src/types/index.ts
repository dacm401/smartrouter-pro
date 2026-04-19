// SmartRouter Pro - 核心类型定义

export type IntentType =
  | "simple_qa"
  | "reasoning"
  | "creative"
  | "code"
  | "math"
  | "translation"
  | "summarization"
  | "chat"
  | "research"
  | "general"   // LLM-native routing: Fast model self-judges, no hardcoded intent
  | "unknown";

export type CompressionLevel = "L0" | "L1" | "L2" | "L3";

export type ModelRole = "fast" | "slow" | "compressor";

export type FeedbackType =
  | "accepted"
  | "regenerated"
  | "edited"
  | "thumbs_up"
  | "thumbs_down"
  | "follow_up_doubt"
  | "follow_up_thanks";

export interface InputFeatures {
  raw_query: string;
  token_count: number;
  intent: IntentType;
  complexity_score: number;
  has_code: boolean;
  has_math: boolean;
  requires_reasoning: boolean;
  conversation_depth: number;
  context_token_count: number;
  language: string;
}

export interface RoutingDecision {
  router_version: string;
  scores: { fast: number; slow: number };
  confidence: number;
  selected_model: string;
  selected_role: ModelRole;
  selection_reason: string;
  fallback_model: string;
  /** Phase 2.0: 显式路由分层（L0/L1/L2/L3） */
  routing_layer?: "L0" | "L1" | "L2" | "L3";
}

export interface CompressionDetail {
  turn_index: number;
  role: "user" | "assistant";
  action: "kept" | "summarized" | "structured" | "removed";
  original_tokens: number;
  compressed_tokens: number;
  summary?: string;
}

export interface ContextResult {
  original_tokens: number;
  compressed_tokens: number;
  compression_level: CompressionLevel;
  compression_ratio: number;
  memory_items_retrieved: number;
  final_messages: ChatMessage[];
  compression_details: CompressionDetail[];
}

export interface ExecutionResult {
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  latency_ms: number;
  did_fallback: boolean;
  fallback_reason?: string;
  response_text: string;
  quality_score?: number;
}

export interface DecisionRecord {
  id: string;
  user_id: string;
  session_id: string;
  timestamp: number;
  input_features: InputFeatures;
  routing: RoutingDecision;
  context: ContextResult;
  execution: ExecutionResult;
  feedback?: { type: FeedbackType; score: number; timestamp: number };
  learning_signal?: {
    routing_correct: boolean;
    cost_saved_vs_always_slow: number;
    quality_delta: number;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  metadata?: { tokens?: number; compressed?: boolean; original_content?: string };
  /** Tool calls emitted by the model (assistant messages with Function Calling) */
  tool_calls?: ToolCall[];
  /** ID of the tool call this message is responding to (tool messages only) */
  tool_call_id?: string;
  /** P4: ID of the routing DecisionRecord this message is responding to, used for implicit feedback detection */
  decision_id?: string;
}

export interface ChatRequest {
  user_id: string;
  session_id: string;
  message: string;
  history: ChatMessage[];
  preferences?: { mode: "quality" | "balanced" | "cost"; compression_level?: CompressionLevel };
  /** 前端设置透传：可覆盖后端环境变量 */
  api_key?: string;
  fast_model?: string;
  slow_model?: string;
  /** EL-003: If true, route this request through TaskPlanner + ExecutionLoop (multi-step execution). */
  execute?: boolean;
  /** T1: Explicit task resumption. If provided, system validates ownership and resumes the task. */
  task_id?: string;
  /** S1: If true, return SSE stream instead of a single JSON response. */
  stream?: boolean;
  /** Phase 3.0: If true, use LLM-Native Manager-Worker routing instead of orchestrator. */
  use_llm_native_routing?: boolean;
}

export interface ChatResponse {
  message: string;
  decision: DecisionRecord;
  /** T1: The task_id associated with this response. Present when a task was created or resumed. */
  task_id?: string;
  /**
   * O-001/O-006: Delegation info — present when slow model is triggered in background.
   * The fast model gives an immediate acknowledgment; the slow result comes via polling
   * as a separate message (wrapped by the fast model with its humanized prompt).
   */
  delegation?: {
    task_id: string;
    status: "triggered";
  };
  /** Phase 3.0: Clarifying info — present when Manager requests user clarification. */
  clarifying?: ClarifyQuestion;
}

export interface IdentityMemory {
  user_id: string;
  response_style: "concise" | "detailed" | "balanced";
  expertise_level: "beginner" | "intermediate" | "expert";
  domains: string[];
  quality_sensitivity: number;
  cost_sensitivity: number;
  preferred_fast_model: string;
  preferred_slow_model: string;
  updated_at: number;
}

export interface BehavioralMemory {
  id: string;
  user_id: string;
  trigger_pattern: string;
  observation: string;
  learned_action: string;
  strength: number;
  reinforcement_count: number;
  last_activated: number;
  source_decision_ids: string[];
  created_at: number;
}

export interface GrowthProfile {
  user_id: string;
  level: number;
  level_name: string;
  level_progress: number;
  /** @deprecated Use satisfaction_rate. This field previously reflected fake routing_correct data. */
  routing_accuracy: number;
  /**
   * Daily satisfaction rate history (positive feedback / all feedback).
   * Renamed from routing_accuracy_history which was based on routing_correct = always-null.
   */
  satisfaction_history: { date: string; value: number }[];
  cost_saving_rate: number;
  total_saved_usd: number;
  satisfaction_rate: number;
  total_interactions: number;
  behavioral_memories_count: number;
  milestones: { date: string; event: string }[];
  recent_learnings: { date: string; learning: string }[];
}

export interface DashboardData {
  today: {
    total_requests: number;
    fast_count: number;
    slow_count: number;
    fallback_count: number;
    total_tokens: number;
    total_cost: number;
    saved_cost: number;
    saving_rate: number;
    avg_latency_ms: number;
    /**
     * Proxy metric for routing quality: satisfaction rate (positive feedback / all feedback).
     * Renamed from routing_accuracy which was a pseudo-metric backed by always-null routing_correct.
     */
    satisfaction_proxy: number;
  };
  token_flow: { fast_tokens: number; slow_tokens: number; compressed_tokens: number; fallback_tokens: number };
  recent_decisions: DecisionRecord[];
  growth: GrowthProfile;
}

export interface ModelPricing {
  model: string;
  input_per_1k: number;
  output_per_1k: number;
}

// ── Task entities ───────────────────────────────────────────────────────────

export type TaskMode = "direct" | "research" | "execute";
export type TaskStatus = "pending" | "running" | "waiting_subagent" | "completed" | "failed" | "blocked";
export type ComplexityLevel = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high";

export interface Task {
  task_id: string;
  user_id: string;
  session_id: string;
  title: string;
  mode: TaskMode;
  status: TaskStatus;
  complexity: ComplexityLevel;
  risk: RiskLevel;
  goal: string | null;
  budget_profile: Record<string, any>;
  tokens_used: number;
  tool_calls_used: number;
  steps_used: number;
  summary_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskListItem {
  task_id: string;
  title: string;
  mode: TaskMode;
  status: TaskStatus;
  complexity: ComplexityLevel;
  risk: RiskLevel;
  updated_at: string;
  session_id: string;
}

export interface TaskDetail extends Task {}

export interface TaskSummary {
  task_id: string;
  summary_id: string;
  goal: string | null;
  confirmed_facts: string[];
  completed_steps: string[];
  blocked_by: string[];
  next_step: string | null;
  summary_text: string | null;
  version: number;
  updated_at: string;
}

export type TraceType =
  | "classification"
  | "routing"
  | "response"
  | "planning"
  | "guardrail"
  | "step_start"
  | "step_complete"
  | "step_failed"
  | "loop_start"
  | "loop_end"
  | "error"
  // O-001: Orchestrator trace types
  | "orchestrator_delegated"
  | "orchestrator_delegation_failed";

export interface TaskTrace {
  trace_id: string;
  task_id: string;
  type: TraceType;
  detail: Record<string, any> | null;
  created_at: string;
}

export interface GetTracesOptions {
  /** Filter by trace type */
  type?: TraceType;
  /** Maximum number of traces to return (default: 100) */
  limit?: number;
}

/** Human-readable summary of a trace */
export interface TraceSummary {
  trace_id: string;
  type: TraceType;
  summary: string;
  created_at: string;
}

// ── Memory entries (MC-001) ──────────────────────────────────────────────────

export type MemoryCategory = "preference" | "fact" | "context" | "instruction" | "skill" | "behavioral";
export type MemorySource = "manual" | "extracted" | "feedback" | "auto_learn";

export interface MemoryEntry {
  id: string;
  user_id: string;
  category: MemoryCategory;
  content: string;
  importance: number;   // 1–5
  tags: string[];
  source: MemorySource;
  relevance_score: number; // 0.0–1.0, defaults to 0.5
  created_at: string;   // ISO 8601 string (outward API)
  updated_at: string;
}

export interface MemoryEntryInput {
  user_id: string;
  category: MemoryCategory;
  content: string;
  importance?: number;   // defaults to 3
  tags?: string[];
  source?: MemorySource;
  relevance_score?: number; // defaults based on source (manual=0.5, auto_learn=0.3)
}

export interface MemoryEntryUpdate {
  content?: string;
  importance?: number;
  tags?: string[];
  category?: MemoryCategory;
}

// ── Memory Retrieval (MR-001) ────────────────────────────────────────────────

/**
 * Context signal passed into the retrieval pipeline.
 * Currently lightweight: userMessage for keyword extraction,
 * with room to extend to embeddings or topic signals in MR-003.
 */
export interface MemoryRetrievalContext {
  /** The raw user message from the chat request */
  userMessage: string;
  /** Optional explicit keyword signals for retrieval (MR-003 may auto-extract) */
  keywords?: string[];
}

/**
 * A memory entry with a computed retrieval score and human-readable reason.
 * Used by the v2 retrieval pipeline.
 */
export interface MemoryRetrievalResult {
  entry: MemoryEntry;
  /** Composite score (higher = more relevant). Range not normalized. */
  score: number;
  /** Plain-language reason for the score, useful for debugging */
  reason: string;
}

/**
 * Per-category injection policy for the retrieval pipeline.
 * Controls which memories are eligible for injection based on category.
 */
export interface MemoryCategoryPolicy {
  /** Minimum importance level required for this category to be injected (1–5) */
  minImportance: number;
  /** If true, inject up to `maxCount` memories from this category regardless of score */
  alwaysInject: boolean;
  /** Max number of entries to inject from this category (default: 2) */
  maxCount?: number;
}

// ── Evidence System (Layer 6 / E1) ─────────────────────────────────────────

/** Source of an evidence record — the retrieval method that produced it */
export type EvidenceSource = "web_search" | "http_request" | "manual";

export interface Evidence {
  evidence_id: string;
  task_id: string;
  user_id: string;
  source: EvidenceSource;
  content: string;
  source_metadata: Record<string, unknown> | null;
  relevance_score: number | null;
  created_at: string;  // ISO 8601 string (outward API)
}

export interface EvidenceInput {
  task_id: string;
  user_id: string;
  source: EvidenceSource;
  content: string;
  source_metadata?: Record<string, unknown>;
  relevance_score?: number;
}

// ── Tool System (EL-001) ────────────────────────────────────────────────────

export type ToolScope = "internal" | "external";

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  enum?: string[];
}

/**
 * Tool definition — the contract between the model and the execution layer.
 * Used for both Function Calling schema injection and lightweight parse validation.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  scope: ToolScope;
}

/**
 * A tool invocation issued by the model.
 */
export interface ToolCall {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of executing a single tool call.
 */
export interface ToolResult {
  call_id: string;
  tool_name: string;
  success: boolean;
  result: unknown;
  error?: string;
  latency_ms: number;
}

// ── Execution Plan (EL-002 / EL-003) ──────────────────────────────────────

export type StepType = "reasoning" | "tool_call" | "synthesis" | "unknown";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "blocked";

export interface ExecutionStep {
  id: string;
  title: string;
  type: StepType;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  depends_on: string[];
  status: StepStatus;
  result?: unknown;
  error?: string;
  /** Optional longer description for step context (e.g. system-prompt generation) */
  description?: string;
}

/**
 * A full execution plan produced by the planner.
 */
export interface ExecutionPlan {
  task_id: string;
  steps: ExecutionStep[];
  current_step_index: number;
}

// ── Execution Result Persistence (ER-002) ────────────────────────────────────

/** Lightweight summary of one execution step (written to execution_results.steps_summary) */
export interface ExecutionStepSummary {
  index: number;
  title: string;
  type: StepType;
  status: "pending" | "in_progress" | "completed" | "failed";
  tool_name?: string;
  error?: string;
}

/** steps_summary JSONB shape stored in execution_results */
export interface ExecutionStepsSummary {
  totalSteps: number;
  completedSteps: number;
  toolCallsExecuted: number;
  steps: ExecutionStepSummary[];
}

/** A completed execution result record */
export interface ExecutionResultRecord {
  id: string;
  task_id: string | null;
  user_id: string;
  session_id: string;
  final_content: string | null;
  steps_summary: ExecutionStepsSummary | null;
  memory_entries_used: string[];
  model_used: string | null;
  tool_count: number;
  duration_ms: number | null;
  reason: string | null;
  created_at: string;
}

/** Input for saving a new execution result */
export interface ExecutionResultInput {
  task_id: string | null;
  user_id: string;
  session_id: string;
  final_content: string;
  steps_summary: ExecutionStepsSummary;
  memory_entries_used?: string[];
  model_used?: string;
  tool_count: number;
  duration_ms?: number;
  reason: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 3.0: Manager-Worker Runtime
// ══════════════════════════════════════════════════════════════════════════════

// ── ManagerDecision ────────────────────────────────────────────────────────────

/**
 * ManagerDecision — Phase 3.0 Fast Manager 的标准输出协议。
 * 职责：只表达"下一步怎么做"，不包含最终回答内容本身。
 * 流转：Fast Model → Runtime Orchestrator → 各 Worker / Archive
 */
export interface ManagerDecision {
  /** Schema 版本，用于协议演进校验 */
  schema_version: "manager_decision_v1";
  /** 决策类型：Fast Manager 决定的下一步处理路径 */
  decision_type: ManagerDecisionType;
  /** 兼容现有前端/评测体系，与 decision_type 存在逻辑映射 */
  routing_layer: RoutingLayer;
  /** 决策原因，供日志/trace/debug 使用 */
  reason: string;
  /** 决策置信度 0.0 ~ 1.0 */
  confidence: number;
  /** 是否需要写入/更新 Task Archive */
  needs_archive: boolean;
  /** direct_answer 时的回复草稿 */
  direct_response?: DirectResponse;
  /** ask_clarification 时的澄清问题 */
  clarification?: ClarifyQuestion;
  /** delegate_to_slow / execute_task 时的结构化命令 */
  command?: CommandPayload;
}

/** 决策类型枚举（Phase 0 精简版，4 种） */
export type ManagerDecisionType =
  | "direct_answer"
  | "ask_clarification"
  | "delegate_to_slow"
  | "execute_task";

/** 路由层（兼容现有 L0/L1/L2/L3） */
export type RoutingLayer = "L0" | "L1" | "L2" | "L3";

/** decision_type ↔ routing_layer 默认映射表 */
export const DECISION_TO_LAYER: Record<ManagerDecisionType, RoutingLayer> = {
  direct_answer: "L0",
  ask_clarification: "L0",
  delegate_to_slow: "L2",
  execute_task: "L3",
};

/** 路由层 → decision_type 反向映射（用于旧 router fallback） */
export const LAYER_TO_DECISION: Record<RoutingLayer, ManagerDecisionType> = {
  L0: "direct_answer",
  L1: "direct_answer",
  L2: "delegate_to_slow",
  L3: "execute_task",
};

// ── DirectResponse ─────────────────────────────────────────────────────────────

/** Fast Manager 直接回答时的回复草稿。仅当 decision_type = "direct_answer" 时出现。 */
export interface DirectResponse {
  style: "concise" | "natural" | "structured";
  content: string;
  max_tokens_hint?: number;
}

// ── ClarifyQuestion（复用 Phase 1.5）──────────────────────────────────────────

/** 澄清问题结构，与 Phase 1.5 Clarifying 完全对齐。 */
export interface ClarifyQuestion {
  question_id: string;
  question_text: string;
  options?: ClarifyOption[];
  allow_free_text?: boolean;
  clarification_reason: string;
  missing_fields?: string[];
}

export interface ClarifyOption {
  label: string;
  value: string;
}

// ── CommandPayload ─────────────────────────────────────────────────────────────

/** Manager → Worker 的结构化任务命令。仅当 decision_type = "delegate_to_slow" 或 "execute_task" 时出现。 */
export interface CommandPayload {
  /** 命令类型（Phase 0 精简版，4 种） */
  command_type: CommandType;
  /** 任务类型描述 */
  task_type: string;
  /** Manager 压缩后的任务摘要 */
  task_brief: string;
  /** 最终目标 */
  goal: string;
  /** 约束条件列表 */
  constraints?: string[];
  /** 输入材料引用 */
  input_materials?: InputMaterial[];
  /** 输出格式要求 */
  required_output?: RequiredOutput;
  /** 允许使用的工具列表（execute_task 时必填） */
  tools_allowed?: string[];
  /** 优先级 */
  priority?: "low" | "normal" | "high";
  /** 超时秒数建议 */
  timeout_sec?: number;
  /** Worker 类型提示 */
  worker_hint?: WorkerHint;
}

/** 命令类型枚举（Phase 0 精简版，4 种） */
export type CommandType =
  | "delegate_analysis"
  | "delegate_summarization"
  | "execute_plan"
  | "execute_research";

/** Worker 类型提示 */
export type WorkerHint =
  | "slow_analyst"
  | "execute_worker"
  | "search_worker";

// ── InputMaterial ──────────────────────────────────────────────────────────────

/** Command 的输入材料。 */
export interface InputMaterial {
  type: InputMaterialType;
  content?: string;
  ref_id?: string;
  title?: string;
  importance?: number;
}

export type InputMaterialType =
  | "user_query"
  | "excerpt"
  | "evidence_ref"
  | "memory_ref"
  | "archive_fact";

// ── RequiredOutput ─────────────────────────────────────────────────────────────

/** Manager 对 Worker 产出的格式要求。 */
export interface RequiredOutput {
  format: OutputFormat;
  sections?: string[];
  must_include?: string[];
  max_points?: number;
  tone?: "neutral" | "professional" | "concise";
}

export type OutputFormat =
  | "structured_analysis"
  | "bullet_summary"
  | "answer"
  | "json";

// ── WorkerResult ───────────────────────────────────────────────────────────────

/** Worker → Manager 的结构化结果。Worker 完成后写入 Archive，Manager 读取后统一对外表达。 */
export interface WorkerResult {
  task_id: string;
  worker_type: WorkerHint;
  status: WorkerResultStatus;
  summary: string;
  structured_result: Record<string, unknown>;
  confidence: number;
  ask_for_more_context?: string[];
  error_message?: string;
}

export type WorkerResultStatus =
  | "completed"
  | "partial"
  | "failed";

// ── ajv 简化校验 Schema ────────────────────────────────────────────────────────

/**
 * ajv 运行时校验用简化 JSON Schema。
 * 用法：ajv.addSchema(managerDecisionJsonSchema, 'ManagerDecision')
 */
export const managerDecisionJsonSchema = {
  $id: "https://smartrouter.pro/schemas/manager-decision-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "decision_type",
    "routing_layer",
    "reason",
    "confidence",
    "needs_archive",
  ],
  properties: {
    schema_version: { type: "string", const: "manager_decision_v1" },
    decision_type: {
      type: "string",
      enum: ["direct_answer", "ask_clarification", "delegate_to_slow", "execute_task"],
    },
    routing_layer: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
    reason: { type: "string", minLength: 1, maxLength: 300 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_archive: { type: "boolean" },
    direct_response: {
      type: "object",
      additionalProperties: false,
      required: ["style", "content"],
      properties: {
        style: { type: "string", enum: ["concise", "natural", "structured"] },
        content: { type: "string", minLength: 1, maxLength: 2000 },
        max_tokens_hint: { type: "integer", minimum: 1, maximum: 2000 },
      },
    },
    clarification: {
      type: "object",
      additionalProperties: false,
      required: ["question_id", "question_text", "clarification_reason"],
      properties: {
        question_id: { type: "string", minLength: 1, maxLength: 100 },
        question_text: { type: "string", minLength: 1, maxLength: 500 },
        options: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string", minLength: 1, maxLength: 200 },
              value: { type: "string", minLength: 1, maxLength: 100 },
            },
          },
          maxItems: 10,
        },
        allow_free_text: { type: "boolean" },
        clarification_reason: { type: "string", minLength: 1, maxLength: 300 },
        missing_fields: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
        },
      },
    },
    command: {
      type: "object",
      additionalProperties: false,
      required: ["command_type", "task_type", "task_brief", "goal"],
      properties: {
        command_type: {
          type: "string",
          enum: ["delegate_analysis", "delegate_summarization", "execute_plan", "execute_research"],
        },
        task_type: { type: "string", minLength: 1, maxLength: 100 },
        task_brief: { type: "string", minLength: 1, maxLength: 4000 },
        goal: { type: "string", minLength: 1, maxLength: 1000 },
        constraints: {
          type: "array",
          items: { type: "string", maxLength: 300 },
          maxItems: 20,
        },
        input_materials: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: {
              type: {
                type: "string",
                enum: ["user_query", "excerpt", "evidence_ref", "memory_ref", "archive_fact"],
              },
              content: { type: "string", maxLength: 4000 },
              ref_id: { type: "string", maxLength: 100 },
              title: { type: "string", maxLength: 200 },
              importance: { type: "number", minimum: 0, maximum: 1 },
            },
          },
          maxItems: 30,
        },
        required_output: {
          type: "object",
          additionalProperties: false,
          properties: {
            format: {
              type: "string",
              enum: ["structured_analysis", "bullet_summary", "answer", "json"],
            },
            sections: { type: "array", items: { type: "string" }, maxItems: 20 },
            must_include: { type: "array", items: { type: "string" }, maxItems: 20 },
            max_points: { type: "integer", minimum: 1, maximum: 20 },
            tone: { type: "string", enum: ["neutral", "professional", "concise"] },
          },
        },
        tools_allowed: { type: "array", items: { type: "string" }, maxItems: 20 },
        priority: { type: "string", enum: ["low", "normal", "high"] },
        timeout_sec: { type: "integer", minimum: 1, maximum: 3600 },
        worker_hint: { type: "string", enum: ["slow_analyst", "execute_worker", "search_worker"] },
      },
    },
  },
  allOf: [
    {
      if: { properties: { decision_type: { const: "direct_answer" } } },
      then: { required: ["direct_response"] },
    },
    {
      if: { properties: { decision_type: { const: "ask_clarification" } } },
      then: { required: ["clarification"] },
    },
    {
      if: { properties: { decision_type: { enum: ["delegate_to_slow", "execute_task"] } } },
      then: { required: ["command"] },
    },
  ],
};

// ── SSE Phase 3.0 事件 ────────────────────────────────────────────────────────

export type SSEEventTypePhase3 =
  | "manager_decision"
  | "clarifying_needed"
  | "command_issued"
  | "worker_progress"
  | "worker_completed"
  | "manager_synthesized";

export interface SSEManagerDecisionEvent {
  type: "manager_decision";
  decision: ManagerDecision;
  timestamp: string;
}

export interface SSECommandIssuedEvent {
  type: "command_issued";
  command_id: string;
  delegated_to: WorkerHint;
  task_id: string;
  timestamp: string;
}

export interface SSEWorkerCompletedEvent {
  type: "worker_completed";
  task_id: string;
  command_id: string;
  worker_type: WorkerHint;
  summary: string;
  timestamp: string;
}

// ── Task Archive Repository Types ─────────────────────────────────────────────

/** task_archives 表记录（Phase 3.0 扩展版） */
export interface TaskArchiveRecord {
  id: string;
  session_id: string;
  turn_id: number;
  command: Record<string, unknown> | null;
  user_input: string;
  constraints: string[];
  task_type: string;
  task_brief: Record<string, unknown> | null;
  /** Phase 3.0: Manager 决策 JSONB */
  manager_decision: Record<string, unknown> | null;
  fast_observations: Record<string, unknown>[];
  slow_execution: Record<string, unknown> | null;
  state: string;
  status: string;
  delivered: boolean;
  created_at: string;
  updated_at: string;
}

/** task_commands 表记录（Phase 3.0 新表） */
export interface TaskCommandRecord {
  id: string;
  task_id: string;
  archive_id: string;
  user_id: string;
  issuer_role: string;
  command_type: string;
  worker_hint: string | null;
  priority: string;
  status: CommandStatus;
  payload_json: CommandPayload;
  idempotency_key: string | null;
  timeout_sec: number | null;
  issued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

export type CommandStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** task_worker_results 表记录（Phase 3.0 新表） */
export interface TaskWorkerResultRecord {
  id: string;
  task_id: string;
  archive_id: string;
  command_id: string;
  user_id: string;
  worker_role: string;
  result_type: string;
  status: string;
  summary: string;
  result_json: Record<string, unknown>;
  confidence: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
  started_at: string | null;
  completed_at: string;
  error_message: string | null;
}
