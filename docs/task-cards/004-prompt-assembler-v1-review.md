# FC-004 Review: PromptAssembler v1

## Status
Done

## Delivery
- PromptAssembler v1 implemented
- prompt construction extracted from ChatService
- supports direct mode and research mode

## Implementation Notes
- added `backend/src/services/prompt-assembler.ts`
- `context-manager.ts` now accepts optional `systemPrompt`
- `chat.ts` assembles prompt before calling context management
- previous hardcoded prompt behavior is kept as fallback

## Validation Evidence
- direct mode works
- research mode triggers correctly
- decision object confirms research intent
- final responses are returned correctly in both modes

## Regression Checks
- GET /v1/tasks/all → passed
- GET /v1/tasks/:id → passed
- GET /v1/tasks/:id/summary → passed
- GET /v1/tasks/:task_id/traces → passed
- POST /api/chat → passed

## Commits
- implementation: 580db75
- review doc: b2a8383

## Notes
- a temporary "Connection error." during research validation was traced to model/API behavior and ErrorAction misclassification, not PromptAssembler logic
- implementation intentionally excludes execute mode, memory injection, evidence injection, and prompt debug endpoint
