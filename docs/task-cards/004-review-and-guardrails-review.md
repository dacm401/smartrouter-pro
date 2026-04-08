# MC-004 Review: Review + Guardrails

## ✅ Acceptance Criteria Checklist

| Criteria | Status |
|---|---|
| All guardrails enforced in API layer and assembler | ✅ |
| `docs/runtime-flow.md` reflects Memory v1 injection path | ✅ |
| `docs/repo-map.md` includes memory API routes | ✅ |
| 3 review docs exist for MC-001/002/003 | ✅ |
| This review doc (MC-004) exists | ✅ |
| TypeScript build passes | ✅ |

---

## 📦 Guardrails Summary

### API-layer guardrails (MC-004, added to `backend/src/api/memory.ts`)

| Guard | Rule | POST | PUT |
|---|---|---|---|
| `content` max length | 2000 characters | ✅ | ✅ |
| `importance` range | 1–5, coerced to nearest boundary | ✅ | ✅ |
| `tags` count | max 10 per entry | ✅ | ✅ |
| `tags` per-item length | max 50 characters per tag | ✅ | ✅ |
| List `limit` | max 100 per request | ✅ | — |

### Assembler-layer guardrails (MC-003, `backend/src/services/prompt-assembler.ts`)

| Guard | Rule |
|---|---|
| Injection entries | max `config.memory.maxEntriesToInject` (default 5) |
| Injection tokens | hard cap `maxEntriesToInject × maxTokensPerEntry` = 750 tokens |
| Kill switch | `MEMORY_INJECTION_ENABLED=false` env var |

---

## 📄 Documentation Updates

### `docs/runtime-flow.md` (updated in MC-004)

Changes made:
- Header updated: "Last verified: Sprint 03 MC-004"
- High-level flow diagram: added Step 4b (memory injection) + `/v1/memory` routes block
- Step 4 (Prompt Assembly): documented memory injection path, kill switch, token budget
- Section 6 — Memory API Routes: all 5 endpoints with request/response shapes and guardrail table
- File/module map: added `memory.ts`
- Data touchpoints: added Memory v1 section with CRUD paths + injection path
- Future Cleanup Notes: P1 `taskSummary` item marked ✅ Done
- Bottom timestamp updated

### `docs/repo-map.md` (updated in MC-004)

Changes made:
- API Routes: added `src/api/memory.ts`
- Repositories: added `MemoryEntryRepo` with method list and `memory_entries` table description
- Runtime Flow Summary: added `MemoryEntryRepo.getTopForUser()` + `prompt-assembler.ts` taskSummary injection step

---

## 📋 All 4 MC Review Docs

| Card | Review Doc |
|---|---|
| MC-001 | `001-memory-data-model-and-repository-review.md` ✅ |
| MC-002 | `002-memory-crud-apis-review.md` ✅ |
| MC-003 | `003-memory-prompt-injection-review.md` ✅ |
| MC-004 | `004-review-and-guardrails-review.md` ✅ (this file) |

---

## 🧭 Guardrails Design Decisions

### Why enforce at API layer, not repo layer
- `content` length and `tags` constraints are request-level validity concerns, not data integrity concerns
- Repo layer is responsible for data access and persistence; input validation belongs at the API boundary
- Keeping validation at API layer keeps the repo portable

### Why not add injection-level relevance filtering
- Current selection is by `importance DESC, updated_at DESC` — simple and predictable
- Semantic/relevance filtering would require embedding models or external retrieval service
- That's future work (post-Memory-v1)

### Why `memory_entries` over `memory_tags` for v1
- TEXT[] is native PostgreSQL; no join overhead for v1 scale
- Can be extracted into a separate table later when tag-specific queries become necessary
- Premature optimization avoided

---

## 🚫 Non-Goals (Not Done)

- Load testing
- Multi-user isolation beyond `user_id`
- Performance optimization of memory reads
- Semantic/relevance filtering for injection
- Auto-extraction from chat history
- Memory conflict resolution

---

## 🔗 Sprint 03 Completion Summary

| Card | Description | Commit | Status |
|---|---|---|---|
| MC-001 | `memory_entries` schema + `MemoryEntryRepo` | `483a36b` | ✅ |
| MC-002 | 5 CRUD endpoints + mount `/v1/memory` | `50a0cf4` | ✅ |
| MC-003 | Memory prompt injection + token budget | `ac44427` | ✅ |
| MC-004 | Guardrails + documentation + review docs | (this card) | ✅ |

Sprint 03 is complete.
