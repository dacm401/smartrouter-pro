# EL-004 Review: Tool Guardrails + External API Safety

**Card:** EL-004 — Tool Guardrails + External API Safety
**Status:** ✅ Done
**Commit:** pending

---

## 验收结果

| 事项 | 状态 |
|---|---|
| `ToolGuardrail` class with `validate()` method | ✅ |
| `http_request`: host allowlist check | ✅ |
| `http_request`: HTTPS-only enforcement | ✅ |
| `http_request`: blocked headers rejection | ✅ |
| `http_request`: response size limit (1 MB default) | ✅ |
| `http_request`: timeout enforcement (10s default) | ✅ |
| `web_search`: query length limit (500 chars) | ✅ |
| `web_search`: max_results cap (10) | ✅ |
| `GuardrailRejection` class | ✅ |
| `executor` re-throws `GuardrailRejection` → loop aborts | ✅ |
| Guardrail decision audit trace (`type: "guardrail"`) | ✅ |
| External tool stubs replaced with real HTTP implementations | ✅ |
| `web_search` stub with `WEB_SEARCH_ENDPOINT` env var | ✅ |
| Guardrail config (`HTTP_ALLOWLIST`, `GUARDRAIL_ENABLED`, etc.) | ✅ |
| TypeScript build | ✅ |

---

## 产出文件

| 文件 | 描述 |
|---|---|
| `backend/src/services/tool-guardrail.ts` | ToolGuardrail class，http_request / web_search 校验逻辑，audit trace |
| `backend/src/tools/executor.ts` | GuardrailRejection，外部工具真实实现，guardrail 预检 |
| `backend/src/config.ts` | guardrail 配置段落 |
| `docs/task-cards/004-tool-guardrails-review.md` | 本文档 |

---

## 架构：防御分层

```
ExecutionLoop.run()
  → toolExecutor.execute(call, ctx)
      → handler(http_request / web_search)
          → toolGuardrail.validate()
          → GuardrailRejection thrown? → re-throw → loop aborts
          → [actual HTTP call]
      → result returned
```

两层防御：
- **executor 处理器层**：guardrail.validate() 在 handler 内，GuardrailRejection re-throw，loop aborts
- **ExecutionLoop step 层**：try/catch 捕获异常，step 标记 failed，loop 终止

---

## http_request 校验策略

| 检查项 | 逻辑 |
|---|---|
| URL 格式 | `new URL()` 可解析 |
| 协议 | HTTPS only |
| Host 白名单 | Fail-closed（空名单 = 全拒） |
| Blocked headers | authorization / cookie / x-api-key 等 |
| 响应大小 | max 1 MB，截断超长响应 |
| 超时 | 10s AbortController |

---

## web_search 校验策略

| 检查项 | 逻辑 |
|---|---|
| Query 非空 | 拒绝空 query |
| Query 长度 | max 500 字符 |
| max_results | cap at 10 |

---

## 审计 Trace

所有决策（允许 + 拒绝）写入 `task_traces`，type = `"guardrail"`。

---

## Sprint 05 完成状态

| Task Card | Commit | 状态 |
|---|---|---|
| EL-001 Tool Definition + Registry | `8d1079d` | ✅ Done |
| EL-002 Task Planner | `e491917` + `3894c3a` | ✅ Done |
| EL-003 Execution Loop | `086b937` | ✅ Done |
| EL-004 Tool Guardrails | pending | ✅ Done |

**Sprint 05 全部四张卡片完成。**
