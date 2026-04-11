/**
 * T1: Task Resume v1 — Repository tests for findActiveBySession
 *
 * Tests the TaskRepo.findActiveBySession() method which is the core of
 * implicit task resumption (Task Resume v1, 方案 C).
 *
 * DB prerequisite: PostgreSQL must be running.
 * If DB is unavailable, all tests fail with ECONNREFUSED — this is an
 * infrastructure issue, not a code issue.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  initTestDb,
  closeTestDb,
  withTestUser,
  withTestTask,
} from "../db/harness.js";

let dbUrl: string;

beforeAll(() => {
  dbUrl = process.env.DATABASE_URL!;
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/smartrouter_test";
  initTestDb();
});

afterAll(() => {
  process.env.DATABASE_URL = dbUrl;
  closeTestDb();
});

describe("TaskRepo.findActiveBySession", () => {
  it(
    "returns the most recent non-terminal task for session+user",
    async () => {
      await withTestUser(async (userId) => {
        const sessionId = "test-session-resume-1";

        // Create a completed task (should NOT be returned)
        await withTestTask({ userId, sessionId, status: "completed" });

        // Create a responding task (should be returned — most recent active)
        await withTestTask({ userId, sessionId, status: "responding" });

        // Create another responding task (newer, should be returned instead)
        const { TaskRepo } = await import("../../src/db/repositories.js");
        const newerTask = await withTestTask({
          userId,
          sessionId,
          status: "responding",
        });

        const result = await TaskRepo.findActiveBySession(sessionId, userId);

        expect(result).not.toBeNull();
        // Must be the most recently updated one
        expect(result!.task_id).toBe(newerTask.task_id);
        expect(result!.status).toBe("responding");
      });
    }
  );

  it(
    "excludes completed, failed, and cancelled tasks",
    async () => {
      await withTestUser(async (userId) => {
        const sessionId = "test-session-resume-2";

        await withTestTask({ userId, sessionId, status: "completed" });
        await withTestTask({ userId, sessionId, status: "failed" });
        await withTestTask({ userId, sessionId, status: "cancelled" });

        const { TaskRepo } = await import("../../src/db/repositories.js");
        const result = await TaskRepo.findActiveBySession(sessionId, userId);

        expect(result).toBeNull();
      });
    }
  );

  it(
    "returns null when no tasks exist for session",
    async () => {
      await withTestUser(async (userId) => {
        const { TaskRepo } = await import("../../src/db/repositories.js");
        const result = await TaskRepo.findActiveBySession(
          "non-existent-session",
          userId
        );
        expect(result).toBeNull();
      });
    }
  );

  it(
    "only returns tasks belonging to the specified user",
    async () => {
      await withTestUser(async (userA) => {
        await withTestUser(async (userB) => {
          const sessionId = "test-session-resume-3";

          // Task belonging to userA
          await withTestTask({
            userId: userA,
            sessionId,
            status: "responding",
          });

          // Task belonging to userB in same session (should NOT be returned for userA)
          await withTestTask({
            userId: userB,
            sessionId,
            status: "responding",
          });

          const { TaskRepo } = await import("../../src/db/repositories.js");
          const result = await TaskRepo.findActiveBySession(sessionId, userA);

          expect(result).not.toBeNull();
          expect(result!.user_id).toBe(userA);
        });
      });
    }
  );

  it(
    "returns the single active task when only one exists",
    async () => {
      await withTestUser(async (userId) => {
        const sessionId = "test-session-resume-4";
        const task = await withTestTask({
          userId,
          sessionId,
          status: "paused",
        });

        const { TaskRepo } = await import("../../src/db/repositories.js");
        const result = await TaskRepo.findActiveBySession(sessionId, userId);

        expect(result).not.toBeNull();
        expect(result!.task_id).toBe(task.task_id);
        expect(result!.status).toBe("paused");
      });
    }
  );
});
