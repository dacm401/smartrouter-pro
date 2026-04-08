# Current Sprint

**Sprint 04 — Memory v2: Retrieval and Relevance**
**Status:** ✅ Completed

---

## Task Cards

| Task Card | Status | Notes |
|---|---|---|
| MR-001 Memory Retrieval Policy | ✅ Done | commit `4893585` |
| MR-002 Category-Aware Injection | ✅ Done | commit `01c9075` |
| MR-003 Relevance Ranking for Chat Context | ✅ Done | commit `6c66797` |
| MR-004 Review + Guardrails | ✅ Done | commit `6c66797` |

---

## Sprint 04 Summary

Memory v2 upgrades the v1 memory injection system with:

- **Retrieval scoring**: importance (30) + recency (20) + keyword relevance (15) = max 65 pts
- **Category-aware formatting**: grouped sections with human-readable labels
- **Jaccard-normalised keyword matching**: stopword-filtered, stemmed, no long-text inflation
- **v1/v2 strategy toggle**: safe upgrade path, v1 as fallback
- **Explainable scores**: every result carries a `reason` string

**Key docs:**
- `docs/sprint-04-review.md` — Sprint 04 retrospective
- `docs/runtime-flow.md` — Memory v2 pipeline documented
- `docs/repo-map.md` — updated with new modules

---

## Next Sprint

**Sprint 05 proposal:** Execution Loop / Tool Actions

Details: TBD — see `docs/backlog.md` for candidate directions.
