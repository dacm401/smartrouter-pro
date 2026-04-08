# MR-004 Review — Review + Guardrails

## Card
**MR-004: Review + Guardrails**

## Result
Completed

---

## Goals
Close out Sprint 04 with a full regression check, guardrail audit, documentation sync, and formal sprint archival.

---

## What Was Done

### 1. Regression Review

Checked the entire Memory v2 retrieval + injection path for regressions:

| Scenario | Expected behaviour | Result |
|---|---|---|
| `strategy=v1` | Flat `importance DESC, updated_at DESC` ordering; `[category] content` flat format | ✅ Preserved — v1 path returns raw `getTopForUser()` results |
| `strategy=v2` | Retrieval pipeline active; category-grouped output | ✅ Preserved — `runRetrievalPipeline()` called when `strategy === "v2"` |
| `memory.enabled=false` | No DB reads, no memory in prompt | ✅ Preserved — `config.memory.enabled` gate exists |
| v2 returns empty | Falls back to v1 results | ✅ Preserved — explicit fallback in chat.ts |
| Empty user message | Keyword score = 0; importance + recency only | ✅ Preserved — `extractTokens([])` returns `[]` → Jaccard = 0 |
| Long memory content | Jaccard normalisation prevents inflation | ✅ Preserved — `computeKeywordRelevance()` uses `|intersection| / |union|` |
| TypeScript build | Zero errors | ✅ |

### 2. Guardrail Audit

| Guard | Mechanism | Status |
|---|---|---|
| `content` length | API layer in `memory.ts` | ✅ Enforced: 2000 char max |
| `importance` range | API layer validation | ✅ Enforced: coerced to 1–5 |
| `tags` count | API layer | ✅ Enforced: max 10 per entry |
| `tags` length | API layer | ✅ Enforced: max 50 chars per tag |
| List `limit` | API layer | ✅ Enforced: max 100 per request |
| Injection entries | `config.memory.maxEntriesToInject` | ✅ Enforced: 5 entries max |
| Injection tokens | `prompt-assembler.ts` `maxTaskSummaryTokens` | ✅ Enforced: 750 tokens max |
| Relevance score inflation | `computeKeywordRelevance()` Jaccard normalisation | ✅ Enforced: score bounded by formula |
| Strategy enum | `config.memory.retrieval.strategy: "v1" \| "v2"` | ✅ Enforced: TypeScript enum |
| Category policy | `config.memory.retrieval.categoryPolicy` | ✅ Config-driven, not hard-coded |

### 3. Documentation Sync

**`docs/runtime-flow.md`:**
- Updated `Last verified` to Sprint 04 MR-004
- Step 4 expanded with full Memory v2 retrieval pipeline (MR-001/002/003)
- Data Touchpoints → Memory v2 section updated with v1/v2 injection paths
- Memory API Guardrails table expanded with v2 scoring limits
- File/Module Map → `memory-retrieval.ts` added to services
- Known Quirks Q4 updated to reflect v2 retrieval cost
- Suggested Future Cleanup updated: P2 v2 upgrade item added, P3 semantic retrieval noted for v3
- Footer updated

**`docs/repo-map.md`:**
- `memory-retrieval.ts` added to Services section
- Runtime Flow Overview updated with v2 retrieval pipeline steps
- `MemoryEntryRepo` notes expanded to mention the v2 retrieval layer

---

## Scope Boundary

- **No new features introduced** — MR-004 is purely a review and documentation card
- **No schema changes** — `memory_entries` table unchanged
- **No new API endpoints** — all existing endpoints unchanged
- **No embedding / semantic search** — deferred to Memory v3

---

## Memory v2 Capability Summary (Sprint 04 Final State)

| Layer | v1 (Sprint 03) | v2 (Sprint 04) |
|---|---|---|
| Retrieval | `importance DESC, updated_at DESC` | `runRetrievalPipeline()` with category policy |
| Scoring | None | Importance (30) + Recency (20) + Keyword relevance (15) = max 65 |
| Keyword matching | Raw token overlap | Stopword-filtered + stemming + Jaccard normalised |
| Prompt format | Flat `[category] content` | Category-grouped sections with human-readable labels |
| Strategy toggle | None | `memory.retrieval.strategy: v1 \| v2` |
| Fallback | N/A | v2 empty → falls back to v1 results |
| Explainability | Minimal | `reason` string on every scored result |

---

## Memory v2 Known Limitations

- **Lexical relevance only** — no embeddings, vectors, or semantic similarity
- **No auto-extraction** — memories must be manually created via API
- **Category schema fixed** — `instruction`/`preference`/`fact`/`context` (no `goal`/`constraint`)
- **No conflict resolution** — multiple memories on same topic not deduplicated
- **No TTL / expiration** — memories persist indefinitely
- **No evidence attribution** — injected memories are treated as facts
- **v2 scoring is heuristic** — not learned or tuned on feedback data

---

## Deferred to Future Sprints

| Item | Direction |
|---|---|
| Semantic relevance scoring | Memory v3: embedding-based retrieval |
| Memory auto-extraction | From conversation history or feedback signals |
| Category schema expansion | `goal`/`constraint` differentiation |
| Memory conflict resolution | Deduplication / merge policy |
| Retrieval quality feedback loop | Tune weights from decision outcomes |
| TTL / memory expiration | Time-based memory retirement |
| Batch caching for `getTopForUser()` | Request-level cache to reduce DB reads |

---

## MR-004 Assessment

This was the correct final card for Sprint 04. The core functionality was delivered in MR-001/002/003. MR-004's value was in:
1. Making the regression surface explicit and verified
2. Consolidating all Memory v2 changes into the main documentation
3. Creating a clear record of what v2 is, what it is not, and where it goes next

The sprint closed with a well-documented, tested, and bounded Memory v2 capability.
