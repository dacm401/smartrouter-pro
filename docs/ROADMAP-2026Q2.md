# SmartRouter Pro — Sprint 36+ 发展路线图

> 版本：v2.0 | 日期：2026-04-19 | 基于：PHASE-3-MANAGER-WORKER-SPEC.md
> 核心战略：**Manager-Worker Runtime**，Fast 从"回答模型"升级为"管理模型"

---

## 一、当前站点

```
Phase A (Lean Chat Runtime)     ✅ COMPLETE
Phase B (Research Runtime)      ✅ COMPLETE
Phase 1.5 (Task Cards + Clarifying)  ✅ COMPLETE
Phase 2.0 (Traffic Layering)   ✅ COMPLETE
Sprint 35 (Test Suite Hardening) ✅ COMPLETE
Sprint 36 (Phase 0 Archive)    ✅ COMPLETE (2026-04-19)
Sprint 37 (Phase 1-2)          ✅ COMPLETE (2026-04-19)
Sprint 38 Phase 3 (Worker Loops) ✅ COMPLETE (2026-04-19)
Sprint 38 Phase 4 (Router Retirement) ✅ COMPLETE (2026-04-19)

下一站 → Sprint 38 Auth v1 + Benchmark CI
```

---

## 二、Phase 3.0 核心战略

### 2.1 为什么是 P0

**当前最大技术债**：路由仍由"硬编码规则"驱动（rule-router / complexity-scorer / intent-analyzer），而非模型自判断。

```
现状：                         目标：
用户输入                       用户输入
    ↓                              ↓
[硬编码规则]                    [Fast 模型自判断]
  关键词匹配                      内建知识 → 直接回复
  长度阈值                        需要实时数据 → 调用工具
  复杂度公式                      需要深度推理 → 请求升级 Worker
    ↓                              ↓
  结果不稳定                    结果可解释，可观测，可扩展
```

**根本区别**：
- 硬编码路由：加一个新场景 = 改代码
- LLM-Native 路由：加一个新场景 = 改 prompt 或 tool description

### 2.2 核心理念升级

| 旧理念 | 新理念 |
|--------|--------|
| "快模型提高效率" = 让它也推理 | Fast 只做管理，不做深推理 |
| fast/slow 是任务分类 | Fast/Worker 是处理策略，不是任务属性 |
| prompt 传递上下文 | Archive 共享状态，模型间结构化通信 |
| 继续打磨快慢打分规则 | Fast 自判断 + 结构化 command 协议 |

---

## 三、目标架构：Manager-Worker Runtime

### 3.1 角色分工

| 角色 | 模型 | 职责 | 不负责 |
|------|------|------|--------|
| **Manager** | Fast (Qwen2.5-7B) | 理解请求、决策路径、生成 command、澄清、最终表达 | 深推理、执行 |
| **Analyst Worker** | Slow (Qwen2.5-72B) | 接收 task brief、深度分析、返回结构化结果 | 人格控制、全局状态 |
| **Tool Worker** | Execution Loop | 接收 execute command、调用工具、返回执行结果 | 理解用户意图 |
| **Shared Workspace** | Task Archive (PG) | 存 command / result / confirmed_facts / constraints | — |

### 3.2 通信协议

```
User Request
    │
    ▼
Fast Manager → 读 user memory / style / task state
    │
    ├── L0: direct_answer ──────────────→ 直接回复用户
    ├── L1: 调用 web_search ────────────→ 实时数据 → 汇总表达 → 用户
    ├── L2: 写 Archive + Command ───────→ Slow Worker 查 Archive
    │                                      ↓
    │                               写回 Worker Result
    │                                      ↓
    └──────────────────────────────→ Fast Manager 汇总表达 → 用户
    │
    └── L3: execute_task ───────────────→ Execute Runtime → 结果 → 用户
```

---

## 四、Sprint 规划

### Sprint 38 — Manager-Worker Phase 3 Worker Loops ✅ DONE

**目标**：Worker 执行闭环 + LLM-native SSE Streaming

#### S38-1：Slow Worker Loop ✅ DONE

- `services/phase3/slow-worker-loop.ts`
- 轮询 `task_commands WHERE status=queued AND command_type NOT LIKE 'execute%'`
- 调用 Slow 模型（只读 Archive task_brief，不读 history）
- 写 `task_archives.slow_execution`（供 `pollArchiveAndYield` 感知）
- 写 `task_worker_results`（Phase 3 新表）

#### S38-2：Execute Worker Loop ✅ DONE

- `services/phase3/execute-worker-loop.ts`
- 轮询 `task_commands WHERE command_type IN ('execute_plan','execute_research')`
- 调用 `TaskPlanner.plan()` + `ExecutionLoop.run()`
- 写 `task_archives.slow_execution` + `task_worker_results`

#### S38-3：LLM-native SSE Streaming ✅ DONE

- `chat.ts`：支持 `use_llm_native_routing=true` + `stream=true`
- SSE 事件：`manager_decision` → `clarifying_needed` → `command_issued` → `pollArchiveAndYield`

#### S38-4：Phase 4 旧 Router 降级 ✅ DONE

- `rule-router.ts` / `complexity-scorer.ts` / `intent-analyzer.ts` 均已删除（历史清理）
- `router/router.ts` → lightweight feature extractor
- `router/quality-gate.ts` → 保留，快模型质检兜底

### Sprint 36 — Manager-Worker Phase 0 + Phase 1 ✅ DONE

**目标**：验证 Fast 模型 function calling + 建立 Archive 基础设施

#### S36-1：Fast 模型工具化（Phase 0）

```
改动文件：
- backend/src/models/model-gateway.ts
  → callModelFull() 支持可选 tools 参数
- backend/src/api/chat.ts
  → orchestrator 分支注入 web_search tool
  → 解析 ManagerDecision（tool_calls 返回）

验收：Fast 模型（Qwen2.5-7B）能接收 web_search 工具定义，
     用户问"今天天气" → 模型返回 tool_calls → 正确执行 web_search
```

> ⚠️ **风险**：7B 模型 function calling 不可靠。
> Phase 0 是验证性 Sprint，若失败，降级方案是"特殊标记"（`【SEARCH: query】`）。

#### S36-2：Task Archive 表 + CRUD（Phase 1）

```sql
CREATE TABLE task_archives (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          VARCHAR(64) NOT NULL,
  turn_id             INTEGER NOT NULL,
  
  -- Manager 写入
  manager_decision    JSONB NOT NULL,
  command             JSONB,
  
  -- Clarifying
  clarifications      JSONB DEFAULT '[]',
  confirmed_facts     TEXT[],
  constraints         TEXT[],
  
  -- Worker 写入
  worker_type         VARCHAR(32),
  worker_result       JSONB,
  worker_started_at   TIMESTAMPTZ,
  worker_completed_at TIMESTAMPTZ,
  
  -- 状态
  status              VARCHAR(16) DEFAULT 'pending',
  delivered           BOOLEAN DEFAULT FALSE,
  
  -- 审计
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

```
改动文件：
- backend/src/db/schema.sql（加表 + 索引）
- backend/src/db/repositories.ts（TaskArchiveRepo）
- backend/src/api/archive.ts（6个端点）
- backend/src/types/index.ts（ManagerDecision / CommandPayload / WorkerResult 类型）

验收：POST /v1/archive/tasks → GET /v1/archive/tasks/:id 往返一致
```

#### S36-3：Phase 0 验证报告 + 决策点

基于 S36-1 结果，决定 Sprint 37 走哪条路：
- **路径 A**：7B function calling 稳定 → 按 SPEC Phase 2 实施
- **路径 B**：7B 不稳定 → 特殊标记方案替代，同样完成 Phase 2 目标

---

### Sprint 37 — Manager-Worker Phase 2-4 ✅ DONE

**目标**：完成 Prompt 改造 + Fast/Slow 结构化通信 + 清理硬编码文件

#### S37-1：Fast Manager Prompt 改造（Phase 2）

将 Fast 模型改造为自判断 Manager：
```
【决策规则】
1. 闲聊/打招呼/情绪表达 → 直接回复，1-2句
2. 需要实时数据 → 调用 web_search 工具
3. 需要多步复杂推理 → 输出 JSON command，请求 Slow
4. 其他 → 内建知识直接回答

【输出格式】
必须输出 ManagerDecision JSON，字段：decision_type / routing_layer / reason / confidence / needs_archive
```

#### S37-2：Slow Worker 委托协议（Phase 2 续）

- Fast 输出 JSON command → 写入 Task Archive
- 后台启动 Slow → Slow 主动查 Archive
- 自适应轮询 loop（2s/3s/5s）
- 超时安抚消息（30s/60s/120s）

#### S37-3：Slow 只读 Archive（Phase 3）

**最关键的一刀**。

变更前（Slow 接收）：system prompt + full history + memory + evidence + tools + task summary

变更后（Slow 接收）：worker system prompt + task brief + selected evidence + confirmed facts + constraints + output schema

#### S37-4：Fast 回收最终表达权（Phase 3 续）

- worker 输出只给 manager，manager 再输出给用户
- 前端展示 manager/worker 分工链路（SSE 事件升级）

#### S37-5：Streaming SSE 路径同步（Phase 4）

- streaming 分支注入 web_search 工具
- SSE 事件携带 manager_decision / command_issued / worker_progress

#### S37-6：清理旧 router 三件套（Phase 4）

- 删除：`rule-router.ts` / `complexity-scorer.ts` / `intent-analyzer.ts`
- 降级为 fallback 层，永远保留兜底
- tsc --noEmit 零错误

---

### Sprint 38 — 质量收口 + Auth v1

**目标**：生产可用前提——完整 Auth + Benchmark CI

#### S38-1：Auth v1（JWT/Session）

```
改动：
- 引入 JWT 验证中间件（不改动 getContextUserId 接口）
- ALLOW_DEV_FALLBACK 仅 dev 环境开启
- 测试：401 路径、token 过期路径

验收：生产环境无法伪造 user_id
```

#### S38-2：Benchmark CI Job

```yaml
# .github/workflows/ci.yml 新增 job
benchmark:
  needs: [test-r1, test-repos]
  steps:
    - name: Start backend
      run: npm run dev --prefix backend &
    - name: Wait for ready
      run: sleep 5
    - name: Run benchmark
      run: npm run benchmark --prefix backend
    - name: Check results
      run: node -e "
        const r = require('./evaluation/results/latest.json');
        if (r.summary.pass_rate < 0.5) process.exit(1);
      "
```

#### S38-3：Evidence 来源补全

- http_request 工具调用 → 写入 evidence
- manual evidence 写入 API

---

### Sprint 39（可选）— 前端增强

| 卡片 | 描述 |
|------|------|
| Memory UI 面板 | 前端 Memory 管理界面（查看/编辑/删除） |
| Clarifying UX | clarifying SSE → 前端弹窗选项 |
| Layer 3 Execute 前端入口 | execute 模式前端触发按钮 |
| Archive 可视化 | Task Archive 状态追踪面板 |

---

## 五、优先级总矩阵

| 优先级 | Sprint | 卡片 | 价值 | 风险 |
|-------|--------|------|------|------|
| **P0** | 36 | Fast 模型 function calling 验证 | 架构基础 | 7B 不可靠 |
| **P0** | 36 | Task Archive 建表 + CRUD | 架构基础 | 低 |
| **P0** | 37 | Fast Manager Prompt 改造 | 核心能力 | 中 |
| **P0** | 37 | Slow Worker 委托协议 | 核心能力 | 中 |
| **P0** | 37 | Slow 只读 Archive | 核心能力 | 中 |
| **P0** | 37 | 清理硬编码路由三文件 | 技术债还清 | 低 |
| **P1** | 38 | Auth v1（JWT） | 生产必需 | 中 |
| **P2** | 38 | Benchmark CI Job | 质量保障 | 低 |
| **P2** | 38 | Evidence 来源补全 | 完整性 | 低 |
| **P3** | 39 | 前端增强（Clarifying UX / Execute 入口） | 体验 | 低 |
| **P4** | 39 | Memory UI 面板 | 体验 | 低 |

---

## 六、验收里程碑

### Milestone 1：Manager-Worker Runtime 上线（Sprint 37 完成后）✅ COMPLETE

- [x] Fast 模型自判断路由（不经硬编码规则）✅
- [x] `use_llm_native_routing=true` → ManagerDecision JSON 路由 ✅
- [x] 用户问复杂问题 → Fast 写 Archive → 委托 Slow Worker → SSE 推送结果 ✅
- [x] Slow Worker 只读 Archive（优先），必要时可读 history ✅
- [x] `execute_task` → Execute Worker → ExecutionLoop ✅
- [x] 硬编码三文件已删除（降级 fallback），tsc 零错误 ✅
- [x] 所有 172 tests 继续全绿 ✅

### Milestone 2：生产可用（Sprint 38 完成后）

- [ ] Auth v1 上线，X-User-Id 无法伪造
- [ ] Benchmark CI Job 自动运行（routing ≥ 50%）
- [ ] Evidence 来源完整（web_search + http_request）

### Milestone 3：用户体验完善（Sprint 39 完成后）

- [ ] Clarifying 流程前端弹窗完整集成
- [ ] Execute 模式可从前端触发
- [ ] Memory UI 面板可用

---

## 七、架构演进图

```
当前状态（Sprint 35）                 目标状态（Sprint 37）
─────────────────────────────────    ─────────────────────────────────
用户输入                              用户输入
    ↓                                    ↓
[硬编码路由规则]  ← 技术债             [Fast Manager 自判断]  ← 删硬编码
  rule-router                            ManagerDecision JSON
  complexity-scorer                      routing_layer 升级为：
  intent-analyzer                          L0: 直接回复
    ↓                                      L1: 调用 web_search
Fast 模型（无工具）                      L2: 写 Archive → 委托 Worker
    ↓                                      L3: execute_task
Slow 模型（接截断上下文）                 ↓
                                      Task Archive (PostgreSQL)
                                           ↕ 共享工作台
                                      Slow Worker（主动查 Archive）
                                      只读 task brief + evidence
                                           ↓
                                      Fast Manager 汇总表达 → 用户
```

---

## 八、风险矩阵

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| Qwen2.5-7B function calling 不可靠 | 中 | 高 | Sprint 36 Phase 0 先验证；失败降级特殊标记方案 |
| Fast Manager 把任务整理错（压缩时丢关键信息） | 中 | 高 | command schema 强制字段；保留 source_excerpt；允许 worker 回 ask_for_more_context |
| schema 漂移（模型 JSON 输出不稳定） | 中 | 中 | function calling / json schema；严格校验；不合法时 fallback 旧链路 |
| Archive 写入时序问题 | 低 | 中 | 明确 task state machine；每次 delegation 有 command_id；SSE 与 DB 状态一致 |
| 开发期间双中枢（新老并存） | 高 | 中 | 明确 feature flag；新架构先覆盖部分流量；benchmark 分开 old/new |
| 删硬编码文件引发回归 | 中 | 高 | 删前确保 207 tests 全绿；删后再跑 tsc + tests |

---

## 九、为什么不继续打磨 fast/slow 精细打分

### 不建议继续深挖的方向
- 继续往 `rule-router.ts` 里加分支
- 继续调 `complexity_score > xx` 阈值
- 继续靠更多正则和关键词补洞
- 把 fast/slow 看成最终目标

这些可以短期止血，但不值得继续重投入。

### 根本原因

**用户请求不是离散类别，而是连续光谱。**

同样是"翻译"：
- "hello 怎么翻译" → 很简单
- "把这段投标文件译成正式商务英文，保留法律语义" → 很复杂

**"快/慢"不是任务属性，而是处理策略。**

系统该决策的不是"这是 fast 还是 slow"，而是"这个请求下一步最省、最稳的处理路径是什么"。

---

## 十、执行原则（不变）

1. **先 benchmark，再改规则** — Sprint 36 Phase 0 先验证 7B function calling
2. **先收口主干质量，再扩功能面** — Sprint 36/37 先完成 Manager-Worker，再做前端增强
3. **统一数据结构，减少隐式兼容** — Archive 作为唯一事实源
4. **模型选择按能力，不按名字写死** — Fast/Slow 通过 config 配置，不硬编码
5. **每 sprint 必须有：交付清单 / 已知问题 / benchmark 结果 / 下一优先级**

---

_规划日期：2026-04-19 | by 蟹小钳 🦀_
_关联：`PHASE-3-MANAGER-WORKER-SPEC.md` / `LLM-NATIVE-ROUTING-SPEC.md` / `SYSTEM-STATUS-REPORT.md`_
