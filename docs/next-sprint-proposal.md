# Next Sprint Proposal

## Recommended Sprint Name
Repository Cleanup and Runtime Foundation Hardening

## Recommended Goal
Reduce structural confusion in the codebase and strengthen runtime foundations before adding larger new capabilities.

---

## Priority Candidates

### Option A: Repository Cleanup Sprint
Focus on:
- file/module structure cleanup
- route/service/repository organization
- naming consistency
- timestamp format consistency
- remove confusing leftovers from demo phase

### Option B: Memory v1 Sprint
Focus on:
- user-editable memory model
- memory read/write rules
- memory retrieval injection points
- memory APIs

### Option C: Evidence/Retrieval v1 Sprint
Focus on:
- evidence model
- evidence extraction pipeline
- retrieval integration points
- evidence-aware response path

---

## Recommendation
Run **Option A first**.

Reason:
The current repository has started to work well, but structural mess will make future memory/evidence work harder and riskier.
A cleanup sprint now will reduce future implementation cost.

---

## Suggested Scope for Next Sprint
- define target folder structure
- move prompt-related logic into a clearer module area
- standardize API time fields
- review repo/service boundaries
- clean up naming inconsistencies
- document actual runtime flow

---

## Success Criteria
- repository is easier to navigate
- runtime modules are more clearly separated
- future feature work can be assigned to AI with less ambiguity
