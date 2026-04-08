# Repo Map

## Backend Key Areas

### API Routes
- `src/api/chat.ts` — POST /api/chat
- `src/api/tasks.ts` — task list/detail/summary/traces routes
- `src/api/memory.ts` — Memory v1 CRUD: POST/GET/PUT/DELETE /v1/memory

### Services
- `src/services/prompt-assembler.ts` — prompt assembly for direct/research modes
- `src/services/memory-store.ts` — memory storage for future Memory v1
- `src/services/context-manager.ts` — context compression and message assembly
- `src/router/router.ts` — model routing and intent classification
- `src/models/model-gateway.ts` — model call orchestration
- `src/logging/decision-logger.ts` — decision logging (known SQL bug)
- `src/features/learning-engine.ts` — learning from interactions (stub)

### Repositories / Data Access
- `src/db/repositories.ts` — TaskRepo, DecisionRepo, MemoryRepo, GrowthRepo, MemoryEntryRepo
  - `MemoryEntryRepo`: create, getById, list, update, delete, getTopForUser
  - `memory_entries` table: user-scoped, supports preference/fact/context/instruction categories

### Docs
- `docs/current-sprint.md` — active sprint
- `docs/sprint-01-review.md` — sprint 01 retrospective
- `docs/next-sprint-proposal.md` — next sprint direction
- `docs/dev-rules.md` — development conventions
- `docs/backlog.md` — known issues
- `docs/task-cards/` — feature and cleanup cards

## Runtime Flow Overview

Full runtime flow documented in: **`docs/runtime-flow.md`**

Brief summary:

```
POST /api/chat
  → chat.ts: parse request, create task record
  → router.ts: classify intent + complexity, select model
  → MemoryEntryRepo.getTopForUser() — Sprint 03 MC-003: fetch top memories (config-gated)
  → prompt-assembler.ts: assemble system prompt by mode + taskSummary injection
  → context-manager.ts (services/): compress history, inject system prompt
  → model-gateway.ts: call selected model
  → quality-gate.ts: fast-path quality check + fallback if needed
  → decision-logger.ts: write decision trace (known SQL bug — non-blocking)
  → learning-engine.ts: implicit feedback + memory learning (fire-and-forget)
  → TaskRepo: write execution stats + 3 traces (fire-and-forget)
  → chat.ts: return { message, decision }
```

See **`docs/runtime-flow.md`** for the complete step-by-step walkthrough, file map, data touchpoints, and known quirks.

## Notes
- update this file whenever major modules are moved
- backend runs in Docker container: smartrouter-pro-backend-1
- backend port: 3001
- actual chat endpoint is /api/chat (not /v1/chat)
- task list endpoint filters by user_id — must pass user_id query param
