# Current Sprint

**Sprint 34 — L1 Benchmark 扩测 + 路由规则调优**
**Status:** 🔄 In Progress — 2026-04-18

---

## Task Cards

| Task Card | Description | Status |
|---|---|---|
| S34-1 | 补齐 L1 路由 benchmark 用例（L0:20 / L1:10 / L2:36） | ✅ Done |
| S34-2 | tsc --noEmit 验证（0 errors） | ✅ Done |
| S34-3 | current-sprint.md 更新为 Sprint 34 | ✅ Done |
| S34-4 | Benchmark CI 验证（L1 层准确率分析） | ⏳ Pending（需服务器） |

---

## Sprint 33 Summary

**Phase 2.0 流量分级上线完成。** 三层路由（L0/L1/L2）从内部实现正式暴露为可观测、可评测的生产级功能。

核心交付：
- `routing_layer` 字段覆盖全部 SSE 事件类型（fast_reply / clarifying / chunk / status / result / error / done）
- `/api/chat/eval/routing` 端点返回 `routing_layer`
- `inferRoutingLayer()` 逻辑覆盖 L0/L1/L2/L3 全路径
- Phase 1.5 Clarifying 流程 + Phase 1 直接回复路径零回归
- `docs/PHASE-2-ROUTING-PLAN.md` 完整架构文档

---

## Sprint 32 — Completed ✅

**Phase 1.5 任务卡片 + Clarifying 流程 + Slow 只读优化**
- Commits: `7574415`, `e1223b3`, `51bb297`, `aff2ac5`, `eb9dbc7`, `6e29011`
- Phase 1.5 任务卡片 Schema（task_type / task_brief / state）
- Phase 1.5 Clarifying 流程（CLARIFYING_STATE + SSE clarifying 事件）
- Phase 1.5 Slow 只读优化（Task Brief JSON 格式）
- Memory/Evidence 效果增强（intent-aware boost + retrieveEvidenceForContext）
- SSE done 事件两路推送 + SSEEvent stream 字段统一

---

## Sprint 07 — Completed and Closed ✅

See `docs/sprint-07-review.md`

---

## Sprint 06 — Completed and Closed ✅

See `docs/sprint-06-review.md`

---

## Sprint 05 — Completed and Closed ✅

See `docs/sprint-05-review.md`
