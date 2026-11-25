# Hourly role: verification and stabilization

This cycle focuses on tests, reliability, review, and fixing regressions in КВАРД.

1. Read repository agent instructions and inspect recent commits, active PRs and workflow results where accessible.
2. Run focused tests and/or typecheck/lint/build for the most critical changed or previously failing areas. Avoid wasting runner time on redundant full-suite runs when recent CI provides evidence.
3. Review the current work branch diff for security, tenancy, persistence, error handling, cancellation, race conditions, regressions, missing tests, and claims that are not supported.
4. Fix a concrete bug or add a regression test when feasible; prefer one focused repair. If no code fix is warranted, improve verification documentation/check scripts or report exact verified gaps.
5. Do not merge, deploy, delete data, change DNS, spend money, or expose secrets. Do not claim a live test unless actually performed.
6. Summarize findings, fixes, commands and exact outcomes, blockers, and the next priority.