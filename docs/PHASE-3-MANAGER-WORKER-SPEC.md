# SmartRouter Pro — Phase 3.0 Manager-Worker Runtime 架构规范

> 版本：v1.0 | 日期：2026-04-19 | 状态：**PROPOSED**
> 基于：用户架构判断 + SYSTEM-STATUS-REPORT + ROADMAP-2026Q2
> 关联文档：`LLM-NATIVE-ROUTING-SPEC.md`（Phase 0~5 详细实施）

---

## 1. 文档目的与定位

本文档正式定义 SmartRouter Pro **Phase 3.0 核心架构重构方向**。

本次重构的目标，不是继续在现有硬编码快/慢路由上做局部修补，而是将系统从：

| 现状 | 目标 |
|------|------|
| Fast/Slow 二分路由器 | Manager-Worker Runtime |
| 基于规则的复杂度判定 | LLM-Native 自判断 |
| 依赖 history/prompt 传递上下文 | 基于 Task Archive 的共享工作台 |
| 隐式 prompt 魔法 | 结构化协议通信 |

---

## 2. 背景：两个根因问题

### 2.1 "快模型提高效率"不应理解成"让它也推理"

如果快模型自己也在长时间想、分析、列很多维度，那它就不再是快模型了。

**快模型应有的职责**：
- 快速理解当前用户这一轮在干什么
- 判断能不能自己直接处理
- 不能处理时，把任务整理成最小必要信息分发给下游

**不应做的事**：
- 自己先推理半天
- 再把一大段长 prompt 扔给 slow

---

### 2.2 真正的性能杀手往往不是模型切换，而是 prompt 膨胀

现实里很多"多模型系统"最后变慢，不是因为调用了慢模型，而是因为：

- 每一跳都把完整 history 带过去
- 每个模型都重复读一遍 persona / memory / tools / rules
- 中间结果不是结构化摘要，而是自然语言大段复述
- 最后形成"提示词爆炸"

---

## 3. 核心设计原则

### P1. 可控制性优于能力
- 优先选择显式协议、稳定状态机、可追踪行为
- 而不是隐式 prompt 魔法

### P2. Task 是核心单元，不是 message history
- 模型之间协作的基本载体是：Task / Task Brief / Task Archive / Structured Command / Structured Result
- 而不是把对话历史无限传下去

### P3. Fast 负责管理，Worker 负责执行
- Fast 承担：理解、决策、分发、澄清、最终表达
- Worker 只承担：完成分派任务、返回结构化结果

### P4. 模型之间通过结构化协议通信
- Fast → Worker 不传长 history，不传冗余人格 prompt
- Fast 只传：task brief + command payload + constraints + selected evidence
- Worker 只返回：structured result + summary + confidence

### P5. 最终用户表达由 Manager 统一输出
- 风格一致、人格一致、用户感知连续
- 多 worker 不直接暴露给用户

---

## 4. 目标架构：Manager-Worker Runtime

### 4.1 角色定义

#### A. Fast Model = Manager
**职责**：
- 读取用户输入 + 人格/偏好/任务状态
- 判断路径：直接答 / 澄清 / 委托 / 执行
- 生成结构化 command
- 汇总 worker 结果
- 输出最终用户可读回复

**不负责**：
- 长时深推理
- 复杂多步执行
- 重复读取全部工具上下文

#### B. Slow Model = Analyst Worker
**职责**：
- 接收 task brief
- 读取必要 archive / evidence
- 做复杂分析 / 深度推理 / 长文本总结
- 输出结构化分析结果

**不负责**：
- 用户人格风格控制
- 对话全局状态管理
- 最终用户话术表达

#### C. Execute Runtime = Tool Worker
**职责**：
- 接收 execute command
- 生成执行计划
- 调用工具
- 写入执行结果
- 返回结构化执行产物

#### D. Task Archive = Shared Workspace
**职责**：
- 保存 manager 生成的任务现场
- 保存 command
- 保存 clarifying 过程
- 保存 confirmed facts / constraints
- 保存 worker result
- 保存最终 summary

---

### 4.2 逻辑流程图

```
User Request
    │
    ▼
Fast Manager
    ├── 读取 user memory / style / task state
    ├── 输出 ManagerDecision
    │
    ├── direct_answer ───────────────→ 直接回复用户
    │
    ├── ask_clarification ───────────→ 推 clarifying 事件
    │
    ├── delegate_to_slow ────────────→ 写 Task Archive + Command
                                       ↓
                                    Slow Worker
                                       ↓
                                  写回 Worker Result
                                       ↓
    └────────────────────────────→ Fast Manager 汇总表达 → 用户

    └── execute_task ─────────────────→ Execute Runtime
                                       ↓
                                  写回 Execution Result
                                       ↓
                              Fast Manager 汇总表达 → 用户
```

---

### 4.3 与现有系统的兼容性分析

#### 高度兼容的现有资产（可直接复用）

| 模块 | 复用价值 | 说明 |
|------|---------|------|
| Task Runtime | ⭐⭐⭐ | 天然适合转成"Manager 写 Task Brief / Command" |
| Memory / Evidence | ⭐⭐⭐ | 已独立存储层，Fast 读取人格，Worker 只读任务证据 |
| Execution Loop | ⭐⭐ | 可演进为 Tool Worker |
| SSE Streaming | ⭐⭐ | 已有完整基础设施 |
| routing_layer 展示 | ⭐⭐ | 可升级为 manager_decision / command_type |
| Clarifying State | ⭐⭐ | 可纳入 ManagerDecision 协议 |
| Benchmark / CI | ⭐ | 就绪基础设施 |

#### 需要重构的模块

| 模块 | 重构方向 | 最终状态 |
|------|---------|---------|
| `rule-router.ts` | 退役 | Phase 4 删除，降级为 fallback |
| `complexity-scorer.ts` | 退役 | Phase 4 删除，降级为 fallback |
| `intent-analyzer.ts` | 退役 | Phase 4 删除，降级为 fallback |
| `prompt-assembler.ts` | 拆分为 Manager Prompt / Worker Prompt | 新架构核心 |
| `chat.ts` | 接入 ManagerDecision 分支 | 新架构核心 |
| `model-gateway.ts` | 支持 manager/worker 模式 | 新架构核心 |

---

## 5. 决策协议设计

### 5.1 ManagerDecision（Manager 第一层输出）

不再是"fast/slow 分数"，而是结构化决策：

```typescript
interface ManagerDecision {
  decision_type: "direct_answer" | "ask_clarification" | "delegate_to_slow" | "execute_task";
  routing_layer: "L0" | "L1" | "L2" | "L3";
  reason: string;
  confidence: number;          // 0.0 ~ 1.0
  needs_archive: boolean;
  
  // 以下字段在 delegate / execute 时必填
  command?: CommandPayload;
  clarification?: ClarifyQuestion;
}
```

### 5.2 CommandPayload（Manager → Worker）

```typescript
interface CommandPayload {
  command_type: "delegate_analysis" | "execute_tool" | "delegate_research";
  task_id: string;
  task_type: string;            // "reasoning" | "search" | "code" | "summarize" | ...
  task_brief: string;           // 结构化任务描述
  goal: string;                 // 期望产出
  constraints: string[];        // 限制条件
  input_materials: {
    type: "user_query" | "evidence_ref" | "archive_ref" | "document";
    content: string;
  }[];
  required_output: {
    format: "structured_analysis" | "plain_text" | "json";
    sections?: string[];
  };
}
```

### 5.3 WorkerResult（Worker → Manager）

```typescript
interface WorkerResult {
  task_id: string;
  worker_type: "slow_analyst" | "tool_worker" | "search_worker";
  status: "completed" | "failed" | "partial";
  summary: string;
  structured_result: Record<string, any>;
  confidence: number;
  ask_for_more_context?: string[];  // 缺失信息时请求补充
}
```

### 5.4 通信示例

**Manager → Slow (delegate_analysis):**

```json
{
  "command_type": "delegate_analysis",
  "task_id": "task_123",
  "task_type": "reasoning",
  "task_brief": "分析 Python 和 JavaScript 在后端开发中的主要差异，给出适用场景建议",
  "goal": "输出对比分析与建议",
  "constraints": [
    "面向初中级开发者",
    "控制在 5 个要点内",
    "要有结论"
  ],
  "input_materials": [
    { "type": "user_query", "content": "Python和JavaScript做后端有什么区别？" }
  ],
  "required_output": {
    "format": "structured_analysis",
    "sections": ["differences", "tradeoffs", "recommendation"]
  }
}
```

**Slow → Manager (completed):**

```json
{
  "task_id": "task_123",
  "worker_type": "slow_analyst",
  "status": "completed",
  "summary": "Python 开发效率高，生态适合数据/AI；JavaScript 前后端统一，适合全栈团队。",
  "structured_result": {
    "differences": [
      "Python语法更简洁，JavaScript异步生态更成熟",
      "Python在AI/数据领域优势明显，Node.js在高并发I/O场景常见"
    ],
    "tradeoffs": [
      "Python学习曲线更平滑",
      "JavaScript全栈一致性更强"
    ],
    "recommendation": "如果你想做全栈 Web，优先 JavaScript；如果更偏 AI / 数据 / 自动化，优先 Python。"
  },
  "confidence": 0.82
}
```

---

## 6. 实施路径：双轨过渡

不建议"一刀切直接删除所有旧逻辑"，走 **双轨过渡**，新架构逐步接管流量。

### Phase 0：Fast 变成可发 Command 的管理模型（不删老 router）

**目标**：Fast 支持输出 `direct_answer` / `ask_clarification` / `delegate_to_slow` / `execute_task`，保留旧 router 作为 fallback。

**验证指标**：
- Fast 能否稳定按 schema 输出 ManagerDecision
- 能否稳定区分"自己答"与"委托"
- command 长度是否显著短于全量 prompt

**改动文件**：
- `model-gateway.ts` — 支持可选 tools 参数
- `chat.ts` — 解析 ManagerDecision 分支
- `prompt-assembler.ts` — 重写 Fast Manager prompt

---

### Phase 1：建立 Task Archive 共享工作台

**目标**：建表存 command / worker_result / confirmed_facts，作为 Manager-Worker 通信的唯一事实源。

**最低需要字段**：

```sql
CREATE TABLE task_archives (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      VARCHAR(64) NOT NULL,
  turn_id         INTEGER NOT NULL,
  
  -- Manager 写入
  manager_decision JSONB NOT NULL,
  command          JSONB,
  
  -- Clarifying
  clarifications   JSONB DEFAULT '[]',
  confirmed_facts  TEXT[],
  constraints      TEXT[],
  
  -- Worker 写入
  worker_type      VARCHAR(32),
  worker_result    JSONB,
  worker_started_at TIMESTAMPTZ,
  worker_completed_at TIMESTAMPTZ,
  
  -- 状态
  status           VARCHAR(16) DEFAULT 'pending',
  delivered        BOOLEAN DEFAULT FALSE,
  
  -- 审计
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
```

**改动文件**：
- `backend/src/db/schema.sql`
- `backend/src/db/repositories.ts`（TaskArchiveRepo）
- `backend/src/api/archive.ts`
- `backend/src/types/index.ts`

---

### Phase 2：Slow 优先只读 Archive，必要时可读 history

**默认路径**：Worker 优先只读 Archive（task brief / evidence / confirmed facts / constraints），减少冗余上下文。

**例外**：当 Archive 信息不足以完成任务时，Worker 可主动读取 history 补全上下文。此时 token 会更贵，但任务正确性优先。

**变更前**（Slow 接收）：
- system prompt + full history + memory + evidence + tools + task summary

**默认变更后**（Slow 接收）：
- worker system prompt
- task brief
- selected evidence
- confirmed facts
- constraints
- output schema

**token 结构会明显变干净。**

---

### Phase 3：Fast 回收最终表达权

**目标**：
- worker 输出只给 manager
- manager 再输出给用户
- 前端展示 manager/worker 分工链路

**前端 SSE 事件升级**：
```typescript
interface SSEEvent {
  type: "manager_decision" | "command_issued" | "worker_progress" | "final_response";
  
  // manager_decision
  manager_decision?: ManagerDecision;
  
  // command_issued
  command_id?: string;
  delegated_to?: "slow_analyst" | "tool_worker";
  
  // worker_progress
  worker_progress?: string;
  
  // final_response
  synthesized_by?: "fast_manager";
}
```

---

### Phase 4：废弃旧 router 三件套

**时机**：Phase 1~3 稳定运行后，再逐步废弃：

- `rule-router.ts`
- `complexity-scorer.ts`
- `intent-analyzer.ts`

**永远保留 fallback 路径**：旧逻辑降级为"无法解析时的兜底路由"。

---

## 7. 风险矩阵

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| Fast Manager 把任务整理错（压缩时丢关键信息） | 中 | 高 | command schema 强制字段；保留 source_excerpt；允许 worker 回 ask_for_more_context |
| schema 漂移（模型 JSON 输出字段不稳定） | 中 | 中 | function calling / json schema；严格校验；不合法时 fallback 旧链路 |
| Archive 写入时序问题 | 低 | 中 | 明确 task state machine；每次 delegation 有 command_id；SSE 与 DB 状态保持一致 |
| 开发期间双中枢（新老并存代码复杂） | 高 | 中 | 明确 feature flag；新架构先覆盖部分流量试跑；benchmark 分开 old/new |
| 7B function calling 可靠性未知 | 中 | 高 | Sprint 36 Phase 0 先验证；降级方案：特殊标记解析 |

---

## 8. 与 Fast/Slow 精细打分路线的对比

### 不建议继续深挖的方向
- 继续往 `rule-router.ts` 里加分支
- 继续调 `complexity_score > xx` 阈值
- 继续靠更多正则和关键词补洞
- 把 fast/slow 看成最终目标

这些可以短期止血，但不值得继续重投入。

### 建议重投入的方向

| 方向 | 核心价值 |
|------|---------|
| Fast Manager 协议化 | 从"规则选模型"到"模型自判断" |
| Task Archive 共享工作台 | 从"传 history"到"结构化状态共享" |
| Worker 化 | 从"模型管全局"到"Worker 只做工" |
| 最终表达回归 Fast | 统一用户体验层 |

---

## 9. 收益总结

| 收益 | 说明 |
|------|------|
| prompt 显著变短 | Slow 不再重复读人格 / 整段历史 / 冗余 memory |
| Fast 真正"快" | 只承担管理/澄清/分发，不承担深推理 |
| 多 worker 扩展性强 | search / code / summarize / execute / critique 都可接入同一协议 |
| 用户体验更稳 | 用户感知连贯助手，而不是多模型切换痕迹 |
| 评测更清晰 | 可单独评估 manager 决策准确率 / worker 质量 / token 节省比例 |

---

## 10. 关键判断一句话版

> **Phase 3.0 不是在当前系统旁边加一个新想法，而是为 SmartRouter Pro 指定下一代正确架构：从"快慢路由器"升级为"管理模型 + 共享工作台 + 执行智能体"的 Manager-Worker Runtime。**
> 
> - **方向上：高度一致**
> - **工程上：中等偏大的中枢改造**
> - **资产上：大量既有能力可复用**
> - **风险上：可通过双轨过渡控制**

---

_文档日期：2026-04-19 | by 蟹小钳 🦀_
_关联：`ROADMAP-2026Q2.md` / `LLM-NATIVE-ROUTING-SPEC.md` / `SYSTEM-STATUS-REPORT.md`_
