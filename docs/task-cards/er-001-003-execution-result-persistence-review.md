# ER-001~ER-003 Review: Execution Result Memory Persistence

**Commits:** pending
**Status:** ✅ Completed
**Date:** 2026-04-08

---

## Delivery Verdict

**Completed ✅**

ER-001 (decision-logger verification), ER-002 (data model + repo), and ER-003 (write path) all delivered.

---

## Task Cards Delivered

| Card | Description | Status |
|---|---|---|
| ER-001 | Decision-Logger SQL verification | ✅ Verified no bug |
| ER-002 | execution_results table + types + repo | ✅ Done |
| ER-003 | Write path in chat.ts | ✅ Done |
| ER-004 | Review doc + docs update | ✅ Done |

---

## ER-001: Decision-Logger SQL — No Bug Found

**Conclusion: No fix required.**

The original backlog entry claimed `INSERT INTO decision_logs` had 27 fields but only 26 placeholders ($1–$26), causing `syntax error at end of input` on every request.

Verification result: **code is correct**. Both the initial commit (`21be0dd`) and current HEAD have 27 columns, 27 `$N` placeholders, and 27 params — all aligned. The error is caught by the try/catch wrapper so the system never crashes; decision logs simply fail silently.

This was a misfiled backlog entry. No code change was needed.

---

## ER-002: Data Model and Repository

### Table: `execution_results`

```sql
CREATE TABLE IF NOT EXISTS execution_results (
  id                  VARCHAR(36) PRIMARY KEY,
  task_id             VARCHAR(36),
  user_id             VARCHAR(36) NOT NULL,
  session_id          VARCHAR(36) NOT NULL,
  final_content       TEXT,
  steps_summary       JSONB,
  memory_entries_used TEXT[]     DEFAULT '{}',
  model_used          VARCHAR(100),
  tool_count          INTEGER    DEFAULT 0,
  duration_ms         INTEGER,
  reason              VARCHAR(50),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

Indexes:
- `idx_er_user_time (user_id, created_at)`
- `idx_er_task (task_id)`

### TypeScript Types

New types added to `backend/src/types/index.ts`:

- `ExecutionStepSummary` — lightweight step record: `{ index, title, type, status, tool_name?, error? }`
- `ExecutionStepsSummary` — full steps JSONB: `{ totalSteps, completedSteps, toolCallsExecuted, steps[] }`
- `ExecutionResultRecord` — row shape returned from DB reads
- `ExecutionResultInput` — shape passed to `ExecutionResultRepo.save()`

### Repository: `ExecutionResultRepo`

Three methods in `backend/src/db/repositories.ts`:

- `save(input)` — INSERT and return the new record
- `getByTaskId(taskId)` — fetch latest result for a task
- `listByUser(userId, limit)` — recent results for a user

---

## ER-003: Write Path Integration

**File:** `backend/src/api/chat.ts`

### Memory retrieval in execute mode

Before `taskPlanner.plan()`, the execute branch now calls `MemoryEntryRepo.getTopForUser()` (same pipeline as non-execute path). The resulting IDs are stored in `memoryEntriesUsed[]` and written to the `memory_entries_used` column.

This ensures the execution path has planner context and the memory lineage is preserved.

### Result persistence

After `executionLoop.run()` returns, the result is saved if the reason is one of:
- `completed` — all steps finished
- `step_cap` — ran out of step budget
- `tool_cap` — ran out of tool call budget
- `no_progress` — 3 consecutive reasoning steps with no tool call

`error` is intentionally excluded — a crashed loop should not produce a persistent result record.

The save is **fire-and-forget** (`.catch()` logs and continues). It never blocks the HTTP response.

### steps_summary shape

```json
{
  "totalSteps": 3,
  "completedSteps": 3,
  "toolCallsExecuted": 2,
  "steps": [
    { "index": 0, "title": "Research X", "type": "tool_call", "status": "completed", "tool_name": "memory_search" },
    { "index": 1, "title": "Analyze data", "type": "reasoning", "status": "completed" },
    { "index": 2, "title": "Write report", "type": "synthesis", "status": "completed" }
  ]
}
```

---

## Design Decisions

1. **Dedicated table, not memory_entries extension.** Execution outcomes have a richer, distinct shape (steps_summary JSONB, tool_count, duration_ms). Mixing into `memory_entries` would require many nullable fields.

2. **JSONB for steps_summary, not normalized.** Tool call shapes vary widely. JSONB gives flexibility without a wide table.

3. **memory_entries_used tracks what was read during planning.** This enables future queries: "what memories led to this outcome?" — useful for memory quality improvement.

4. **Only save non-error runs.** Error runs (hard crashes, guardrail rejections with `error` reason) are excluded from persistence. Only graceful terminations are recorded.

5. **Fire-and-forget persistence.** `.catch()` swallows errors; the API response is never delayed by a DB write failure.

---

## Files Changed

- `backend/src/db/schema.sql` — `execution_results` table + indexes
- `backend/src/types/index.ts` — 4 new types
- `backend/src/db/repositories.ts` — `ExecutionResultRepo` + `mapExecutionResultRow`
- `backend/src/api/chat.ts` — memory retrieval + `ExecutionResultRepo.save()` call

---

## Out of Scope (Follow-on Sprints)

- **Execution result injection into future prompts** — ER-003 stores the result; future sprints can add retrieval and injection
- **Frontend execution result viewer** — builds on top of this storage layer
- **Retry/fallback logic** — separate concern

---

## Next Sprint Direction

With ER-003 complete, the memory pipeline now has both read (Sprint 04) and write (Sprint 07) paths. The natural follow-on sprint is **Execution Result Retrieval and Injection**: read past execution results and inject them into future planning calls so the system can build on its own past work.
