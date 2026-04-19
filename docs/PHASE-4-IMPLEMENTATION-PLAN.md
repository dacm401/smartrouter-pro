# Phase 4 Implementation Plan — Local Trust Gateway

> 版本：v1.0 | 日期：2026-04-19 | 阶段：Phase 4 | 状态：Post-Sprint 39 启动
> 关联：`ARCHITECTURE-VISION.md`（愿景）/ `CURRENT-PHASE-DIRECTIVE.md`（当前指令）

---

## 目标

在 Sprint 39 Runtime Validation 收口后，启动 Phase 4：**数据分级 + 权限层 + 小模型验证**，逐步构建"本地小模型作为用户利益代理人"的信任基础设施。

---

## 核心原则

1. **渐进式**：每个 sub-sprint 可独立交付和验证，不追求大爆炸式上线
2. **可观测**：每次写入/暴露前必须经过数据分类校验，有日志可追溯
3. **向后兼容**：Phase 3.0 现有路由链路不受影响，新能力以 feature flag 接入
4. **小模型定位**：本地小模型 = 用户利益代理人，不是安全门神，也不是全局推理替代者

---

## Phase 4 Sub-Sprints 总览

| Sub-Sprint | 主题 | 核心产出 | 预计周期 |
|-----------|------|---------|---------|
| Sprint 40 | **数据分类 + Permission Layer** | DataClassification enum + PermissionContext + checkPermission() | 1 sprint |
| Sprint 41 | **Rule Engine + Redaction** | DataRedactionRule + 基础脱敏实现 | 1 sprint |
| Sprint 42 | **小模型访问验证** | SmallModelGuard + Prompt Injection 检测 | 1 sprint |
| Sprint 43 | **Phase 5 Local Archive** | 本地化 Archive 存储 + Long-term Memory Agent | 2 sprints |

---

## Sprint 40 — 数据分类 + Permission Layer

### 目标

定义数据分类标准，构建 Permission Layer，使得任何数据暴露决定都经过"分类 → 校验 → 执行"的显式链路。

### 核心架构

```
用户请求
    │
    ▼
[Fast Manager 路由决策]
    │
    ▼
[数据暴露点] ──▶ DataClassifier.classify(content, context)
    │                        │
    │                   ┌────▼──────────────────┐
    │                   │ 数据分类结果 (enum)    │
    │                   │ • local_only          │
    │                   │ • local_summary_shareable │
    │                   │ • cloud_allowed        │
    │                   └─────────────────────────┘
    │                              │
    │                              ▼
    │                   PermissionChecker.check(...)
    │                              │
    │         ┌────────────────────┼────────────────────┐
    │         ▼                    ▼                    ▼
    │    [允许暴露]           [仅摘要暴露]          [拒绝/脱敏]
    │         │                    │                    │
    │         ▼                    ▼                    ▼
    │    完整发送给          小模型生成摘要       执行 Redaction
    │    云端模型           后发送摘要           后再暴露
```

### 核心代码结构

```typescript
// ── 数据分类枚举 ────────────────────────────────────────────────────────────
export enum DataClassification {
  LOCAL_ONLY = "local_only",                    // 仅本地小模型可见
  LOCAL_SUMMARY_SHAREABLE = "local_summary",    // 可生成摘要后暴露
  CLOUD_ALLOWED = "cloud_allowed",              // 可直接发送给云端
}

// ── 分类上下文 ──────────────────────────────────────────────────────────────
export interface ClassificationContext {
  dataType: "conversation_history" | "task_archive" | "memory" | "tool_result" | "user_profile";
  sensitivity: "public" | "internal" | "confidential" | "secret";
  source: "user" | "system" | "third_party";
  hasPII: boolean;
  age?: number; // 数据年龄（小时）
}

// ── 分类器（Rule-based，Phase 4 前期用）────────────────────────────────────
export class DataClassifier {
  classify(content: unknown, ctx: ClassificationContext): DataClassification;
}

// ── 权限校验 ─────────────────────────────────────────────────────────────────
export interface PermissionContext {
  sessionId: string;
  userId: string;
  requestedTier: DataClassification;
  featureFlags: Record<string, boolean>;
}

export interface PermissionResult {
  allowed: boolean;
  tier: DataClassification;
  reason?: string;
  fallbackAction?: "reject" | "redact" | "summarize" | "allow";
}

export class PermissionChecker {
  check(ctx: PermissionContext): PermissionResult;
}
```

### 数据分类默认规则

| 数据类型 | 敏感级 | 来源 | 年龄 | 默认分类 | 说明 |
|---------|--------|------|------|---------|------|
| conversation_history | internal | user | < 1h | `cloud_allowed` | 短期对话可云端处理 |
| conversation_history | internal | user | > 24h | `local_summary` | 长期历史仅摘要暴露 |
| task_archive | internal | system | any | `local_only` | 任务归档含执行细节 |
| memory | confidential | system | any | `local_only` | 记忆存储含用户偏好 |
| tool_result (search) | public | third_party | < 1h | `cloud_allowed` | 公开搜索结果可云端 |
| tool_result (db/internal_api) | confidential | system | any | `local_only` | 内部 API 结果不外泄 |
| user_profile | confidential | user | any | `local_only` | 用户画像不暴露 |

### 数据库变更

```sql
-- task_archives 表新增分类字段
ALTER TABLE task_archives
  ADD COLUMN IF NOT EXISTS default_classification TEXT
    DEFAULT 'local_summary';

-- 可选：为 task_archives 增加数据敏感度元数据
ALTER TABLE task_archives
  ADD COLUMN IF NOT EXISTS sensitivity TEXT
    DEFAULT 'internal';
```

### 验收标准

- [ ] `DataClassification` enum 定义完成
- [ ] `DataClassifier.classify()` 实现默认规则
- [ ] `PermissionChecker.check()` 实现权限校验逻辑
- [ ] LLM-Native Router `delegate_to_slow` 路径接入 PermissionChecker
- [ ] feature flag `use_permission_layer` 控制开关
- [ ] 单元测试覆盖核心路径

---

## Sprint 41 — Rule Engine + Redaction

### 目标

在 Permission Layer 基础上，实现数据脱敏规则引擎，对不适合直接暴露的数据执行脱敏处理。

### 核心架构

```typescript
// ── 脱敏规则 ─────────────────────────────────────────────────────────────────
export interface DataRedactionRule {
  id: string;
  name: string;
  match: {
    fieldPath?: string;     // JSON path，如 "user.profile.phone"
    dataType?: string;      // 数据类型匹配
    regex?: string;         // 正则匹配
  };
  action: "mask" | "hash" | "truncate" | "replace" | "remove";
  config: {
    maskChar?: string;       // 脱敏字符，默认 "*"
    maskPattern?: string;    // 脱敏模式，如 "last4"（保留后4位）
    replacement?: string;     // 替换文本
    maxLength?: number;      // 截断最大长度
  };
}

// ── 内置脱敏规则（默认规则集）────────────────────────────────────────────────
export const DEFAULT_REDACTION_RULES: DataRedactionRule[] = [
  {
    id: "phone",
    name: "手机号脱敏",
    match: { regex: "^1[3-9]\\d{9}$" },
    action: "mask",
    config: { maskPattern: "last4" },
  },
  {
    id: "email",
    name: "邮箱脱敏",
    match: { regex: "^[^@]+@[^@]+\\.[^@]+$" },
    action: "replace",
    config: { replacement: "***@***.***" },
  },
  {
    id: "id_card",
    name: "身份证脱敏",
    match: { regex: "^\\d{17}[\\dXx]$" },
    action: "mask",
    config: { maskPattern: "first6_last4" },
  },
  {
    id: "api_key",
    name: "API Key 脱敏",
    match: { regex: "(?i)(api[_-]?key|secret[_-]?key|access[_-]?token)\\s*[:=]\\s*[\\w-]+" },
    action: "replace",
    config: { replacement: "***REDACTED***" },
  },
  {
    id: "ip_address",
    name: "IP 地址脱敏",
    match: { regex: "\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b" },
    action: "replace",
    config: { replacement: "***.***.***.***" },
  },
];

// ── 脱敏引擎 ────────────────────────────────────────────────────────────────
export class RedactionEngine {
  constructor(rules: DataRedactionRule[]);
  redact(content: string | object): RedactedContent;
  addRule(rule: DataRedactionRule): void;
}
```

### 验收标准

- [ ] `DataRedactionRule` + `RedactionEngine` 实现
- [ ] 默认内置 5 条脱敏规则
- [ ] LLM-Native Router 在发送给云端模型前，对 classification=`cloud_allowed` 的数据执行脱敏
- [ ] `use_redaction` feature flag 控制
- [ ] 单元测试覆盖核心脱敏路径

---

## Sprint 42 — 小模型访问验证

### 目标

实现 SmallModelGuard，确保本地小模型调用路径的质量和安全，防止 Prompt Injection 和无意义调用。

### 核心架构

```typescript
// ── 小模型访问校验 ────────────────────────────────────────────────────────────
export interface SmallModelAccessRequest {
  capability: "memory_lookup" | "permission_check" | "context_compress" | "intent_classify";
  inputTokens: number;
  priority: "high" | "normal" | "low";
  sessionId: string;
}

export interface SmallModelAccessResult {
  allowed: boolean;
  modelToUse: "local" | "cloud_fallback";
  reason?: string;
  rateLimitWaitMs?: number;
}

export class SmallModelGuard {
  // 速率限制：防止频繁调用小模型
  checkRateLimit(sessionId: string): RateLimitResult;

  // Prompt Injection 检测：检测用户输入中可能的注入攻击
  detectPromptInjection(input: string): { safe: boolean; score: number; reason?: string };

  // 能力路由：判断某个能力是否适合调用本地小模型
  shouldUseLocalModel(req: SmallModelAccessRequest): SmallModelAccessResult;
}
```

### Prompt Injection 检测策略

| 策略 | 说明 | 阈值 |
|------|------|------|
| 关键词检测 | 检测 `ignore previous instructions` / `system:` / `## Instructions` 等 | 命中即警告 |
| 模式密度 | 检测特殊字符占比（`[{` 等） | > 30% 警告 |
| 指令干扰 | 检测上下文中指令与请求不匹配 | 人工 review |
| 越权检测 | 检测超出本地模型能力范围的请求 | 超出则拒绝 |

### 验收标准

- [ ] `SmallModelGuard.checkRateLimit()` 实现（滑动窗口计数）
- [ ] `SmallModelGuard.detectPromptInjection()` 实现（3+ 策略）
- [ ] `SmallModelGuard.shouldUseLocalModel()` 实现（能力路由）
- [ ] 集成到 Local Trust Gateway 主路径
- [ ] `use_small_model_guard` feature flag
- [ ] 单元测试 + E2E 注入攻击测试用例

---

## Sprint 43 — Phase 5: Local Archive + Long-term Memory Agent

### 目标

构建本地化 Archive 存储和长期记忆 Agent，使本地小模型能够持久化管理用户上下文，而不仅仅依赖短期 session。

### 核心架构

```
[本地存储层]
task_archives (本地 SQLite)
    │
    ▼
[长期记忆 Agent]
├── 定期压缩：对话 → 摘要 → 嵌入向量
├── 记忆检索：基于当前 query 召回相关历史
└── 遗忘策略：按重要度 + 年龄自动淘汰低价值记忆
    │
    ▼
[Small Model Guard]
    │
    ▼
[Fast Manager 上下文]
```

### 关键实现

1. **本地 SQLite Archive**：Phase 3.0 task_archives 从 PostgreSQL 扩展到本地 SQLite，减少云端依赖
2. **记忆压缩**：对话历史 → 结构化摘要 → 嵌入向量存储
3. **遗忘策略**：基于 `importance_score * decay_factor(age)` 的评分机制
4. **召回路由**：记忆检索结果 → 作为 Fast Manager 的 context 输入

### 验收标准

- [ ] 本地 Archive 存储设计完成
- [ ] 记忆压缩 pipeline 实现
- [ ] 遗忘策略实现
- [ ] 记忆召回路径接入 Fast Manager
- [ ] 与 Phase 4.1~4.3 Permission Layer 完整集成

---

## 数据流总图

```
用户请求
    │
    ▼
Fast Manager（本地 7B）
    │  决策：delegate_to_slow / direct_answer / ask_clarification
    │
    ├─▶ [Permission Layer]  ──▶ [Data Classifier] ──▶ [Redaction Engine]
    │         │                    │                      │
    │         │               分类结果              脱敏后数据
    │         │                    │                      │
    │         ◀────────────────────┘                      │
    │                              │                      │
    │                              ▼                      ▼
    │                         决定暴露范围          仅暴露摘要
    │                              │                      │
    ├──────────────────────────────┼──────────────────────┤
    │                              │                      │
    ▼                              ▼                      ▼
Cloud Slow Model            Cloud Slow Model        Local 小模型
(72B, full context)          (72B, compressed)       (summary only)
    │                              │                      │
    └──────────────────────────────┴──────────────────────┘
                                   │
                                   ▼
                          [Task Archive 回写]
                                   │
                                   ▼
                          [SSE 结果推送 → 用户]
```

---

## Feature Flag 清单

| Flag | 作用域 | 默认值 | 说明 |
|------|--------|--------|------|
| `use_permission_layer` | Sprint 40 | `false` | 权限层总开关 |
| `use_data_classification` | Sprint 40 | `false` | 数据分类开关 |
| `use_redaction` | Sprint 41 | `false` | 脱敏引擎开关 |
| `use_small_model_guard` | Sprint 42 | `false` | 小模型守卫开关 |
| `use_local_archive` | Sprint 43 | `false` | 本地 Archive 开关 |

---

## 与 Phase 1-3 的关系

- **Phase 1（Router）**：保持不变，提供 fallback
- **Phase 2（Memory）**：接入 Permission Layer，小模型记忆操作需校验
- **Phase 3（Manager-Worker）**：Slow 结果暴露时经过数据分类，不直接暴露原始 Archive
- **Phase 4（Trust Gateway）**：叠加在 Phase 3 上，不破坏现有路由逻辑
- **Phase 5（Local Archive）**：在 Phase 4 完成后接管 Archive 存储

---

## 依赖关系

```
Sprint 40 (Permission Layer)
    │
    ├── 产出：DataClassification, PermissionChecker
    └── 前置：无（可独立启动）

Sprint 41 (Redaction)
    │
    ├── 依赖：Sprint 40（PermissionChecker 决定何时脱敏）
    └── 前置：DataClassifier 输出

Sprint 42 (SmallModelGuard)
    │
    ├── 依赖：Sprint 40（PermissionChecker 结果影响路由）
    └── 前置：无（可与 Sprint 41 并行）

Sprint 43 (Local Archive)
    │
    ├── 依赖：Sprint 40 + 41 + 42
    └── 前置：Phase 4 整体完成
```

---

## 已知风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| R1：小模型分类准确率不足 | 低优先级请求被错误拒绝/暴露 | feature flag 隔离，逐步调参 |
| R2：脱敏规则误伤正常内容 | 关键信息被错误脱敏 | 白名单机制 + 用户可配置规则 |
| R3：Prompt Injection 绕过 | 恶意指令通过小模型路径注入 | 多层检测，保守策略优先 |
| R4：性能开销 | Permission + Redaction 链路增加延迟 | 分类/脱敏均异步，不阻塞主流程 |

---

_文档完成：2026-04-19 | by 蟹小钳 🦀_
