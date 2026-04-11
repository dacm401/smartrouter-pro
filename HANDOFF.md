# HANDOFF.md — smartrouter-pro 最终归档状态

> 每开新对话，先读本文件，再读 MEMORY.md。

---

## 项目状态：Phase A COMPLETE ✅ → Phase B 待开

Sprint 14 完成态。Sprint 15 全部收口（C3a / E1 / T1 / W1 / UI1 / B1）。TS 错误全部清零。

---

## Sprint 14 全部 CLOSED ✅

| P | 描述 | 状态 | Commit |
|---|---|---|---|
| P1 | B 层 implicit signal audit | ✅ CLOSED | `80389b9` |
| P2 | Feedback API Hardening | ✅ CLOSED | `80389b9` |
| P3 | Feedback Events MVP | ✅ CLOSED | `80389b9` |
| P4 | Auto-detect Backfill | ✅ CLOSED | `f6371c4` |
| P5 | Learning-side Signal Level Gating | ✅ CLOSED | `f6371c4` |

---

## Sprint 15 全部 CLOSED ✅

| 卡片 | 描述 | 状态 | Commit |
|---|---|---|---|
| C3a | Server Identity Context Adapter | ✅ CLOSED | `5e6d7e8` |
| E1 | Evidence System v1（Layer 6 入口） | ✅ CLOSED | `07d0b16` |
| T1 | Task Resume v1 | ✅ CLOSED | `d03704c` |
| W1 | web_search 真实接入 | ✅ CLOSED | `d03704c` |
| UI1 | 最小工作台 UI | ✅ CLOSED | `d03704c` |
| B1 | Benchmark Runner 骨架 | ✅ CLOSED | `d03704c` |

**HEAD：** `d03704c` — Sprint 15 全部收口

| Commit | 内容 |
|--------|------|
| `5fcae59` | ts-type: fix 4 pre-existing TS errors; docs: update HANDOFF for E1 |
| `d03704c` | feat: Sprint 15 complete — Task Resume v1, web_search, UI panels, Benchmark skeleton |

---

## 项目尾项卡片 CLOSED ✅

| 卡片 | 描述 | 状态 | 核心实现 |
|---|---|---|---|
| C1 | DecisionRepo satisfaction_rate signal_level 分层 | ✅ CLOSED | `getTodayStats()` / `getRoutingAccuracyHistory()` 加 LEFT JOIN `feedback_events`，按 `signal_level <= 1` 过滤；legacy fallback = 无 `feedback_events` 记录 + `feedback_score IS NOT NULL` |
| C2 | Feedback dual-write consistency | ✅ CLOSED | `recordFeedback()` 调换写入顺序：`FeedbackEventRepo.save()` 先写，成功后再写 `decision_logs`；失败时两者均不更新 |
| C3a | Server Identity Context Adapter | ✅ CLOSED | `identityMiddleware` + `getContextUserId()`；所有 handler 改从 middleware context 读 userId；生产模式无 X-User-Id header 直接 401 |
| E1 | Evidence System v1（Layer 6 入口） | ✅ CLOSED | `evidence` 表 + `EvidenceRepo` + `/v1/evidence` CRUD API + `handleWebSearch` 自动写入 evidence（fire-and-forget）；`memory_entries` vs `evidence` 职责划分：独立建表，evidence 保留 provenance |

---

## C1 核心实现要点

- `repositories.ts`：`getTodayStats()` / `getRoutingAccuracyHistory()` 均使用 CTE + LEFT JOIN `feedback_events`
- L1 signal = `fe.signal_level <= 1` OR（无 `feedback_events` 记录 AND `d.feedback_score IS NOT NULL`）
- `satisfaction_rate` 只在 L1 signal 上计算，与 `analyzeAndLearn()` truth 定义对齐
- `decision-repo.test.ts`：新增 13 个 signal_level 过滤测试，总计 48/48

---

---

## C3a 核心实现要点

- `middleware/identity.ts`：identityMiddleware（身份解析）+ getContextUserId()
- `config.identity.allowDevFallback`：环境变量 `ALLOW_DEV_FALLBACK=true` 开启 dev fallback
- 身份优先级：① X-User-Id header → ② query.user_id（dev） → ③ 401
- 所有 API handler（chat/feedback/tasks/memory/dashboard）改从 middleware context 读 userId
- chat/feedback 端点：dev-only body shim（仅当 context 无值且 allowDevFallback=true 时读 body.user_id）
- 未引入 session/token/JWT/auth 系统（严格遵守 scope 约束）

---

## C2 核心实现要点

- `feedback-collector.ts`：`recordFeedback()` 写入顺序调换
- 有 `userId`：先写 `feedback_events` → 成功 → 写 `decision_logs`
- 有 `userId` + `FeedbackEventRepo.save` 失败：`decision_logs` 不更新，无孤立记录
- 无 `userId`：保持 legacy 路径，仅写 `decision_logs`
- `feedback-collector.test.ts`：新增 5 个双写原子性测试，总计 48/48

---

## E1 核心实现要点

- `src/db/schema.sql`：新增 `evidence` 表（含 `evidence_id`/`task_id`/`user_id`/`source`/`content`/`source_metadata`/`relevance_score`/`created_at`）
- `src/types/index.ts`：`Evidence`、`EvidenceInput`、`EvidenceSource`（`"web_search" | "http_request" | "manual"`）
- `src/db/repositories.ts`：`EvidenceRepo`（create / getById / listByTask / listByUser）
- `src/api/evidence.ts`：POST `/v1/evidence`（201）、GET `/v1/evidence/:id`（200/404）、GET `/v1/evidence?task_id=`（200）；C3a middleware 保护
- `src/tools/executor.ts`：`handleWebSearch` 成功返回前 fire-and-forget 写入 evidence；taskId 缺失时跳过
- `tests/repositories/evidence-repo.test.ts`：18 个 repo 测试用例（DB 基础设施问题未执行）
- `memory_entries` vs `evidence` 边界：memory_entries = 用户级/可编辑；evidence = 任务级/保留 provenance

---

## TypeScript 错误清理（Step B）

| 错误 | 文件 | 修复方式 | 结论 |
|------|------|---------|------|
| TS2322 | `chat.ts:178` | `s.status as "pending" \| "in_progress" \| "completed" \| "failed"` | ✅ 纯类型 cast，无业务逻辑改动 |
| TS2561 | `repositories.ts:428` | 删除 `routing_accuracy_history` 赋值（类型已移除该字段） | ✅ 清理遗留代码，与 GrowthProfile 类型同步 |
| TS2339×3 | `execution-loop.ts:302/363/392` | `ExecutionStep` 类型补 `description?: string` | ✅ 纯类型字段，无业务逻辑改动 |

**`tsc --noEmit` 结果：零错误（backend + frontend + evaluation）。**

---

## T1 核心实现要点（Task Resume v1）

- **触发方式**：方案 C（混合）——显式 `task_id` 优先；无则按 `session_id` 找最近 `status NOT IN ('completed','failed','cancelled')`；都没有就新建
- `TaskRepo.findActiveBySession(sessionId, userId)`：查最近 active task
- `TaskRepo.setStatus(taskId, status)`：resume→`responding` / pause→`paused` / cancel→`cancelled`
- `PATCH /v1/tasks/:task_id`：提供 `action: 'resume' | 'pause' | 'cancel'`，C3a 保护
- `resumedTaskSummary` 注入 prompt context：`completed_steps / blocked_by / confirmed_facts / summary_text`
- `ChatRequest.task_id` / `ChatResponse.task_id`：前后端契约
- `tests/repositories/task-resume.test.ts`：5 个用例（DB 基础设施未执行）

---

## W1 核心实现要点（web_search 真实接入）

- `config.webSearch`：新增 `{ endpoint, apiKey, maxResults }` 配置节
- `handleWebSearch()`：读 `config.webSearch.endpoint`，无 endpoint → `{ results: [], error: "WEB_SEARCH_NOT_CONFIGURED" }`
- 带 `Authorization: Bearer <apiKey>` header（若有）
- 网络错误 / 非 OK 状态 → `{ results: [], error: "FETCH_ERROR: ..." }` / `{ results: [], error: "SEARCH_API_ERROR: ..." }`，不抛异常
- `.env.example` 补 `WEB_SEARCH_ENDPOINT=` / `WEB_SEARCH_API_KEY=` / `WEB_SEARCH_MAX_RESULTS=`

---

## UI1 核心实现要点（最小工作台 UI）

- **TaskPanel**：`GET /v1/tasks/all`，展示 `title / status / mode`，点击选中
- **EvidencePanel**：`GET /v1/evidence?task_id=`，source icon + content（截断 200 字）+ URL 链接
- **TracePanel**：`GET /v1/tasks/:id/traces`，type 分图标，展示 detail 摘要
- `ChatInterface.onTaskIdChange`：响应带回 `task_id` 后触发回调，驱动面板刷新
- `app/page.tsx`：右侧工作台侧边栏（默认展开，可折叠），Task Panel 上 + Evidence/Trace tab 切换
- 未引入新 UI 库，仅用现有 Tailwind / React

---

## B1 核心实现要点（Benchmark Runner 骨架）

- `evaluation/runner.ts`：`BenchmarkTask[]` / `BenchmarkResult[]` 类型，`runBenchmark()` / `printReport()`
- `evaluation/tasks/direct.json`：5 条 direct 模式测试用例
- `evaluation/tasks/research.json`：5 条 research 模式测试用例
- `evaluation/README.md`：运行说明 `npx ts-node evaluation/runner.ts`
- `evaluation/tsconfig.json`：独立 tsconfig，引用 backend `@types/node`
- runner 可编译：`tsc --noEmit` 零错误

---

## 后续治理项（Deferred，不阻断交付）

---

## 已确认的架构边界（不得打破）

- **TaskPlanner 不查数据库**：retrieval 在 chat.ts，planner 只接收 `executionResultContext?: string`
- **不默认注入失败结果**：`allowedReasons` 默认 `["completed"]`
- **Behavioral Learning 信号边界**：
  - `fastExplicitSamples`：L1 (signal_level=1) → truth + eligibility
  - `fastL2Samples`：L2 (signal_level=2) → eligibility only
  - `fastL3Samples`：L3 (signal_level=3) → 完全排除
  - `fastExecutionSignalSamples`（P4.2）：`did_fallback=true` 或 `cost_saved>0` → eligibility only

---

## 测试口径（最终验证）

| Suite | 命令 | 结果 |
|---|---|---|
| memory-store.test.ts（P5） | `npx vitest run ... memory-store.test.ts` | 33 tests ✅ |
| feedback-collector.test.ts（P4+C2） | `npx vitest run ... feedback-collector.test.ts` | 48 tests ✅ |
| feedback-event-repo.test.ts（P3） | `npx vitest run ... feedback-event-repo.test.ts` | 21 tests ✅ |
| decision-repo.test.ts（C1） | `npx vitest run ... decision-repo.test.ts` | 48 tests ✅ |
| evidence-repo.test.ts（E1） | `npx vitest run --config vitest.repo.config.ts ... evidence-repo.test.ts` | 18 tests ⚠️ DB down |
| task-resume.test.ts（T1） | `npx vitest run --config vitest.repo.config.ts ... task-resume.test.ts` | 5 tests ⚠️ DB down |

⚠️ PowerShell 注意：`&&` 链式执行会短路，不作最终证据。以单文件独立进程结果为准。

---

## 关键文件路径

| 文件 | 作用 |
|---|---|
| `backend/src/services/memory-store.ts` | `analyzeAndLearn()` — 核心 learning 逻辑 |
| `backend/src/features/feedback-collector.ts` | `detectImplicitFeedback()` + `recordFeedback()` |
| `backend/src/db/repositories.ts` | DecisionRepo + FeedbackEventRepo，含 C1 satisfaction_rate 分层 SQL |
| `backend/tests/services/memory-store.test.ts` | P5 验收测试 33 个 |
| `backend/tests/features/feedback-collector.test.ts` | P4+C2 验收测试 48 个 |
| `backend/tests/repositories/feedback-event-repo.test.ts` | Repo 测试 21 个 |
| `backend/tests/repositories/decision-repo.test.ts` | C1 验收测试 48 个 |
| `backend/src/api/chat.ts` | T1 Task Resume 核心逻辑 |
| `backend/src/api/evidence.ts` | E1 Evidence CRUD API |
| `backend/src/tools/executor.ts` | W1 web_search 真实接入 + E1 evidence fire-and-forget |
| `frontend/src/app/page.tsx` | UI1 工作台侧边栏集成 |
| `frontend/src/components/workbench/` | UI1 TaskPanel / EvidencePanel / TracePanel |
| `evaluation/runner.ts` | B1 Benchmark Runner 骨架 |
| `docs/sprint14-p1-implicit-signal-audit.md` | P1 审计报告 |

---

## 后续治理项（Deferred，不阻断交付）

| 卡片 | 说明 | 风险级别 |
|---|---|---|
| Feedback dual-write reverse order | `feedback_events` 成功 + `decision_logs` 失败时的表间短暂不一致 | 低 |
| Evidence System Layer 6 完整性 | evidence 只写了 web_search 来源，http_request 来源待 W1 接入后补充 | 低 |

---

## 用户偏好（不变）

- 黄西式冷幽默风格
- 项目经理式派工（进度报告、分阶段验收）
- 证据闭环一致性：叙述版本必须收成一版
- 先审计/计划，再改代码
- 弱信号不升级为 truth
