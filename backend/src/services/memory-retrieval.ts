/**
 * Memory Retrieval Service — MR-001
 *
 * Implements the v2 retrieval policy for memory injection.
 *
 * Retrieval Strategy:
 * - v1 (legacy): ORDER BY importance DESC, updated_at DESC
 * - v2 (category-aware): score each entry by (recency + importance + keyword match),
 *   then apply per-category injection policies.
 *
 * Design goals:
 * - Explainable: every score has a human-readable `reason` string
 * - Configurable: category policies live in config.ts, not hard-coded
 * - Safe fallback: if v2 returns no results, falls back to v1
 * - No external dependencies: keyword matching is simple token overlap
 */

import type {
  MemoryEntry,
  MemoryRetrievalContext,
  MemoryRetrievalResult,
  MemoryCategoryPolicy,
} from "../types/index.js";

// ── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Compute a relevance score for a single memory entry given retrieval context.
 * Score is additive: importance component + recency component + keyword component.
 *
 * All weights are fixed constants (not config) to keep the model explainable.
 * Config controls eligibility (via categoryPolicy), not scoring weights.
 */
export function scoreEntry(
  entry: MemoryEntry,
  context: MemoryRetrievalContext
): { score: number; reason: string } {
  const reasons: string[] = [];

  // Importance component: 0–30 points (5 levels × 6)
  const importanceScore = entry.importance * 6;
  reasons.push(`importance=${entry.importance}`);

  // Recency component: 0–20 points
  // Score = 20 * decay(updatedAt, 30 days)
  const ageMs = Date.now() - new Date(entry.updated_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyScore = Math.max(0, Math.round(20 * Math.pow(0.9, ageDays / 10)));
  reasons.push(`recency=${recencyScore}pts(age=${ageDays.toFixed(1)}d)`);

  // Keyword component: 0–10 points
  // Simple token overlap between userMessage and entry.content + tags
  let keywordScore = 0;
  if (context.keywords && context.keywords.length > 0) {
    const contentTokens = extractTokens(entry.content);
    const tagTokens = entry.tags.flatMap(extractTokens);
    const allTokens = new Set([...contentTokens, ...tagTokens]);

    const matchedKeywords = context.keywords.filter((kw) =>
      allTokens.has(kw.toLowerCase())
    );
    keywordScore = Math.min(10, matchedKeywords.length * 5);
    if (keywordScore > 0) {
      reasons.push(`keywords=${matchedKeywords.join(",")}`);
    }
  }

  const total = importanceScore + recencyScore + keywordScore;
  return { score: total, reason: reasons.join(" | ") };
}

// ── Category eligibility ─────────────────────────────────────────────────────

/**
 * Determine if a memory entry is eligible for injection under category policy.
 * Returns { eligible, reason }.
 */
export function isEligibleForInjection(
  entry: MemoryEntry,
  policy: MemoryCategoryPolicy
): { eligible: boolean; reason: string } {
  if (entry.importance < policy.minImportance) {
    return {
      eligible: false,
      reason: `importance ${entry.importance} < minImportance ${policy.minImportance}`,
    };
  }
  if (policy.alwaysInject) {
    return { eligible: true, reason: "alwaysInject=true" };
  }
  return { eligible: true, reason: "relevance-gated" };
}

// ── Retrieval pipeline ─────────────────────────────────────────────────────

export interface RetrievalPipelineInput {
  entries: MemoryEntry[];
  context: MemoryRetrievalContext;
  categoryPolicy: Record<string, MemoryCategoryPolicy>;
  maxTotalEntries: number;
}

/**
 * Run the v2 retrieval pipeline on a set of candidate entries.
 *
 * Pipeline:
 * 1. Score each entry (importance + recency + keyword match)
 * 2. Check category eligibility via categoryPolicy
 * 3. Build per-category pools (respecting maxCount per category)
 * 4. Always-inject categories fill first (up to maxCount)
 * 5. Remaining slots filled by highest-scoring relevance-gated entries
 * 6. Sort final result by score descending
 *
 * Returns entries with scores, sorted by relevance.
 */
export function runRetrievalPipeline(
  input: RetrievalPipelineInput
): MemoryRetrievalResult[] {
  const { entries, context, categoryPolicy, maxTotalEntries } = input;

  // Step 1: score all entries
  const scored = entries.map((entry) => {
    const { score, reason } = scoreEntry(entry, context);
    const policy = categoryPolicy[entry.category];
    const { eligible, reason: eligReason } = policy
      ? isEligibleForInjection(entry, policy)
      : { eligible: true, reason: "no-policy" };

    return {
      entry,
      score: eligible ? score : 0,
      reason: eligible ? reason : `${reason} → ineligible(${eligReason})`,
      eligible,
      alwaysInject: policy?.alwaysInject ?? false,
    };
  });

  // Step 2: separate alwaysInject from relevance-gated
  const alwaysInjectPool = scored
    .filter((s) => s.alwaysInject && s.eligible)
    .sort((a, b) => b.score - a.score);

  const relevanceGatedPool = scored
    .filter((s) => !s.alwaysInject && s.eligible)
    .sort((a, b) => b.score - a.score);

  // Step 3: per-category maxCount enforcement for alwaysInject
  const categoryMaxCounts: Record<string, number> = {};
  const alwaysInjectSelected: MemoryRetrievalResult[] = [];

  for (const item of alwaysInjectPool) {
    const cat = item.entry.category;
    const policy = categoryPolicy[cat];
    const maxCount = policy?.maxCount ?? 2;
    const currentCount = categoryMaxCounts[cat] ?? 0;
    if (currentCount < maxCount) {
      alwaysInjectSelected.push({
        entry: item.entry,
        score: item.score,
        reason: `[${cat}] ${item.reason}`,
      });
      categoryMaxCounts[cat] = currentCount + 1;
    }
  }

  // Step 4: fill remaining slots with highest-scoring relevance-gated entries
  const remainingSlots = maxTotalEntries - alwaysInjectSelected.length;
  const relevanceSelected = relevanceGatedPool
    .slice(0, remainingSlots)
    .map((s) => ({
      entry: s.entry,
      score: s.score,
      reason: `[${s.entry.category}] ${s.reason}`,
    }));

  // Step 5: merge and sort by score
  const result = [...alwaysInjectSelected, ...relevanceSelected].sort(
    (a, b) => b.score - a.score
  );

  return result;
}

// ── Category display labels ───────────────────────────────────────────────────

/** Human-readable section labels for each memory category in the injected prompt. */
const CATEGORY_LABELS: Record<string, string> = {
  instruction: "Instructions & Goals",
  preference: "Preferences",
  fact: "Facts",
  context: "Context",
};

/** Default label for unknown or unrecognised categories. */
function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

// ── Category-aware memory text assembly ─────────────────────────────────────

export interface CategoryAwareMemoryText {
  /** Single combined text ready for prompt injection. */
  combined: string;
  /** Breakdown by category, for logging / debugging. */
  breakdown: Record<string, string[]>;
}

/**
 * Build a structured, category-grouped memory text for prompt injection.
 *
 * Output format:
 * ```
 * User memories:
 *
 * Instructions & Goals:
 * - ...
 * - ...
 *
 * Preferences:
 * - ...
 *
 * Facts:
 * - ...
 * ```
 *
 * Only categories with at least one entry are included.
 * MR-002: Replaces the flat "[category] content" assembly with a grouped format.
 */
export function buildCategoryAwareMemoryText(
  results: MemoryRetrievalResult[]
): CategoryAwareMemoryText {
  // Group by category, preserving retrieval order within each group
  const groups: Record<string, string[]> = {};
  for (const r of results) {
    const cat = r.entry.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(r.entry.content);
  }

  // Build human-readable sections
  const sections: string[] = [];
  const breakdown: Record<string, string[]> = {};

  // Enforce consistent category ordering: instruction > preference > fact > context > others
  const categoryOrder = ["instruction", "preference", "fact", "context"];
  const orderedCats = [
    ...categoryOrder.filter((c) => groups[c]),
    ...Object.keys(groups).filter((c) => !categoryOrder.includes(c)),
  ];

  for (const cat of orderedCats) {
    const label = getCategoryLabel(cat);
    const items = groups[cat];
    breakdown[cat] = items;
    sections.push(`${label}:\n${items.map((item) => `- ${item}`).join("\n")}`);
  }

  return {
    combined: sections.join("\n\n"),
    breakdown,
  };
}

// ── Keyword extraction ───────────────────────────────────────────────────────

/**
 * Extract lowercase tokens from a string.
 * Simple whitespace split + basic cleaning.
 */
function extractTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
