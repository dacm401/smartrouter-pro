# Sprint 07 Proposal

## Recommended Sprint Name

**Execution Result Memory Persistence**

---

## Problem Statement

After Sprint 05–06, the execution loop can run tools and produce answers. However:

1. **Execution results evaporate.** The final answer from a `synthesis` step exists only in the API response. It is not stored anywhere. The next planning call has no memory of what the previous execution produced.

2. **Sprint 04's memory pipeline is incomplete.** MR-003 (relevance ranking for chat context) handles reading memory into the model. But nothing writes *execution outcomes* back into `memory_entries`. The memory system is a one-way door.

3. **decision-logger SQL is broken.** `DecisionRepo.save()` has 27 columns in INSERT but only passes 26 values — `syntax error at end of input` fires on every request. This is a quick fix worth doing in the same sprint.

---

## Recommended Goal

Close the loop between execution output and memory: execution results are automatically stored as memory entries and available to future planning calls.

---

## Task Cards

### ER-001: Decision-Logger SQL Bug Fix

**Goal:** Fix the missing `$27` placeholder in `DecisionRepo.save()`.

**Root cause:** INSERT has 27 column names but only 26 `$N` placeholders. PostgreSQL throws `syntax error at end of input` on every chat request. The error is caught and swallowed (non-blocking), so decision logs are never actually written.

**Fix:** Count the column list, add the missing placeholder, verify the params array covers all positions.

**Verification:** No new test needed — the existing system behavior (error caught, 200 returned) remains. Confirm via code review: `$27` present in SQL, 27th param in array.

---

### ER-002: Execution Result Data Model

**Goal:** Define what an execution result looks like and where it lives.

**Scope:**
- New table `execution_results` (id, task_id, user_id, final_content, steps_summary JSONB, memory_entries_used TEXT[], model_used, tool_count, duration_ms, created_at)
- Or reuse `memory_entries` with a new category: `execution_outcome`
- Choose: dedicated table vs. memory_entries extension

**Decision criteria:**
- Dedicated table: cleaner schema, no schema pollution, explicit relation
- memory_entries extension: simpler (one table), but `execution_outcome` has different shape from `memory_entry`

**Recommendation:** Dedicated table `execution_results` — execution outcomes have a distinct, richer shape (steps_summary, tool_count, duration_ms). Mixing into `memory_entries` would require many nullable fields.

**Deliverable:** schema.sql update + MemoryEntry types if using extension approach

---

### ER-003: Execution Result Write Path

**Goal:** Write execution results to storage after the loop completes.

**Scope:**
- `ExecutionLoop.run()` returns structured result: `{ finalContent, stepsSummary, memoryEntriesUsed, modelUsed, toolCount, durationMs }`
- New repository method `ExecutionResultRepo.save()`
- `chat.ts`: call `ExecutionResultRepo.save()` after loop completes (fire-and-forget or awaited depending on UX tolerance)
- Only save on `synthesis` step (successful completion); do not save on guardrail abort or step cap

**Steps summary shape:**
```json
{
  "totalSteps": 3,
  "toolCalls": [
    { "tool": "memory_search", "args": {...}, "result": "..." }
  ],
  "reasoning": "...",
  "finalContent": "..."
}
```

**Deliverable:** `execution-loop.ts` result shape, `execution-results.ts` repo, `chat.ts` integration point

---

### ER-004: Review + Documentation

**Goal:** Verify write path, update runtime flow doc, archive sprint.

**Scope:**
- Verify execution results appear in DB after a successful chat call
- Update `runtime-flow.md`: add step ⑥ post-loop result persistence
- Update `repo-map.md`: add `ExecutionResultRepo` or equivalent
- Create `sprint-07-review.md`
- Mark sprint closed in `current-sprint.md`

---

## Architecture Preview

```
Sprint 07
├── ER-001  Decision-logger SQL fix     (backend/src/db/repositories.ts)
├── ER-002  Execution result schema     (backend/src/db/schema.sql + types)
├── ER-003  Result write path           (backend/src/services/execution-loop.ts
│                                         + execution-results repo
│                                         + chat.ts integration)
├── ER-004  Review + docs               (runtime-flow.md, repo-map.md,
│                                         sprint-07-review.md)
└── docs: task-cards/ + sprint-07-proposal.md
```

---

## Design Decisions

1. **Result written after loop, not inside loop.** Loop handles execution; persistence is a side-effect of the chat endpoint. Keeps loop logic clean.
2. **steps_summary is JSONB, not normalized.** Tool call details vary widely. Storing as JSONB avoids a wide table and keeps flexibility.
3. **memory_entries_used tracks what was read during planning.** This enables future queries: "what memories led to this outcome?" — useful for memory quality improvement.
4. **Execution result is not automatically injected into future prompts.** ER-003 stores the result; injection into future prompts is a follow-on sprint (keeps scope tight here).
5. **decision-logger fix is in ER-001, not backlog.** It is a one-line fix and belongs in the same sprint as other DB work.

---

## Out of Scope

- Execution result injection into future prompts (follow-on sprint)
- Frontend execution trace viewer
- Retry / fallback logic
- E2e tests (require running backend + model API)

---

## Success Criteria

- [ ] `DecisionRepo.save()` passes all 27 placeholders correctly
- [ ] `execution_results` table exists with correct schema
- [ ] Successful `/api/chat` call with `body.execute=true` produces an `execution_results` row
- [ ] `steps_summary` JSONB contains `totalSteps`, `toolCalls`, `finalContent`
- [ ] `runtime-flow.md` updated with persistence step
- [ ] `npm run build` succeeds with no errors
- [ ] `npm run test` passes (no regression)

---

## Priority Rationale

Execution result persistence is the natural closure of the memory pipeline started in Sprint 04. Without it, memory only flows *into* the model — not *out of* it. This asymmetry limits the system's ability to learn from its own outputs.

Fixing the decision-logger bug in the same sprint is efficient: it's a 5-minute code change that sits next to the same repositories being touched.

---

## Files Reference

Modules to modify:
- `backend/src/db/repositories.ts` (ER-001: fix, ER-003: add ExecutionResultRepo)
- `backend/src/db/schema.sql` (ER-002: new table)
- `backend/src/types/index.ts` (ER-002: new types)
- `backend/src/services/execution-loop.ts` (ER-003: return structured result)
- `backend/src/api/chat.ts` (ER-003: call save after loop)
- `docs/runtime-flow.md` (ER-004)
- `docs/repo-map.md` (ER-004)

New files:
- `docs/sprint-07-review.md` (ER-004)
- `docs/task-cards/er-001~er-004-*.md` (ER-004)
