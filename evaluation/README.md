# Benchmark Evaluation

SmartRouter Pro routing quality benchmark suite.

## Directory Structure

```
evaluation/
  runner.ts              # Benchmark runner entry point
  README.md              # This file
  tasks/
    direct.json          # 5 direct-mode test cases
    research.json        # 5 research-mode test cases
  results.json           # Generated after each run
```

## Running the Benchmark

### Prerequisites

1. Backend must be running at `http://localhost:3001` (or set `API_BASE`)
2. PostgreSQL must be accessible (for session/task persistence)
3. `OPENAI_API_KEY` (or compatible model key) must be configured in the backend environment

### Execute

```bash
cd smartrouter-pro/evaluation

# Run with defaults (API_BASE=http://localhost:3001, user=benchmark-user)
npx ts-node runner.ts

# Or with environment overrides
API_BASE=http://localhost:3001 BENCHMARK_USER_ID=my-user-id npx ts-node runner.ts
```

### Output Format

The runner prints a human-readable summary to stdout:

```
=== Benchmark Results ===

✅ [direct-rewrite-01] Please rewrite... [truncated]
   Expected: direct | Actual: direct (fast)
   Latency: 215ms | Tokens: 342

❌ [research-investigation-01] Please research... [truncated]
   ERROR: Connection refused
   Latency: 12ms | Tokens: 0

=== Summary: 4/5 passed ===
```

A machine-readable JSON report is also written to `evaluation/results.json`.

## Adding Test Cases

Add new `.json` files to `evaluation/tasks/` or edit existing ones.

Each task entry:

```typescript
interface BenchmarkTask {
  id: string;              // Unique identifier (e.g. "direct-01")
  description: string;      // Human-readable description
  prompt: string;           // The actual user message
  expected_mode: "direct" | "research" | "execute";
  expected_role?: "fast" | "slow";  // Optional: check role, not just mode
}
```

## Interpreting Results

| Status | Meaning |
|--------|---------|
| ✅ matched | Routing correctly selected the expected mode |
| ⚠️  not matched | Routing selected a different mode — investigate routing logic |
| ❌ error | Request failed (network, API key, DB, etc.) — infrastructure issue |

A result is considered **passing** when `matched === true` and no error is present.
