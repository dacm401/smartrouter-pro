# Sprint 04 Review

## Sprint Name
Memory v2: Retrieval and Relevance

## Result
Completed

---

## Goals
Upgrade the Memory v1 injection system from a flat `importance + recency` heuristic into a context-aware, category-differentiated, explainable retrieval pipeline.

---

## Delivered

### MR-001
- Retrieval scoring policy introduced
- `MemoryRetrievalContext`, `MemoryRetrievalResult`, `MemoryCategoryPolicy` types added
- `config.memory.retrieval` config section added (strategy: `v1` | `v2`, categoryPolicy)
- `runRetrievalPipeline()` service implemented
- v1/v2 strategy toggle via `MEMORY_RETRIEVAL_STRATEGY` env var
- v2 empty fallback to v1 preserved

### MR-002
- Category-aware prompt formatting introduced
- `buildCategoryAwareMemoryText()` — groups memories by category with human-readable labels
- Section order enforced: instruction → preference → fact → context → others
- `combined` text for injection + `breakdown` for structured logging
- Flat `[category] content` format retired from v2 path

### MR-003
- Keyword relevance scoring significantly upgraded
- Stopword filtering: 80+ English + 40+ Chinese stopwords
- Lightweight stemming via `simpleStem()` (English: -ing/-ed/-es/-s; Chinese: 的)
- Jaccard normalisation prevents long-text score inflation
- Query-driven relevance (uses `userMessage` directly; no external keywords needed)
- Score range: importance (30) + recency (20) + keyword (15) = max 65
- Every scored result carries a human-readable `reason` string

### MR-004
- End-to-end regression verified across all memory paths
- Guardrail audit confirmed all boundaries are active
- `runtime-flow.md` fully updated with Memory v2 pipeline
- `repo-map.md` updated with new modules and retrieval path
- Sprint 04 review doc archived
- Sprint formally closed

---

## What Improved

### 1. Memory Injection is Now Context-Aware
The system no longer blindly injects the highest-importance memories. It scores and ranks them against the current conversation, filters by category policy, and formats them for interpretability.

### 2. Explainable Scoring
Every memory that enters the prompt now has a score with a human-readable reason string. This makes retrieval quality reviewable, tunable, and debuggable.

### 3. Better Prompt Format
Category-grouped sections with labels are more model-readable than a flat list of bracketed tags. The category signal is now structural, not cosmetic.

### 4. Safe Upgrade Path
The v1/v2 strategy toggle means the system can never break existing behaviour. v2 can be enabled per-request or per-environment without risk.

---

## Known Limitations

- Lexical relevance only — no semantic similarity
- Manual memory creation required — no auto-extraction
- Category schema is the v1 set — `goal`/`constraint` not yet differentiated
- No memory deduplication or conflict resolution
- v2 scoring weights are heuristic constants — not tuned on feedback

---

## Deferred Work
- Memory v3: embedding-based semantic retrieval
- Memory auto-extraction from conversation history
- Category schema expansion
- Memory conflict resolution / merge policy
- Retrieval quality feedback loop
- TTL / memory expiration
- Batch caching for retrieval reads

---

## Final Assessment
Sprint 04 successfully transformed Memory v1 from "a pile of memories injected blindly" into "a retrieval pipeline with context awareness, category differentiation, and explainable scoring." The upgrade is bounded, safe, and documented. The next natural step is Memory v3 (semantic relevance) or execute loop integration.
