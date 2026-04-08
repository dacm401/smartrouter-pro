# Repo Map

## Backend Key Areas

### API Routes
- `src/api/chat.ts` — POST /api/chat
- `src/api/tasks.ts` — task list/detail/summary/traces routes

### Services
- `src/services/prompt-assembler.ts` — prompt assembly for direct/research modes
- `src/services/memory-store.ts` — memory storage for future Memory v1
- `src/services/context-manager.ts` — context compression and message assembly
- `src/router/router.ts` — model routing and intent classification
- `src/models/model-gateway.ts` — model call orchestration
- `src/logging/decision-logger.ts` — decision logging (known SQL bug)
- `src/features/learning-engine.ts` — learning from interactions (stub)

### Repositories / Data Access
- `src/db/repositories.ts` — TaskRepo (create, getAll, getById, getSummary, getTraces, etc.)

### Docs
- `docs/current-sprint.md` — active sprint
- `docs/sprint-01-review.md` — sprint 01 retrospective
- `docs/next-sprint-proposal.md` — next sprint direction
- `docs/dev-rules.md` — development conventions
- `docs/backlog.md` — known issues
- `docs/task-cards/` — feature and cleanup cards

## Runtime Flow Overview

```
POST /api/chat
  → chat.ts: parse request, create task record
  → router.ts: classify intent + complexity, select model
  → prompt-assembler.ts: assemble system prompt by mode
  → context-manager.ts (services/): compress history, inject system prompt
  → model-gateway.ts: call selected model
  → decision-logger.ts: write decision trace (known SQL bug — non-blocking)
  → chat.ts: write response trace, return { message, decision }
```

```
GET /v1/tasks/all
  → tasks.ts: route handler
  → TaskRepo.getAll(user_id)

GET /v1/tasks/:id
  → tasks.ts: route handler
  → TaskRepo.getById(task_id)

GET /v1/tasks/:id/summary
  → tasks.ts: route handler
  → TaskRepo.getSummary(task_id)

GET /v1/tasks/:id/traces
  → tasks.ts: route handler
  → TaskRepo.getTraces(task_id)
```

## Notes
- update this file whenever major modules are moved
- backend runs in Docker container: smartrouter-pro-backend-1
- backend port: 3001
- actual chat endpoint is /api/chat (not /v1/chat)
- task list endpoint filters by user_id — must pass user_id query param
