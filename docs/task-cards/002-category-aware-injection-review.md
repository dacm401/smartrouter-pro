# MR-002 Review — Category-Aware Injection

## Card
**MR-002: Category-Aware Injection**

## Result
Completed

---

## Goals
Transform the flat `[category] content` memory text assembly into a structured, category-grouped prompt format, making injected memory more readable and interpretable by the model.

---

## What Was Done

### 1. New Function: `buildCategoryAwareMemoryText()`

Added to `backend/src/services/memory-retrieval.ts`:

```typescript
export interface CategoryAwareMemoryText {
  combined: string;               // Single text for prompt injection
  breakdown: Record<string, string[]>;  // Per-category list (for logging/debug)
}

export function buildCategoryAwareMemoryText(
  results: MemoryRetrievalResult[]
): CategoryAwareMemoryText
```

**Output format:**

```text
User memories:

Instructions & Goals:
- {entry.content}
- {entry.content}

Preferences:
- {entry.content}

Facts:
- {entry.content}

Context:
- {entry.content}
```

Only categories with at least one entry are included in the output.

### 2. Category Display Labels

| Internal Category | Prompt Section Label |
|---|---|
| `instruction` | Instructions & Goals |
| `preference` | Preferences |
| `fact` | Facts |
| `context` | Context |
| *(any other)* | Capitalized category name |

### 3. Consistent Category Ordering

Sections are ordered deterministically: `instruction → preference → fact → context → others`.
This ensures stable prompt output regardless of data order in the database.

### 4. `chat.ts` Integration

Replaced the flat assembly in `chat.ts` (line ~116):

```typescript
// Before (flat):
summaryText: retrievalResults
  .map((r) => `[${r.entry.category}] ${r.entry.content}`)
  .join("\n")

// After (category-aware):
summaryText: buildCategoryAwareMemoryText(retrievalResults).combined
```

### 5. TypeScript Build
Zero errors.

---

## Scope Boundary (What Was NOT Done)

- **No scoring changes**: Scoring logic stays in `runRetrievalPipeline()` (MR-001)
- **No category schema changes**: Existing `instruction`/`preference`/`fact`/`context` enum is unchanged
- **No new API endpoints**: This is a prompt-format change only
- **No embedding / semantic retrieval**: Deferred to MR-003

---

## Design Decisions

### 1. Category Labels vs Raw Category Names
Using human-readable labels (`Instructions & Goals` instead of `instruction`) reduces cognitive load for the model and makes prompt output more natural. Unrecognised categories fall back to capitalised names.

### 2. Bullet Points Over Inline Brackets
Bullet points (`- content`) under section headers are more scannable than inline `[category]` brackets. The category context is already conveyed by the section header, making the inline brackets redundant.

### 3. Per-Category Breakdown in Return Value
`CategoryAwareMemoryText.breakdown` returns a `Record<string, string[]>` for each category, which enables structured logging and future inspection tooling without changing the prompt format.

### 4. No Double Category Mentions
The section header already establishes category context; inline `[category]` tags are removed. This avoids redundancy in the prompt.

---

## File Changes

| File | Change |
|---|---|
| `backend/src/services/memory-retrieval.ts` | New `buildCategoryAwareMemoryText()` + `CategoryAwareMemoryText` interface + `CATEGORY_LABELS` + `getCategoryLabel()` |
| `backend/src/api/chat.ts` | Import new function; replace flat assembly with `buildCategoryAwareMemoryText()` |

---

## Regression Safety

- v1 strategy path: passes `retrievalResults` (flat list) to `buildCategoryAwareMemoryText()` → output is still grouped by category. Behavior is strictly richer, not different.
- v2 strategy path: already used `retrievalResults`; now also uses `buildCategoryAwareMemoryText()`. No functional change to retrieval, only to display format.
- Empty memory case: `taskSummary` is `undefined` when no memories → no change to empty-path behavior.

---

## MR-002 Assessment

This was intentionally small — a prompt-format upgrade, not a retrieval algorithm change. The scoring and filtering logic from MR-001 is untouched. MR-002 only changes what the model sees, not which memories are selected.
