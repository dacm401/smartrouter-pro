# Task Card 005: Repo Structure Audit and Target Layout

## Status
Audit Complete

---

## Current Structure Assessment

```
src/
  api/              ✅ 清晰：chat.ts, tasks.ts, dashboard.ts
  context/          ✅ 清晰：compressor.ts, context-manager.ts, token-budget.ts
  db/               ✅ 清晰：connection.ts, repositories.ts, schema.sql
  evolution/        ⚠️ 问题：目录名暗示"学习进化系统"，实际多为占位
  models/           ✅ 清晰：model-gateway.ts, token-counter.ts, providers/
  observatory/     ⚠️ 问题：日志+监控职责混在同一目录
  router/           ✅ 清晰：router.ts, intent-analyzer.ts, rule-router.ts 等
  services/         ✅ 清晰，目前只有 prompt-assembler.ts
  types/            ✅ 清晰：index.ts
  config.ts         ✅
  index.ts          ✅
```

---

## Problem Areas

### 1. `evolution/` — 命名过大，内容不足
- `learning-engine.ts` 有 SQL bug，且实际功能仅是写 trace，无真正学习逻辑
- `memory-store.ts` 属于 context 层概念，不应在 evolution 下
- `feedback-collector.ts`、`growth-tracker.ts` 均为占位文件
- **影响**：误导后续开发者对此模块的预期

### 2. `observatory/` — 职责混在一处
- `decision-logger.ts` → 属于可观测性/日志
- `metrics-calculator.ts` → 属于指标/监控
- **影响**：随着可观测性功能增长，此目录会越来越乱

### 3. `services/` — 目前极薄
- 只有 `prompt-assembler.ts` 一个文件
- 后续 memory/evidence 功能会向这里扩展，需提前规划边界

### 4. `dashboard.ts` — 属于前端资产混入后端
- `src/api/dashboard.ts` 内容为前端 HTML，应移到 `frontend/` 或 `public/`
- **影响**：非阻塞，但会造成后端职责蔓延

### 5. `context/` vs `services/` 边界模糊
- `context-manager.ts` 是服务，理论上可在 services/ 下
- 当前放在 context/ 是合理的，但需与未来 memory-store 明确边界

---

## Proposed Target Structure

```
src/
  api/                    ✅ 不变
    chat.ts
    tasks.ts
    dashboard.ts          → 后续移到 frontend/ 或 public/（move-later）

  services/                📍 扩展为核心业务服务区
    prompt-assembler.ts    ✅ 已在此
    context-manager.ts     → 建议从 context/ 移入（move-now）
    # future:
    # memory-manager.ts
    # evidence-manager.ts

  router/                  ✅ 不变

  models/                  ✅ 不变
    model-gateway.ts
    token-counter.ts
    providers/

  db/                      ✅ 不变
    connection.ts
    repositories.ts
    schema.sql

  observatory/             📍 重命名为 logging/（move-now）
    decision-logger.ts     ✅ 保留
    # metrics-calculator.ts → 未来独立或移入 logging/（move-later）

  evolution/               ⚠️ 重命名为 features/ 或 experimental/（move-now）
    feedback-collector.ts  → 占位，标记 @stub
    growth-tracker.ts      → 占位，标记 @stub
    learning-engine.ts     → 清理 bug 或标记 @stub
    memory-store.ts        → 移到 services/memory-store.ts（move-now）

  types/                   ✅ 不变

  config.ts                ✅ 不变
  index.ts                 ✅ 不变
```

---

## Move-Now Items

| Item | From | To | Reason |
|------|------|-----|--------|
| `context-manager.ts` | `context/` | `services/` | 属于服务职责，非纯 context 概念 |
| `memory-store.ts` | `evolution/` | `services/` | 属于 memory manager 范畴，与 learning 无关 |
| `decision-logger.ts` | `observatory/` | `logging/` | observatory 名过重，日志才是核心 |
| `observatory/` | — | `logging/` | 目录重命名，减少恐惧感 |
| `evolution/` | — | `features/` | 目录重命名，表明是实验性功能区 |
| `metrics-calculator.ts` | `observatory/` | `logging/` 暂存 | 与 decision-logger 同属性 |

**理由**：以上 6 项均为重命名或小范围移动，不改变行为，改动风险低，但能显著改善目录可读性。

---

## Move-Later Items

| Item | Reason | Blocker |
|------|--------|---------|
| `dashboard.ts` | 属于前端资产 | 需确认 frontend/ 结构 |
| `learning-engine.ts` | 需先确认功能边界 | 等 Memory v1 Sprint 明确需求 |
| `feedback-collector.ts` | 占位，暂无引用 | 等 feature 规划明确 |
| `growth-tracker.ts` | 占位，暂无引用 | 等 feature 规划明确 |

---

## Risks

1. **import 断裂**：`context-manager.ts` 移入 `services/` 后，`context/` 内其他文件（`compressor.ts`, `token-budget.ts`）的 import 路径需同步更新
2. **observatory → logging 重命名**：若有其他文件引用 `../observatory/`，需同步更新
3. **evolution → features 重命名**：影响所有相关 import
4. **决策影响范围**：以上移动均需跑全回归确认 /api/chat 不回归

---

## Acceptance Criteria (TC-005 Complete ✓)

- [x] current structure documented
- [x] target structure proposed
- [x] move-now items identified (6 items)
- [x] move-later items identified (4 items)
- [x] risks listed
