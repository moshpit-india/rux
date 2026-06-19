# Proof Quarter — Routing With Receipts

Pre-registered: 2026-06-12. Window: 2026-06-12 through 2026-09-12.

This is a pre-registration, not a living doc. The bar below must not be edited after data collection starts; changes go in the Amendments section as dated entries. It exists as a separate file because `docs/STATE.md` is mutable current truth and a pre-registration must be immutable to mean anything.

## Claim Under Test

> `rux suggest` changes real routing decisions for the better.

By the end of the window, Rux's own ledger either proves this with cited evidence or honestly refutes it. A null result is a finding, not a failure.

## Protocol — What Counts As An Instrumented Decision

A routing decision is instrumented when the ledgers contain, for one task:

1. A routing report (`rux report --kind routing`) stating what `suggest` recommended (with its maturity label) and whether the operator followed or overrode it, with a reason for every override — stamped at decision time, never reconstructed later.
2. A linked live run or baselined manual record for the task.
3. A check result or human verdict on that run.

Until first-class decision events ship, the routing report is the approximation. When decision events ship, they replace it; earlier routing reports remain valid evidence.

## Pre-Registered Bar (by 2026-09-12)

- At least 40 instrumented routing decisions across at least 4 repos and at least 3 honest task kinds.
- At least 10 decisions where the recommendation diverged from default habit, or where the operator overrode the recommendation. Divergences are the test set.
- Divergence win-rate judged only by checks, human verdicts, and lifecycle marks. No LLM judges.
- Close the standing zeros: at least 5 completed live Claude task runs; at least 5 real lifecycle marks; provider-observed model metadata on the majority of new live runs; new-run verdict coverage at or above 60%.

## Kill Criterion

If by 2026-08-01 there are at least 20 instrumented decisions and either (a) `suggest` never diverged from habit, or (b) divergences show no win-rate advantage over overrides, record the null result in `docs/STATE.md`, stop promoting `suggest` claims in any public surface, and redirect the roadmap.

## Success Artifact

A README "receipts" section generated from real, unedited `rux export`/`rux suggest` output, maturity labels and run IDs included. It becomes the public launch asset only after the bar is met — no launch, no partner program inside this window.

## Build Work Allowed This Quarter

Only what the protocol needs: a first-class decision/adherence event schema to replace the routing-report approximation; a read-only scorecard view extending `status`/`rank` (adherence rate, followed-vs-overridden win rates, regret cases, every figure citing run IDs); friction fixes that block the quotas. No dashboards, no hosted sync, no dynamic rosters, no new surfaces.

## Amendments

- 2026-06-19: The `--in-session <cli>` signal (rux 0.2.2+, now wired into the propagated agent discipline) lets `suggest` weigh handoff cost and therefore agree with the in-session runner more often. This shrinks the divergence test set: fewer recommendations differ from habit. Clarification for the kill-check (does not edit the bar): a "good divergence" should be read as a case where `suggest` recommends a *different* runner than the in-session one and is right to (judged by checks/verdicts/lifecycle marks), not merely any operator override. Overrides of cold-start recommendations that simply restate "continue where I already am" are no longer the interesting signal now that in-session is first-class.
