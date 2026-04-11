/**
 * B1: Benchmark Runner v1 (skeleton)
 *
 * Runs a suite of prompt tasks against the SmartRouter Pro backend and
 * verifies that the routing layer selects the expected model/mode.
 *
 * Usage:
 *   npx ts-node evaluation/runner.ts
 *
 * Environment:
 *   API_BASE   — backend base URL (default: http://localhost:3001)
 *   BENCHMARK_USER_ID — user ID for all benchmark requests
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BenchmarkTask {
  id: string;
  /** Short human-readable description */
  description: string;
  /** The user message to send */
  prompt: string;
  /** Expected routing mode */
  expected_mode: "direct" | "research" | "execute";
  /** Optional: expected role (fast/slow) */
  expected_role?: "fast" | "slow";
}

export interface BenchmarkResult {
  task_id: string;
  prompt_preview: string;
  expected_mode: string;
  actual_mode: string | null;
  actual_role: string | null;
  matched: boolean;
  latency_ms: number;
  tokens_used: number;
  error?: string;
}

// ── Task loading ───────────────────────────────────────────────────────────────

function loadTasks(dir: string): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [];
  if (!fs.existsSync(dir)) return tasks;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    const parsed = JSON.parse(content) as BenchmarkTask[] | BenchmarkTask;
    if (Array.isArray(parsed)) tasks.push(...parsed);
    else tasks.push(parsed);
  }
  return tasks;
}

// ── Core runner ────────────────────────────────────────────────────────────────

async function runBenchmark(
  tasks: BenchmarkTask[],
  apiBase: string,
  userId: string
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const task of tasks) {
    const start = Date.now();
    try {
      const sessionId = `bench-${task.id}`;
      const res = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": userId },
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          message: task.prompt,
          history: [],
        }),
      });

      const data = await res.json() as any;
      const decision = data?.decision;
      const actualMode = decision?.routing?.selected_role === "fast" ? "direct" : "research";
      const actualRole = decision?.routing?.selected_role ?? null;
      const tokensUsed =
        (decision?.execution?.input_tokens ?? 0) +
        (decision?.execution?.output_tokens ?? 0);

      const matched =
        task.expected_mode === actualMode &&
        (task.expected_role ? task.expected_role === actualRole : true);

      results.push({
        task_id: task.id,
        prompt_preview: task.prompt.slice(0, 60),
        expected_mode: task.expected_mode,
        actual_mode: actualMode,
        actual_role: actualRole,
        matched,
        latency_ms: Date.now() - start,
        tokens_used: tokensUsed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        task_id: task.id,
        prompt_preview: task.prompt.slice(0, 60),
        expected_mode: task.expected_mode,
        actual_mode: null,
        actual_role: null,
        matched: false,
        latency_ms: Date.now() - start,
        tokens_used: 0,
        error: message,
      });
    }
  }

  return results;
}

// ── Report ─────────────────────────────────────────────────────────────────────

function printReport(results: BenchmarkResult[]): void {
  console.log("\n=== Benchmark Results ===\n");
  let passCount = 0;
  for (const r of results) {
    const icon = r.matched ? "✅" : r.error ? "❌" : "⚠️";
    console.log(`${icon} [${r.task_id}] ${r.prompt_preview}...`);
    console.log(`   Expected: ${r.expected_mode} | Actual: ${r.actual_mode ?? "N/A"} (${r.actual_role ?? "?"})`);
    if (r.error) console.log(`   ERROR: ${r.error}`);
    console.log(`   Latency: ${r.latency_ms}ms | Tokens: ${r.tokens_used}\n`);
    if (r.matched) passCount++;
  }
  console.log(`\n=== Summary: ${passCount}/${results.length} passed ===\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiBase = process.env.API_BASE || "http://localhost:3001";
  const userId = process.env.BENCHMARK_USER_ID || "benchmark-user";
  const evalDir = path.join(__dirname, "tasks");

  console.log(`Benchmark runner starting...`);
  console.log(`API Base: ${apiBase}`);
  console.log(`User ID: ${userId}`);
  console.log(`Task dir: ${evalDir}`);

  const tasks = loadTasks(evalDir);
  if (tasks.length === 0) {
    console.error("No benchmark tasks found. Add JSON files to evaluation/tasks/");
    process.exit(1);
  }

  console.log(`Loaded ${tasks.length} benchmark tasks.`);

  const results = await runBenchmark(tasks, apiBase, userId);
  printReport(results);

  // Write JSON output for CI integration
  const outputPath = path.join(__dirname, "results.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`Results written to ${outputPath}`);
}

main().catch((err) => {
  console.error("Benchmark runner failed:", err);
  process.exit(1);
});
