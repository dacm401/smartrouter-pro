# Sprint 39 — Runtime Validation Plan

> 版本：v1.0 | 日期：2026-04-19 | Sprint：39
> 状态：**IN PROGRESS — Step 1: 审计完成，Step 2 开始**
> 关联：`CURRENT-PHASE-DIRECTIVE.md`（执行指令）/ `ARCHITECTURE-VISION.md`（愿景）

---

## 执行原则

> **先审计，后代码。问题没摸清楚之前不动手。**

---

## Step 1 产出：现状审计报告

### 1.1 四条主链路现状

#### 链路 A：direct_answer

| 属性 | 值 |
|------|-----|
| 触发条件 | `body.use_llm_native_routing=true` + Manager 输出 `decision_type: "direct_answer"` |
| 入口 | `chat.ts:135-157`（Phase 3.0 分支判断） |
| Manager 调用 | `llm-native-router.ts:182` → `routeWithManagerDecision` |
| Manager 校验 | `llm-native-router.ts:185` → `parseAndValidate` |
| 路由分支 | `llm-native-router.ts:258-268` |
| 返回 | `{ message: direct_response.content, decision_type: "direct_answer", routing_layer: "L0" }` |
| HTTP 路径 | `chat.ts:278-304` 构建 `ChatResponse` |
| SSE 路径 | `chat.ts:171-178` 推送 `manager_decision` 事件 → `done` |
| Archive 写入 | **无**（direct_answer 不写 archive） |
| Worker 触发 | 无 |
| ⚠️ 风险点 | Archive 无写入，后续无法追踪 direct_answer 请求 |

#### 链路 B：ask_clarification

| 属性 | 值 |
|------|-----|
| 触发条件 | Manager 输出 `decision_type: "ask_clarification"` |
| 入口 | `llm-native-router.ts:271-284` |
| Manager 校验 | 同上 |
| 返回 | `{ message: clarifyingMessage, clarifying: ClarifyQuestion }` |
| HTTP 路径 | `chat.ts:297` 通过 `clarifying` 字段返回 |
| SSE 路径 | `chat.ts:181-189` 推送 `clarifying_needed` 事件 |
| Archive 写入 | **无**（llm-native-router 不写 task_archives） |
| Worker 触发 | 无 |
| ⚠️ 风险点 | 1. ask_clarification 不写 archive，状态无法追踪<br>2. ClarifyQuestion 的 question_id 来自 Manager 生成，字段结构需对齐 Phase 1.5 |

#### 链路 C：delegate_to_slow

| 属性 | 值 |
|------|-----|
| 触发条件 | Manager 输出 `decision_type: "delegate_to_slow"` |
| 入口 | `llm-native-router.ts:287-366` |
| Archive 写入 | `llm-native-router.ts:292-303` → `TaskArchiveRepo.create()`（state: 'delegated', status: 'pending'） |
| Command 写入 | `llm-native-router.ts:305-321` → `TaskCommandRepo.create()`（status: 'queued'） |
| 旧路径调用 | `llm-native-router.ts:346-353` → `triggerSlowModelBackground()`（向后兼容） |
| SSE 路径 | `chat.ts:194-199` 推送 `command_issued` → `pollArchiveAndYield` 推送 `result` |
| Worker 拉取 | `slow-worker-loop.ts:206-215` → `SELECT WHERE status='queued' AND command_type NOT LIKE 'execute%'` |
| Worker 执行 | `slow-worker-loop.ts:140-151` → `TaskWorkerResultRepo.create()` |
| 结果回写 | `slow-worker-loop.ts:154-163` → `TaskArchiveRepo.setSlowExecution()` |
| 命令状态更新 | `slow-worker-loop.ts:166` → `TaskCommandRepo.updateStatus(id, "completed")` |
| Archive 状态更新 | `slow-worker-loop.ts:168` → `TaskArchiveRepo.updateState(archive_id, "done")` |
| ⚠️ 风险点 | `triggerSlowModelBackground()` 和 `slow-worker-loop` **同时存在**，造成双写 delegation_archive |
| ⚠️ 风险点 | `ask_clarification` 不写 archive → ClarifyQuestion 用户回复后无法关联到原请求 |

#### 链路 D：execute_task

| 属性 | 值 |
|------|-----|
| 触发条件 | Manager 输出 `decision_type: "execute_task"` |
| 入口 | `llm-native-router.ts:369-419` |
| Archive 写入 | `llm-native-router.ts:374-387` → `TaskArchiveRepo.create()` |
| Command 写入 | `llm-native-router.ts:389-406` → `TaskCommandRepo.create()` |
| SSE 路径 | 同 delegate_to_slow |
| Worker 拉取 | `execute-worker-loop.ts:152-160` → `SELECT WHERE status='queued' AND command_type IN ('execute_plan', 'execute_research')` |
| Worker 执行 | `execute-worker-loop.ts:62-69` → `executionLoop.run(plan, ...)` |
| 结果回写 | `execute-worker-loop.ts:111-118` → `TaskArchiveRepo.setSlowExecution()` |
| 命令状态更新 | `execute-worker-loop.ts:121` → `TaskCommandRepo.updateStatus(id, "completed")` |
| ⚠️ 风险点 | `execute-worker-loop.ts:66` hardcode `"qwen2.5-72b-instruct"` 而非从 config 读取 |

---

### 1.2 当前数据表覆盖

#### task_archives（主工作台）

| 字段 | 来源 | 消费者 | 权威性 |
|------|------|--------|--------|
| id / task_id / session_id / user_id | llm-native-router / orchestrator | pollArchiveAndYield / SSE | ✅ 主 |
| manager_decision (JSONB) | llm-native-router | SSE event / debug | ✅ 主 |
| command (JSONB) | llm-native-router | slow-worker / execute-worker | ✅ 主 |
| slow_execution (JSONB) | slow-worker-loop / execute-worker-loop / triggerSlowModelBackground | pollArchiveAndYield | ⚠️ **双写** |
| state | slow-worker-loop / execute-worker-loop / TaskArchiveRepo | pollArchiveAndYield | ⚠️ Worker 写，archive 初始为 delegated |
| status | TaskArchiveRepo（初始 pending） | SSE 轮询判断 | ⚠️ pending/running/done 语义需对齐 |
| delivered | pollArchiveAndYield | — | ✅ 仅轮询用 |
| fast_observations | 未被写入（appendFastObservation 有方法但无调用方） | — | 死代码 |

#### task_commands（命令队列）

| 字段 | 来源 | 消费者 |
|------|------|--------|
| id / task_id / archive_id / user_id | llm-native-router | Worker Loop |
| command_type | llm-native-router | Worker 过滤条件 |
| status: queued | llm-native-router | Worker 轮询入口 |
| status: running | Worker Loop | 轮询排除 |
| status: completed/failed | Worker Loop | 归档 |
| payload_json | llm-native-router | Worker 反序列化 |

#### task_worker_results（Worker 结果）

| 字段 | 来源 | 消费者 |
|------|------|--------|
| id / task_id / archive_id / command_id / user_id | Worker Loop | Manager 汇总（Sprint 39 验收后接入） |
| result_json | Worker Loop | SSE `worker_completed` 事件（Sprint 39 验收后接入） |
| status | Worker Loop | SSE `worker_completed`（Sprint 39 验收后接入） |

#### delegation_archive（向后兼容）

| 字段 | 来源 | 消费者 |
|------|------|--------|
| 所有字段 | `orchestrator.ts:548-557`（旧路径）<br>`triggerSlowModelBackground()` | `DelegationArchiveRepo.hasPending()`（O-007 安抚功能） |
| slow_result | 同上 | 无直接消费者 |
| **状态** | **仍在被写入** | 供 O-007 使用 |

#### execution_results（EL-003）

| 字段 | 来源 | 消费者 |
|------|------|--------|
| 所有字段 | `chat.ts:548-559`（execute 模式） | 无直接消费者（Sprint 39 验收后） |

---

### 1.3 SSE 事件清单

#### Phase 3.0 SSE（use_llm_native_routing=true）

| 事件名 | 位置 | Payload | 触发条件 | 稳定性 |
|--------|------|---------|---------|--------|
| `manager_decision` | chat.ts:172 | `{type, decision_type, routing_layer, message}` | Manager 决策后立即推送 | ✅ 稳定 |
| `clarifying_needed` | chat.ts:182 | `{type, routing_layer, question_text, options, question_id}` | decision_type=ask_clarification | ✅ 稳定 |
| `command_issued` | chat.ts:194 | `{type, task_id, routing_layer}` | decision_type ∈ {delegate_to_slow, execute_task} | ✅ 稳定 |
| `result` | orchestrator.ts:685 | `{type, stream, routing_layer}` | pollArchiveAndYield 检测 status=done | ⚠️ 需验证 |
| `error` | orchestrator.ts:696 | `{type, stream, routing_layer}` | status=failed | ⚠️ 需验证 |
| `done` | chat.ts:212 | `{type, routing_layer}` | 流结束 | ✅ 稳定 |

#### 旧 SSE（useOrchestrator / streaming）

| 事件名 | 位置 | Payload | 风险 |
|--------|------|---------|------|
| `fast_reply` | chat.ts:615 | `{type, stream, routing_layer}` | ⚠️ 与 Phase 3.0 不统一 |
| `clarifying` | chat.ts:620 | `{type, stream, options, question_id, routing_layer}` | ⚠️ 事件名与 Phase 3.0 不一致 |
| `chunk` | chat.ts:699 | `{type, stream, routing_layer}` | ⚠️ streaming chunk 事件 |
| `done` | chat.ts:636/710/745 | 多处不一致 | ⚠️ done 语义在两路不一致 |

---

### 1.4 兼容层与风险清单

#### 🔴 高优先级风险

**R1：Slow 路径权威结果源双写**

`task_archives.slow_execution` 被两个路径写入：
- `triggerSlowModelBackground()`（旧路径，orchestrator.ts:540-546）
- `slow-worker-loop.ts`（Phase 3.0）

**影响**：同一 task_id 可能被两个写入者覆盖，导致结果不可预测。

**建议**：确认 Phase 3.0 路径（slow-worker-loop）是否为唯一主来源，旧 `triggerSlowModelBackground` 是否仍被 LLM-Native 路径调用。

**R2：ask_clarification 不写 archive → 状态无法追踪**

用户回答 ClarifyQuestion 后，系统无法关联到原请求的 archive 记录。

**建议**：ask_clarification 也应该写 archive（state: clarifying）。

**R3：SSE done 事件在两路语义不一致**

旧 SSE 有 `done`/`[delegation_complete]`/`[stream_complete]` 三种语义，Phase 3.0 SSE 只有一种 `done`。

**建议**：统一 done 语义，冻结 Phase 3.0 SSE 协议。

#### 🟡 中优先级风险

**R4：execute-worker-loop hardcode 模型名**

`execute-worker-loop.ts:66` hardcode `"qwen2.5-72b-instruct"`，应从 config 读取。

**R5：delegation_archive 仍在被写入**

O-007 安抚功能依赖 `DelegationArchiveRepo.hasPending()`，但 delegation_archive 表在 Phase 3.0 后已非权威数据源。确认是否需要迁移到 task_archives。

**R6：fast_observations 无调用方**

`TaskArchiveRepo.appendFastObservation` 方法存在但无代码调用，是死代码。

---

## Step 2 产出：权威数据源决策

### Card 39-A：Authority Source Consolidation

#### Q1：Slow 路径的权威结果来源

| 来源 | 写入者 | 状态 |
|------|--------|------|
| `task_archives.slow_execution` | slow-worker-loop + triggerSlowModelBackground | ⚠️ 双写 |
| `task_worker_results` | slow-worker-loop（Phase 3.0） | ✅ 单写 |

**决策**：

| 来源 | 角色 | 理由 |
|------|------|------|
| `task_worker_results` | **权威结果来源** | Phase 3.0 Worker 专写，有 command_id 关联，结构化 |
| `task_archives.slow_execution` | **辅助感知**（供 pollArchiveAndYield 轮询） | pollArchiveAndYield 只读此字段判断完成，不写 |

**操作**：
- 确认 slow-worker-loop 不再调用 `triggerSlowModelBackground`（已在 llm-native-router 中确认：llm-native-router.ts:346 调用了 triggerSlowModelBackground）
- 实际上 llm-native-router 在 delegate_to_slow 中**同时**调用了 TaskCommandRepo.create() + triggerSlowModelBackground()，造成双写
- **修复**：删除 llm-native-router.ts:346-353 对 triggerSlowModelBackground 的调用，保留 TaskCommandRepo.create()，由 slow-worker-loop 作为唯一执行路径

#### Q2：Execute 路径的权威结果来源

| 来源 | 写入者 | 状态 |
|------|--------|------|
| `task_archives.slow_execution` | execute-worker-loop | ✅ 主 |
| `task_worker_results` | execute-worker-loop（Phase 3.0） | ✅ 同步写入 |
| `execution_results` | chat.ts（execute 模式） | ⚠️ 只在 chat.ts 直接路径写入，execute-worker-loop 不写 |

**决策**：

| 来源 | 角色 | 理由 |
|------|------|------|
| `task_worker_results` | **权威结果来源**（Phase 3.0 统一） | 结构化，关联 command_id |
| `task_archives.slow_execution` | **轮询感知** | execute-worker-loop 写入，pollArchiveAndYield 读 |
| `execution_results` | **保留向后兼容** | chat.ts execute 路径（body.execute=true）专用，execute-worker-loop 不写 |

---

## Step 3：状态语义待确认

### 当前状态字段使用情况

| 表 | 状态字段 | 状态值 | 写入者 | 消费者 |
|----|---------|--------|--------|--------|
| task_archives | state | delegated / clarifying / running / done / failed | llm-native-router / Worker | pollArchiveAndYield |
| task_archives | status | pending / running / done | TaskArchiveRepo（初始） | SSE 轮询 |
| task_commands | status | queued / running / completed / failed | llm-native-router / Worker | Worker 轮询 |
| delegation_archive | status | pending / completed / failed | triggerSlowModelBackground | O-007 hasPending |

**问题**：两套状态系统并行（task_archives.state + task_archives.status + task_commands.status），语义存在重复。

**待确认**：pollArchiveAndYield 使用的是 `status` 还是 `slow_execution`？

答案：`orchestrator.ts:681` 检查 `task.status === "done"`，但 slow-worker-loop 写入的是 `state = "done"`。

→ **状态不一致 bug**：slow-worker-loop 写 `state`，但 pollArchiveAndYield 读 `status`。

---

## Step 4：SSE 协议冻结（草案）

详见：`docs/SSE-EVENT-PROTOCOL-v1.md`（Card 39-C 产出）

---

## Step 5：E2E 验收用例（草案）

详见：`docs/SPRINT-39-E2E-TEST-CASES.md`（Card 39-D 产出）

---

## Step 6：兼容层清单

详见：`docs/COMPATIBILITY-INVENTORY.md`（Card 39-E 产出）

---

## 当前 Sprint 内已识别待修复的 Bug

| Bug ID | 描述 | 影响 | 优先级 | 状态 |
|--------|------|------|--------|------|
| **B39-01** | llm-native-router delegate_to_slow 同时调用 TaskCommandRepo + triggerSlowModelBackground，双写 delegation_archive | 数据不一致 | 🔴 P0 | ✅ **已修复** (`2975282`) |
| **B39-02** | ask_clarification 不写 task_archives，无法追踪 ClarifyQuestion 后续状态 | 状态不可追踪 | 🔴 P0 | ✅ **已修复** (`2975282`) |
| **B39-03** | slow-worker-loop 写 `state=done`，但 pollArchiveAndYield 读 `status=done` | Worker 结果推送失败 | 🔴 P0 | ✅ **已修复** (`2975282`) |
| **B39-04** | execute-worker-loop hardcode 模型名，非从 config 读取 | 配置失效 | 🟡 P1 | 🔲 待处理 |
| **B39-05** | SSE done 事件两路语义不一致（旧 SSE 三种 done，Phase 3.0 一种） | 前端需区分处理 | 🟡 P1 | 🔲 Card 39-C |
| **B39-06** | fast_observations 方法无调用方，死代码 | 技术债务 | 🟡 P2 | 🔲 待处理 |

---

## 下一步：Card 39-B → Card 39-C → Card 39-D → Card 39-E

Card 39-A（B39-01/02/03）✅ 已完成。后续 Sprint 39 五步收口：

- **Card 39-B**：状态机语义统一（state vs. status 双轨合并）
- **Card 39-C**：SSE 协议冻结（统一 done 语义）
- **Card 39-D**：Runtime E2E 验收
- **Card 39-E**：兼容层清点（旧 orchestrator/delegation_archive 清理计划）

---

_审计完成：2026-04-19 | by 蟹小钳 🦀_
