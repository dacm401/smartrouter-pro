# TC-005 Review: Repo Structure Audit and Target Layout

## Status
Done

## Goal
Audit the repository structure, define a clearer target layout, and apply a small set of safe move-now cleanup changes.

## Audit Findings
- `observatory/` naming was unclear for current runtime responsibilities
- `evolution/` naming overstated actual implemented capabilities
- `memory-store.ts` was misplaced under feature-oriented structure
- module naming could be made more explicit for future AI-assisted development

## Move-Now Changes Applied
- renamed `src/observatory/` to `src/logging/`
- renamed `src/evolution/` to `src/features/`
- moved `memory-store.ts` into `src/services/`
- updated static imports and dynamic imports
- updated `docs/repo-map.md`

## Validation
- build passed
- container restart passed
- regression checks passed
- POST /api/chat → passed
- task/detail/summary/trace paths → passed

## Commit
- docs kickoff: e0eb231
- refactor cleanup: 45a7ae9

## Notes
- TC-005 expanded beyond pure documentation into a safe first cleanup pass
- `context-manager.ts` move was intentionally deferred to TC-006
