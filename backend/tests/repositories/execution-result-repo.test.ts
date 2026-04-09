/**
 * IT-001: ExecutionResultRepo Integration Tests
 *
 * Verifies real SQL contracts of ExecutionResultRepo against PostgreSQL.
 * No mocks — hits the actual test database (smartrouter_test).
 *
 * Isolation strategy:
 *   beforeEach → truncateTables() → commits immediately, resets all tables.
 *   Test body runs freely; state is clean on entry and reset on exit.
 *
 * Coverage:
 *   1.  save() writes a complete record and returns a fully-populated record
 *   2.  save() defaults memory_entries_used to []
 *   3.  save() defaults model_used/duration_ms to null
 *   4.  listByUser() filters by user_id (user isolation)
 *   5.  listByUser() returns empty [] when no records exist
 *   6.  listByUser() orders by created_at DESC
 *   7.  listByUser(limit) applies LIMIT; default is 20
 *   8.  listByUser() preserves all reason values
 *   9.  getByTaskId() returns the correct record
 *   10. getByTaskId() returns null for unknown task_id
 *   11. final_content round-trips exactly (Unicode, special chars)
 *   12. reason field round-trips exactly
 *   13. tool_count field round-trips exactly
 *   14. steps_summary JSONB round-trips with full nesting
 *   15. steps_summary handles null gracefully
 *   16. memory_entries_used TEXT[] round-trips correctly
 *   17. User A's data is completely invisible to User B
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionResultRepo } from "../../src/db/repositories.js";
import { truncateTables } from "../db/harness.js";
import type { ExecutionResultInput } from "../../src/types/index.js";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const makeInput = (userId: string, taskId: string, overrides: Partial<ExecutionResultInput> = {}): ExecutionResultInput => ({
  task_id: taskId,
  user_id: userId,
  session_id: `session-${userId}`,
  final_content: `Content for ${taskId}`,
  steps_summary: {
    totalSteps: 3,
    completedSteps: 3,
    toolCallsExecuted: 2,
    steps: [
      { index: 0, title: "Search", type: "tool_call", status: "completed", tool_name: "web_search" },
      { index: 1, title: "Read", type: "tool_call", status: "completed", tool_name: "http_request" },
      { index: 2, title: "Synthesise", type: "synthesis", status: "completed" },
    ],
  },
  memory_entries_used: ["mem-1", "mem-2"],
  model_used: "gpt-4o",
  tool_count: 2,
  duration_ms: 1500,
  reason: "completed",
  ...overrides,
});

const UID_A = "it-user-a";
const UID_B = "it-user-b";

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  await truncateTables();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1-3. save() — field population and defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("save()", () => {
  it("1. returns a record with all fields populated including generated id and created_at", async () => {
    const saved = await ExecutionResultRepo.save(makeInput(UID_A, "task-full"));

    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(saved.task_id).toBe("task-full");
    expect(saved.user_id).toBe(UID_A);
    expect(saved.session_id).toBe(`session-${UID_A}`);
    expect(saved.final_content).toBe("Content for task-full");
    expect(saved.model_used).toBe("gpt-4o");
    expect(saved.tool_count).toBe(2);
    expect(saved.duration_ms).toBe(1500);
    expect(saved.reason).toBe("completed");
    expect(saved.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("2. defaults memory_entries_used to [] when omitted", async () => {
    const { memory_entries_used: _, ...inputWithoutMemory } = makeInput(UID_A, "task-no-mem");
    const saved = await ExecutionResultRepo.save(inputWithoutMemory as ExecutionResultInput);
    expect(saved.memory_entries_used).toEqual([]);
  });

  it("3. defaults model_used to null and duration_ms to null when omitted", async () => {
    const minimal: ExecutionResultInput = {
      task_id: "task-minimal",
      user_id: UID_A,
      session_id: "session-min",
      final_content: "Minimal.",
      steps_summary: { totalSteps: 1, completedSteps: 1, toolCallsExecuted: 0, steps: [] },
      tool_count: 0,
      reason: "completed",
    };
    const saved = await ExecutionResultRepo.save(minimal);
    expect(saved.model_used).toBeNull();
    expect(saved.duration_ms).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4-6. listByUser() — filtering, empty, ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("listByUser()", () => {
  it("4. returns only records belonging to the specified user", async () => {
    await ExecutionResultRepo.save(makeInput(UID_A, "task-a1"));
    await ExecutionResultRepo.save(makeInput(UID_A, "task-a2"));
    await ExecutionResultRepo.save(makeInput(UID_B, "task-b1"));

    const aResults = await ExecutionResultRepo.listByUser(UID_A);

    expect(aResults).toHaveLength(2);
    expect(aResults.every((r) => r.user_id === UID_A)).toBe(true);
  });

  it("5. returns empty array when user has no records", async () => {
    const results = await ExecutionResultRepo.listByUser("ghost-user-it");
    expect(results).toEqual([]);
    expect(Array.isArray(results)).toBe(true);
  });

  it("6. returns records in reverse-chronological order (newest first)", async () => {
    await ExecutionResultRepo.save(makeInput(UID_A, "task-old", { final_content: "Oldest" }));
    await ExecutionResultRepo.save(makeInput(UID_A, "task-new", { final_content: "Newest" }));

    const results = await ExecutionResultRepo.listByUser(UID_A);

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].final_content).toBe("Newest");
    expect(results[results.length - 1].final_content).toBe("Oldest");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7-8. listByUser() — limit and reason preservation
// ─────────────────────────────────────────────────────────────────────────────

describe("listByUser() — limit and reason", () => {
  it("7. respects limit parameter; defaults to 20", async () => {
    for (let i = 0; i < 5; i++) {
      await ExecutionResultRepo.save(makeInput(UID_A, `task-limit-${i}`, { final_content: `R${i}` }));
    }

    const limited = await ExecutionResultRepo.listByUser(UID_A, 3);
    expect(limited).toHaveLength(3);

    const defaultLimit = await ExecutionResultRepo.listByUser(UID_A);
    expect(defaultLimit).toHaveLength(5);
  });

  it("8. preserves all reason values without filtering", async () => {
    await ExecutionResultRepo.save(makeInput(UID_A, "t-cmpl", { reason: "completed" }));
    await ExecutionResultRepo.save(makeInput(UID_A, "t-step", { reason: "step_cap" }));
    await ExecutionResultRepo.save(makeInput(UID_A, "t-tool", { reason: "tool_cap" }));
    await ExecutionResultRepo.save(makeInput(UID_A, "t-noprog", { reason: "no_progress" }));

    const results = await ExecutionResultRepo.listByUser(UID_A);
    const reasons = results.map((r) => r.reason).sort();

    expect(reasons).toContain("completed");
    expect(reasons).toContain("step_cap");
    expect(reasons).toContain("tool_cap");
    expect(reasons).toContain("no_progress");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9-10. getByTaskId()
// ─────────────────────────────────────────────────────────────────────────────

describe("getByTaskId()", () => {
  it("9. returns the record when task_id exists", async () => {
    const saved = await ExecutionResultRepo.save(makeInput(UID_A, "task-by-id"));
    const record = await ExecutionResultRepo.getByTaskId("task-by-id");

    expect(record).not.toBeNull();
    expect(record!.id).toBe(saved.id);
    expect(record!.task_id).toBe("task-by-id");
  });

  it("10. returns null when task_id does not exist", async () => {
    const record = await ExecutionResultRepo.getByTaskId("nonexistent-task-id");
    expect(record).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11-13. Field round-trips (string, reason, tool_count)
// ─────────────────────────────────────────────────────────────────────────────

describe("field round-trips", () => {
  it("11. final_content preserves Unicode and special characters", async () => {
    const content = "你好世界！<tag> & \"quotes\" 'apostrophes' $100";
    await ExecutionResultRepo.save(makeInput(UID_A, "task-unicode", { final_content: content }));
    const record = await ExecutionResultRepo.listByUser(UID_A);
    const found = record.find((r) => r.task_id === "task-unicode")!;
    expect(found.final_content).toBe(content);
  });

  it("12. reason field round-trips all supported values exactly", async () => {
    const reasons = ["completed", "step_cap", "tool_cap", "no_progress"] as const;
    for (const reason of reasons) {
      await ExecutionResultRepo.save(makeInput(UID_A, `task-reason-${reason}`, { reason }));
    }
    const record = await ExecutionResultRepo.listByUser(UID_A);
    for (const reason of reasons) {
      const found = record.find((r) => r.task_id === `task-reason-${reason}`);
      expect(found?.reason).toBe(reason);
    }
  });

  it("13. tool_count round-trips exactly (including zero and large numbers)", async () => {
    await ExecutionResultRepo.save(makeInput(UID_A, "t-zero", { tool_count: 0 }));
    await ExecutionResultRepo.save(makeInput(UID_A, "t-large", { tool_count: 9999 }));
    const records = await ExecutionResultRepo.listByUser(UID_A);

    expect(records.find((r) => r.task_id === "t-zero")?.tool_count).toBe(0);
    expect(records.find((r) => r.task_id === "t-large")?.tool_count).toBe(9999);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14-15. steps_summary JSONB
// ─────────────────────────────────────────────────────────────────────────────

describe("steps_summary JSONB round-trip", () => {
  it("14. deserialises complex nested steps_summary correctly", async () => {
    const complex = {
      totalSteps: 5,
      completedSteps: 4,
      toolCallsExecuted: 3,
      steps: [
        { index: 0, title: "Plan", type: "reasoning" as const, status: "completed" as const },
        { index: 1, title: "Web search", type: "tool_call" as const, status: "completed" as const, tool_name: "web_search" },
        { index: 2, title: "Read result", type: "tool_call" as const, status: "completed" as const, tool_name: "http_request" },
        { index: 3, title: "Analyse", type: "reasoning" as const, status: "in_progress" as const },
        { index: 4, title: "Write up", type: "synthesis" as const, status: "pending" as const },
      ],
    };

    await ExecutionResultRepo.save(makeInput(UID_A, "task-jsonb", { steps_summary: complex }));
    const record = await ExecutionResultRepo.listByUser(UID_A);
    const found = record.find((r) => r.task_id === "task-jsonb")!;

    expect(found.steps_summary).toEqual(complex);
    expect(found.steps_summary!.steps[1].tool_name).toBe("web_search");
    expect(found.steps_summary!.steps[3].status).toBe("in_progress");
    expect(found.steps_summary!.totalSteps).toBe(5);
    expect(found.steps_summary!.completedSteps).toBe(4);
  });

  it("15. handles null steps_summary gracefully", async () => {
    // Insert a raw row with steps_summary = NULL via a direct pool query
    // (bypasses the app's JSON.stringify in save())
    const { Pool } = await import("pg");
    const rawPool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const client = await rawPool.connect();
    try {
      await client.query(`
        INSERT INTO execution_results
          (id, task_id, user_id, session_id, final_content, steps_summary, tool_count, reason)
        VALUES
          ('00000000-0000-0000-0000-000000000001', 'null-steps', $1, 'null-sess', 'No steps.', NULL, 0, 'completed')
      `, [UID_A]);
      await client.query("COMMIT");
    } finally {
      client.release();
      await rawPool.end();
    }

    const record = await ExecutionResultRepo.getByTaskId("null-steps");
    expect(record).not.toBeNull();
    expect(record!.steps_summary).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. memory_entries_used TEXT[]
// ─────────────────────────────────────────────────────────────────────────────

describe("memory_entries_used TEXT[] round-trip", () => {
  it("16. preserves an arbitrary array of memory entry IDs", async () => {
    const ids = ["mem-alpha", "mem-beta", "mem-gamma"];
    await ExecutionResultRepo.save(makeInput(UID_A, "task-mems", { memory_entries_used: ids }));
    const record = await ExecutionResultRepo.listByUser(UID_A);
    const found = record.find((r) => r.task_id === "task-mems")!;
    expect(found.memory_entries_used).toEqual(ids);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. User data isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("user data isolation", () => {
  it("17. User A and User B see only their own records", async () => {
    await ExecutionResultRepo.save(makeInput(UID_A, "a-only-1"));
    await ExecutionResultRepo.save(makeInput(UID_A, "a-only-2"));
    await ExecutionResultRepo.save(makeInput(UID_B, "b-only"));

    const aResults = await ExecutionResultRepo.listByUser(UID_A);
    const bResults = await ExecutionResultRepo.listByUser(UID_B);

    expect(aResults).toHaveLength(2);
    expect(aResults.every((r) => r.user_id === UID_A)).toBe(true);

    expect(bResults).toHaveLength(1);
    expect(bResults[0].task_id).toBe("b-only");
    expect(bResults[0].user_id).toBe(UID_B);
  });
});
