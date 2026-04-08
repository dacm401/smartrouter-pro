# Runtime Flow

> **Scope:** Backend only. Documents the actual runtime path of a request through the system.
> **Last verified:** Sprint 04 MR-004
> **Principal entrypoint:** `POST /api/chat`

---

## 1. High-Level Request Flow

```
HTTP POST /api/chat
  │
  ├── chat.ts
  │     │
  │     ├── ① parse request body
  │     ├── ② create task record  (fire-and-forget, non-blocking)
  │     ├── ③ intent + complexity analysis
  │     ├── ④ model routing  → { features, routing }
  │     ├── ④b memory injection  (MemoryEntryRepo → retrieval pipeline → taskSummary)  ← Memory v2 (Sprint 04 MR-001~003)
  │     ├── ⑤ prompt assembly  (PromptAssembler, receives taskSummary)
  │     ├── ⑥ context management  (ContextManager)
  │     ├── ⑦ model call  (model-gateway)
  │     ├── ⑧ quality gate  (fast path only)
  │     │         └── fallback call if quality check fails
  │     ├── ⑨ decision logging  (fire-and-forget)
  │     ├── ⑩ learning engine  (fire-and-forget)
  │     ├── ⑪ task execution update  (fire-and-forget)
  │     ├── ⑫ trace writes  (classification / routing / response, all fire-and-forget)
  │     └── ⑬ return ChatResponse
  │
  └── /v1/tasks/* routes (independent, read-only relative to a chat session)
        GET /v1/tasks/all
        GET /v1/tasks/:id
        GET /v1/tasks/:id/summary
        GET /v1/tasks/:id/traces

  └── /v1/memory routes (Memory v1 — user-scoped CRUD)
        POST   /v1/memory
        GET    /v1/memory
        GET    /v1/memory/:id
        PUT    /v1/memory/:id
        DELETE /v1/memory/:id
```

---

## 2. Step-by-Step Runtime Flow

### Step 0 — Route Entry

**File:** `backend/src/api/chat.ts`
**Pattern:** `POST /api/chat`

Request body shape:

```ts
interface ChatRequest {
  message: string;           // required
  user_id?: string;          // default: "default-user"
  session_id?: string;       // auto-generated if absent
  history?: ChatMessage[];    // optional conversation history
  preferences?: {
    compression_level?: "L0" | "L1" | "L2";  // default: "L0" (auto)
  };
  api_key?: string;          // optional per-request API key override
  fast_model?: string;        // optional model override
  slow_model?: string;        // optional model override
}
```

---

### Step 1 — Intent Analysis

**File:** `backend/src/router/router.ts` → `analyzeAndRoute()`
**Dependency:** `intent-analyzer.ts`, `complexity-scorer.ts`

1. `analyzeIntent(message)` — regex pattern matching against 9 intent types:
   `code | math | reasoning | creative | translation | summarization | simple_qa | chat | unknown`

2. `scoreComplexity(message, intent, history)` — weighted score across 5 factors:
   `length_score + intent_score + depth_score + specificity_score + multi_step_score`
   Output: `complexity_score` (0–100)

3. `detectLanguage(message)` — heuristic based on Chinese character density

4. `MemoryRepo.getIdentity(user_id)` + `MemoryRepo.getBehavioralMemories(user_id)` — fetched in parallel

Result: `InputFeatures`

```ts
interface InputFeatures {
  raw_query: string;
  token_count: number;
  intent: IntentType;
  complexity_score: number;
  has_code: boolean;
  has_math: boolean;
  requires_reasoning: boolean;     // true if complexity_score > 60
  conversation_depth: number;
  context_token_count: number;
  language: "zh" | "en";
}
```

---

### Step 2 — Model Routing

**File:** `backend/src/router/router.ts` → `ruleRoute()`
**Dependency:** `rule-router.ts`, `config.ts`

Rule-based scoring:

| Signal | Effect |
|---|---|
| `simple_qa` / `chat` intent | +0.25 fast |
| `reasoning` / `math` / `code` intent | +0.25 slow |
| `complexity_score < 30` | +0.2 fast |
| `complexity_score > 60` | +0.2 slow |
| `token_count < 50` | +0.1 fast |
| `token_count > 300` | +0.1 slow |
| `has_code` | +0.15 slow |
| `has_math` | +0.15 slow |
| user `quality_sensitivity > 0.7` | +0.1 slow |
| user `cost_sensitivity > 0.7` | +0.1 fast |
| matching behavioral memory | ±0.15 × strength |

Scores normalized to [0, 1]. Higher score wins → `selected_role = "fast" | "slow"`.

Model selected from `config`: `fastModel` or `slowModel`.

Request-level override: if `body.fast_model` or `body.slow_model` is set, those values replace the router-selected model.

---

### Step 3 — Task Record Creation

**File:** `backend/src/api/chat.ts` → `TaskRepo.create()`
**Dependency:** `repositories.ts`

- `task_id = uuid()`
- `mode` inferred from intent: `simple_qa | chat | unknown → "direct"`, all others → `"research"`
- `complexity` quantized: `0-32 → low`, `33-65 → medium`, `66-98 → high`, `99+ → high`
- Fire-and-forget: `.catch()` swallows errors — does **not** block the response

---

### Step 4 — Memory Retrieval + Prompt Assembly

**Memory injection flow (Memory v2 — Sprint 04 MR-001/002/003):**

```
MemoryEntryRepo.getTopForUser(userId, N)        ← candidate pool
        ↓
runRetrievalPipeline()  (memory-retrieval.ts)  ← MR-001 scoring + filtering
        ↓
buildCategoryAwareMemoryText()                 ← MR-002 category formatting
        ↓
taskSummary → assemblePrompt()                  ← injected into system prompt
```

**v1 / v2 strategy toggle:**

| Config key | Values | Behaviour |
|---|---|---|
| `memory.retrieval.strategy` | `"v1"` (default) | Flat `importance DESC, updated_at DESC` ordering |
| `"v2"` | Category-aware retrieval pipeline | |

Set via `MEMORY_RETRIEVAL_STRATEGY` env var. Default: `"v1"` (safe, no behaviour change).

**v2 scoring model (fixed weights, explainable):**

| Component | Max pts | Description |
|---|---|---|
| Importance | 30 | `importance × 6` |
| Recency | 20 | Exponential decay, half-life ~10 days |
| Keyword relevance | 15 | Jaccard-normalised token overlap (MR-003) |
| **Total max** | **65** | |

**Category-aware formatting (MR-002):**

Entries are grouped into labelled sections, one per category:

```
User memories:

Instructions & Goals:
- {entry.content}

Preferences:
- {entry.content}

Facts:
- {entry.content}
```

Only categories with at least one entry are included. Section order: instruction → preference → fact → context → others.

**Prompt assembly:**

**File:** `backend/src/services/prompt-assembler.ts` → `assemblePrompt()`

```
[1] core_rules
[2] mode_policy
[3] task_summary  ← Memory v2 (category-grouped)
systemPrompt = [1] + "\n\n" + [2] (+ "\n\n" + [3] if present)
userPrompt = userMessage
```

Kill switch: `MEMORY_INJECTION_ENABLED=false` disables all memory reads. Token budget guard (`maxTaskSummaryTokens`) remains active in `prompt-assembler.ts`.

---

### Step 5 — Context Management

**File:** `backend/src/services/context-manager.ts` → `manageContext()`
**Dependencies:** `token-budget.ts`, `compressor.ts`, `token-counter.ts`

1. `calculateBudget(selectedModel)` — look up model's context window and max output
2. Determine compression level:
   - If `preferences.compression_level !== "L0"`: use user preference directly
   - If `"L0"`: auto-select via `needsCompression()` check
3. `compressHistory(history, compressionLevel, budget.available_for_history)` — compresses
4. Build `finalMessages`:

```
[system message]     ← assembled system prompt
[compressed history] ← if history exists
[user message]        ← current user input
```

5. Return `ContextResult`:

```ts
interface ContextResult {
  original_tokens: number;
  compressed_tokens: number;
  compression_level: CompressionLevel;
  compression_ratio: number;
  memory_items_retrieved: number;   // v1: always 0 (future extension)
  final_messages: ChatMessage[];
  compression_details: any;
}
```

---

### Step 6 — Model Call

**File:** `backend/src/api/chat.ts` → `callModel()`
**Dependency:** `model-gateway.ts`, `providers/openai.ts`, `providers/anthropic.ts`

1. If `reqApiKey` present → `callOpenAIWithOptions(model, messages, apiKey, baseUrl)`
2. Else → `callModelFull(model, messages)` → `model-gateway` finds provider

Supported models:
- **OpenAI:** `gpt-4o-mini`, `gpt-4o`
- **Anthropic:** `claude-3-5-haiku-20241022`, `claude-3-5-sonnet-20241022`

Model is selected by router (Step 2) or overridden by request.

---

### Step 7 — Quality Gate (fast path only)

**File:** `backend/src/api/chat.ts`
**Dependency:** `quality-gate.ts`

Conditions to enter quality gate:
- `config.qualityGateEnabled === true`
- `routing.selected_role === "fast"`

Quality checks:
| Check | Condition | Score impact |
|---|---|---|
| Minimum length | `response.length < 10` | −40 |
| Complexity mismatch | `complexity_score > 50 && response.length < 100` | −20 |
| Low confidence phrases | ≥2 matches of `我不太确定/I don't know/...` | −25 |
| Possible truncation | ends with `...` or long response with no terminal punctuation | −15 |
| Code query without code | `has_code === true && no code blocks` | −15 |
| Repetitive content | unique sentence ratio < 70% | −20 |

Pass threshold: `score ≥ 60`

If **fails** and `config.fallbackEnabled === true`:
- Call `fallback_model` (the other model in the pair)
- Set `did_fallback = true`, `fallbackReason = issues.join("; ")`
- Replace `modelResponse`

---

### Step 8 — Decision Logging

**File:** `backend/src/logging/decision-logger.ts` → `logDecision()`
**Dependency:** `repositories.ts`, `token-counter.ts`

Constructs `DecisionRecord` with full context and saves to `decision_logs` table.

Also computes:
- `costSaved = estimateCost(fastTokens) - actualCost` and writes to `cost_saved_vs_slow` column in a second query

Fire-and-forget: errors swallowed silently.

**Known issue:** `DecisionRepo.save()` has a SQL placeholder mismatch — INSERT declares 27 `$N` placeholders but only passes 26 values (the 27th `fallback_reason` is written in a separate UPDATE). Non-blocking.

---

### Step 9 — Learning Engine

**File:** `backend/src/features/learning-engine.ts` → `learnFromInteraction()`
**Dependencies:** `feedback-collector.ts`, `memory-store.ts`, `growth-tracker.ts`

Three independent operations (all fire-and-forget):

1. **Implicit feedback detection** — checks if current message is feedback on previous decision
2. **Memory learning** — `memory-store.ts` `analyzeAndLearn()` (Memory v1 entry point, currently stub)
3. **Milestone check** — `growth-tracker.ts` `checkAndRecordMilestones()`
4. **Memory decay** — every 100 interactions, decay old behavioral memories

---

### Step 10 — Task Execution Update

**File:** `backend/src/api/chat.ts` → `TaskRepo.updateExecution()`
**Dependency:** `repositories.ts`

```
UPDATE tasks SET tokens_used = $2, steps_used = steps_used + 1, updated_at = NOW()
WHERE id = $1
```

Fire-and-forget.

---

### Step 11 — Trace Writes

**File:** `backend/src/api/chat.ts` → `TaskRepo.createTrace()`

Three traces written sequentially (all fire-and-forget):

| Trace type | Content |
|---|---|
| `classification` | `intent`, `complexity_score`, `mode` |
| `routing` | `selected_model`, `selected_role`, `confidence`, `did_fallback` |
| `response` | `input_tokens`, `output_tokens`, `latency_ms`, `total_cost_usd` |

All written to `task_traces` table. `detail` field stored as JSON string.

---

### Step 12 — Response

**File:** `backend/src/api/chat.ts`

```ts
interface ChatResponse {
  message: string;          // model output text
  decision: DecisionRecord; // routing/execution metadata (response_text cleared)
}
```

Error path: returns `{ error: error.message }` with status 500.

---

## 3. File / Module Map

```
backend/src/
├── api/
│   ├── chat.ts          ← POST /api/chat, orchestrator
│   ├── tasks.ts         ← GET /v1/tasks/*
│   └── memory.ts        ← /v1/memory CRUD (Memory v1, MC-002)
│
├── router/
│   ├── router.ts        ← analyzeAndRoute() entry
│   ├── intent-analyzer.ts    ← intent detection (regex)
│   ├── complexity-scorer.ts  ← complexity score (5-factor)
│   ├── rule-router.ts        ← rule-based routing decision
│   └── quality-gate.ts       ← fast-path quality check
│
├── services/
│   ├── prompt-assembler.ts   ← system prompt assembly (direct / research)
│   ├── context-manager.ts    ← history compression + message assembly
│   └── memory-retrieval.ts   ← Memory v2: retrieval pipeline + scoring + category formatting
│
├── context/              ← pure utilities (imported by context-manager)
│   ├── token-budget.ts   ← budget calculation per model
│   └── compressor.ts     ← history compression
│
├── models/
│   ├── model-gateway.ts       ← provider dispatch
│   ├── token-counter.ts       ← token estimation
│   └── providers/
│       ├── openai.ts
│       └── anthropic.ts
│
├── logging/
│   └── decision-logger.ts    ← decision_logs write
│
├── features/
│   ├── learning-engine.ts    ← learning orchestrator
│   ├── feedback-collector.ts
│   ├── growth-tracker.ts
│   └── feedback-collector.ts
│
├── db/
│   ├── connection.ts          ← raw query helper
│   └── repositories.ts       ← DecisionRepo, MemoryRepo, TaskRepo, GrowthRepo
│
├── types/
│   └── index.ts              ← shared TypeScript interfaces
│
└── config.ts                 ← global config
```

---

## 4. Data Touchpoints

### Task Lifecycle

```
TaskRepo.create()       ← new task record, mode=direct|research
  → TaskRepo.updateExecution()   ← tokens_used + steps_used updated
  → TaskRepo.createTrace() × 3    ← classification / routing / response
```

### Memory v2 — Retrieval and Relevance (Sprint 04)

```
POST   /v1/memory                  ← MemoryEntryRepo.create()
GET    /v1/memory                  ← MemoryEntryRepo.list()
GET    /v1/memory/:id              ← MemoryEntryRepo.getById()
PUT    /v1/memory/:id              ← MemoryEntryRepo.update()
DELETE /v1/memory/:id              ← MemoryEntryRepo.delete()

chat.ts Step 4b                    ← MemoryEntryRepo.getTopForUser() → runRetrievalPipeline() → buildCategoryAwareMemoryText() — on every chat
```

**Injection path (v1, legacy):**
`getTopForUser()` → `taskSummary` → `assemblePrompt()` → `manageContext()` → model.

**Injection path (v2, active when `memory.retrieval.strategy === "v2"`):**
`getTopForUser()` → `runRetrievalPipeline()` → `buildCategoryAwareMemoryText()` → `taskSummary` → `assemblePrompt()` → `manageContext()` → model.

**Retrieval pipeline stages (MR-001/003):**
1. Score each candidate: importance (30) + recency (20) + keyword relevance (15)
2. Check category eligibility via `config.memory.retrieval.categoryPolicy`
3. Always-inject categories fill first (up to per-category maxCount)
4. Remaining slots filled by highest-scoring relevance-gated entries
5. Final output sorted by score descending

### Decision Log

```
DecisionRepo.save() ← full DecisionRecord on every chat request
DecisionRepo.updateFeedback() ← via /api/chat POST /feedback
```

### Growth Profile

```
GrowthRepo.getProfile() ← aggregates decision_logs + memories
GrowthRepo.addMilestone() ← written by learning engine
```

---

## 5. Task API Routes

All task APIs are read-only relative to a chat session. They do not write to the running chat flow.

```
GET /v1/tasks/all
  → TaskRepo.list(userId, sessionId?)
  → Returns: TaskListItem[] (limited to 100, ordered by updated_at DESC)

GET /v1/tasks/:task_id
  → TaskRepo.getById(taskId)
  → Returns: Task | null (404 if not found)

GET /v1/tasks/:task_id/summary
  → TaskRepo.getById(taskId) first (existence check)
  → TaskRepo.getSummary(taskId)
  → Returns: TaskSummary | 404 "Summary not found"
  → Note: returns 404 for new tasks without a generated summary — expected

GET /v1/tasks/:task_id/traces
  → TaskRepo.getById(taskId) first (existence check)
  → TaskRepo.getTraces(taskId)
  → Returns: TaskTrace[] (ordered by created_at ASC)
```

**Routing note (Hono 4.x):** `:task_id/summary` and `:task_id/traces` must be registered **before** `:task_id`. Otherwise the wildcard `:task_id` route shadows them.

---

## 6. Memory API Routes (Sprint 03 MC-002)

All memory APIs are user-scoped via `user_id` query param (default: `"default-user"`).

```
POST /v1/memory
  body: { category, content, importance?, tags?, source? }
  → MemoryEntryRepo.create()
  → Returns: { entry } (201)

GET /v1/memory
  query: ?user_id, ?category, ?limit (max 100)
  → MemoryEntryRepo.list()
  → Returns: { entries[] }

GET /v1/memory/:id
  query: ?user_id
  → MemoryEntryRepo.getById()
  → Returns: { entry } or 404

PUT /v1/memory/:id
  query: ?user_id
  body: { content?, importance?, tags?, category? }
  → MemoryEntryRepo.update()
  → Returns: { entry } or 404

DELETE /v1/memory/:id
  query: ?user_id
  → MemoryEntryRepo.delete()
  → Returns: 204 or 404
```

**Guardrails enforced:**
| Guard | Rule |
|---|---|
| `content` length | max 2000 characters |
| `importance` range | 1–5, coerced |
| `tags` count | max 10 per entry |
| `tags` length | max 50 chars per tag |
| List `limit` | max 100 per request |
| Injection entries | max 5 (`config.memory.maxEntriesToInject`) |
| Injection tokens | max 750 (`5 × 150`, enforced in `prompt-assembler.ts`) |
| v2 relevance score | no cap (components individually bounded; max theoretical total: 65) |
| `memory.retrieval.strategy` | enum: `"v1"` or `"v2"` |

---

## 7. Known Quirks

| # | Description | Impact | Workaround |
|---|---|---|---|
| Q1 | `decision-logger.ts` SQL has `$1`–`$27` placeholders but only 26 values passed; `fallback_reason` written in a separate UPDATE | Non-blocking: decision still saved, fallback_reason column may be NULL | Graceful degradation |
| Q2 | `GET /v1/tasks/:id/summary` returns 404 for new tasks without summary | Correct behavior — not a regression | Distinguish "Task not found" vs "Summary not found" by error message |
| Q3 | Task creation + all trace writes are fire-and-forget | Request response not affected | Monitor via task APIs if needed |
| Q4 | `MemoryEntryRepo.getTopForUser()` runs on every chat request | Potential latency if `memory_entries` table grows large | v2 retrieval adds scoring overhead; candidate pool capped at 1.5× injection limit |
| Q5 | `Complexity-scorer` intent base scores are hardcoded and language-agnostic | May not reflect actual complexity for non-chat/simple_qa intents | Rule-based router is intentionally simple; extend when data is available |
| Q6 | `POST /api/chat` endpoint, NOT `/v1/chat` | Existing API convention | Keep as-is |
| Q7 | `identity_memories.updated_at` stored as `number` (Unix ms), not ISO string | Internal inconsistency with task API format | Non-blocking (internal table) |

---

## 7. Suggested Future Cleanup Notes

| Priority | Item | Rationale |
|---|---|---|
| P1 | Fix SQL placeholder count in `DecisionRepo.save()` | Correctness issue, non-blocking but bad for debugging |
| ~~P1~~ | ~~Implement `taskSummary` injection in `assemblePrompt()`~~ | ✅ Done in Sprint 03 MC-003 |
| ~~P2~~ | ~~Add `memory_items_retrieved` to `ContextResult`~~ | ✅ Done in Sprint 04 (v2 pipeline adds scoring detail to memory injection path) |
| P2 | Add request-level caching for `MemoryEntryRepo.getTopForUser()` | Every chat does a DB read when memory enabled |
| P2 | Standardize internal time fields (`identity_memories.updated_at`, etc.) | TC-007 only covered outward task APIs |
| P2 | Consider `memory_retrieval_strategy=v2` as default once stable | v1 is the safe fallback; v2 adds value once confidence builds |
| P3 | Semantic/embedding-based relevance scoring | Save for Memory v3 |
| P3 | Behavioral memory batch reads with TTL cache | 50-row scan every chat request won't scale |
| P3 | Consider moving `quality-gate.ts` into `services/` | It contains business logic, not pure routing |
| P3 | Document `compressor.ts` compression algorithms | Compression behavior is opaque without reading the code |

---

## 8. Convention

All outward task-related API time fields return **ISO 8601 strings** (`"2026-04-08T02:24:14.782Z"`).
Internal DB storage format remains **Unix milliseconds number** (for now).

---

_Revised after Sprint 04 MR-004. Supersedes prior informal flow descriptions._
