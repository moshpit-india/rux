# Decisions

This is the lightweight decision log for Rux. Add entries when a choice would otherwise become tribal memory or cause repeat mistakes.

## RUX-001: Capture Before Routing

- Date: 2026-06-08
- Decision: Rux records real runs and outcomes before it claims learned routing.
- Reason: Routing without labels is theater. Checks, verdicts, changed files, and downstream marks are the first trustworthy signals.
- Consequence: `suggest`, `rank`, and `plan` must explain evidence maturity and stay conservative when the ledger is thin.
- Revisit when: repeated task evidence exists across multiple runners, rosters, and repos.

## RUX-002: Wrap Provider CLIs, Do Not Become a Model Gateway

- Date: 2026-06-08
- Decision: Rux wraps existing coding-agent CLIs and inherits their auth, settings, and native behavior.
- Reason: Developers already use Claude Code, Codex, Gemini, editors, and terminals. Rux should add memory around those tools, not replace them.
- Consequence: Provider credentials are not stored in Rux, and adapter flags must be verified against installed CLIs.
- Revisit when: a hosted runner layer exists and needs a separate auth/security model.

## RUX-003: stdout Is Machine Output Unless The Terminal Is Interactive

- Date: 2026-06-08
- Amended: 2026-06-11
- Decision: Rux keeps JSON on stdout when output is piped or redirected, but prints concise human-readable output when stdout is an interactive TTY. `--json` always forces JSON. Provider output, progress, checks, prompts, and diagnostics stay on stderr.
- Reason: Scripts need parseable output, while the default terminal experience should be readable without requiring users to pipe through `jq`.
- Consequence: New command surfaces must support the same contract: TTY human output, piped JSON, and explicit `--json` override. Provider questions and Rux heartbeats must remain visible without corrupting machine output.
- Revisit when: an interactive TUI or protocol transport becomes the primary interface.

## RUX-004: Safety Failures Stay Failed

- Date: 2026-06-08
- Decision: If a provider asks for input or changes files in plan mode, Rux records the run but does not treat it as successful routing evidence.
- Reason: Silent success on unsafe or incomplete execution would poison the ledger.
- Consequence: `provider_needs_input` becomes blocked, and `provider_plan_changed_files` becomes failed even if checks pass.
- Revisit when: adapters can express provider approval/input state through structured APIs.

## RUX-005: Release Train Over Tiny Publishes

- Date: 2026-06-08
- Decision: Normal fixes batch into a weekly patch train; emergency patches are reserved for dangerous execution, data loss, broken installs, provider auth/security breakage, or unusable packages.
- Reason: Publishing every small fix creates version noise and lowers trust.
- Consequence: Version bumps happen only at release cut, and `release:verify` remains the publish gate.
- Revisit when: release volume or user adoption requires a more formal cadence.

## RUX-006: Swami-Lite Docs

- Date: 2026-06-08
- Decision: Rux adopts Swami's recurrence-prevention principle with a smaller docs system: vision, state, architecture, plan, standards, decisions, and docs checks.
- Reason: Repeat hiccups should become documented decisions or verifiable checks, but Rux should stay readable in minutes.
- Consequence: No manifest, generated wiki, or phase machinery until the repo earns it.
- Revisit when: docs drift becomes frequent enough to justify stronger indexing or generation.

## RUX-007: Feedback Reports Before External Issue Automation

- Date: 2026-06-09
- Decision: Agents record Rux dogfood feedback with `rux report` before any GitHub issue or hosted tracker automation exists.
- Reason: Early learning should be local, low-friction, and broader than failures. Confusing UX, adapter friction, ideas, and successful patterns are all useful evidence.
- Consequence: Report events and markdown files live in the repo-local `.rux/` store, can link to run IDs and commands, and do not change source, routing policy, or external issue state.
- Revisit when: the hosted/team layer is ready to sync curated reports into shared backlog workflows.

## RUX-008: Dirty Worktrees Block Real Provider Runs

- Date: 2026-06-09
- Decision: Rux refuses to launch real provider CLIs when the target git worktree has uncommitted changes outside `.rux/`, unless the user passes `--allow-dirty`.
- Reason: Dogfood found that running provider CLIs in a shared dirty checkout can race with concurrent agent/user work and destroy uncommitted changes.
- Consequence: Users must commit, stash, revert, or explicitly override before real provider execution. Fake runs stay allowed in dirty trees for local ledger development.
- Revisit when: worktree isolation is implemented and can safely run providers away from the user's active checkout.

## RUX-009: Write Scope Violations Are Failed Runs

- Date: 2026-06-09
- Decision: Rux lets users declare allowed files/directories with `--write-scope` and records a failed run when providers edit outside that scope.
- Reason: Dogfood showed Gemini write mode editing files outside explicit task scope. Until Rux has stronger isolation or patch approval, scope breaches must become visible negative evidence.
- Consequence: `write_scope_violation` appears in run status, output signal, eval routing blockers, outcome risks, and exports.
- Revisit when: provider adapters can enforce write allowlists before edits, not just classify them after the run.

## RUX-010: Manual Current-Session Records Count, But Do Not Replace Adapter Evidence

- Date: 2026-06-09
- Decision: `rux record` captures current-session work after the fact without launching a nested provider CLI.
- Reason: Dogfood showed that agents using Rux from inside an active Codex session could only run `rux plan` plus `rux report`; nesting another provider run just to satisfy capture would waste tokens and distort the evidence loop.
- Consequence: Manual records can become recommendation evidence when they are high-confidence and backed by checks or verdicts. They remain clearly marked as manual, are down-weighted in scoring, carry a `manual_capture` outcome risk, respect `--write-scope`, and do not satisfy release gates that require adapter-observed provider task evidence.
- Revisit when: Codex, Claude, Gemini, or editor integrations expose a first-class way for Rux to observe the active session directly.

## RUX-011: Post-Goal Claude Review Is A Ritual, Not Infrastructure

- Date: 2026-06-10
- Decision: After a goal is achieved, use Claude CLI for lead-style review/advice before setting the next goal, but keep the mechanism to one prompt template and an explicit command.
- Reason: The user wants a recurring second-opinion loop, but turning it into a daemon, scheduler, or service would add process weight before the product earns it.
- Consequence: `prompts/post-goal-review.md` is the harness. Prompts are sanitized by default; private workspace details require explicit user approval after the disclosure risk is stated. If a requested model alias is unavailable, the fallback must be reported.
- Revisit when: goal closeouts become frequent enough that manual invocation is the bottleneck.

## RUX-012: Evidence Taxonomy Is Explicit, Not Inferred

- Date: 2026-06-11
- Decision: New records must keep purpose, task kind, provider mode, and provenance explicit. Absent `--task-kind`, Rux records `task_kind: unspecified` with a non-authoritative suggestion instead of silently inferring docs work.
- Reason: Dogfood showed that inferred labels made implementation runs look like documentation work and polluted routing evidence.
- Consequence: `provider_mode`, `purpose`, `task_kind_source`, and `task_kind_suggestion` are first-class read surfaces. Probe runs are excluded from `suggest` and `rank` unless explicitly included.
- Revisit when: there is enough labeled local evidence to justify stronger task-kind defaults without hiding uncertainty.

## RUX-013: Release Evidence Preserves Attempts

- Date: 2026-06-11
- Decision: Provider-smoke runs are release evidence only, and repeated attempts remain visible instead of being collapsed into the final pass.
- Reason: Silent retries would recreate the same dishonesty as vacuous passing checks: a green gate with no memory of what failed before it.
- Consequence: `status` and `release-check` expose latest provider-smoke attempt IDs, passing run IDs, attempt chains, and attempt history. Provider-smoke records stay excluded from routing evidence and cannot receive checks, verdicts, or lifecycle marks.
- Revisit when: release orchestration grows a first-class retry manager.

## RUX-014: Public Pages Must Trail Ledger Proof

- Date: 2026-06-11
- Decision: The Wave 2 static landing page was cut. README remains the public entry surface until a page can show only claims the ledger can demonstrate.
- Reason: The sprint's core evidence work shipped; adding a page before wave-exit proof would create marketing surface area without improving the product loop.
- Consequence: Landing pages are allowed later, but only as small static proof surfaces grounded in real `run -> show -> verdict -> outcome` output and current `suggest` maturity counts. No broad marketing site, dashboard, or inflated claims.
- Revisit when: Wave-exit evidence produces at least two defensible, directional-or-better heuristics and the page can cite real local output.

## RUX-015: Token Discipline Belongs In Rux Policy

- Date: 2026-06-12
- Decision: Rux owns the operating policy for agent token discipline through `rux.policy.json` and its `token_governor` block.
- Reason: Local `.claude` and `.codex` session analysis showed that the largest waste pattern is repeated context and oversized tool output, not verbose final answers. A reminder in every repo will not hold over time; agents need one policy source to read before choosing routes, effort, subagents, and output volume.
- Consequence: Global Claude/Codex instructions and project `AGENTS.md` files should point at Rux policy instead of duplicating thresholds. `rux policy`, `rux status`, and `rux plan` expose the policy. `rux run` caps visible provider output while retaining full transcripts. The current mode is still advisory until Rux grows live-session interruption and broader command-output brokering.
- Revisit when: Rux can observe live session usage, broker tool output, or automatically start handoff/resume flows.

## RUX-016: Observed Model Metadata Comes From Provider Usage Maps

- Date: 2026-06-14
- Decision: The adapter reads the observed model from the provider's usage map (the key inside Claude `modelUsage` / Gemini `stats.models`), not from a top-level `model` field, and Codex stays honestly `not_observed` because `codex exec --json` reports no model.
- Reason: Wave 2 shipped structured-output parsing but keyed on a `model` field the installed CLIs do not emit — the model name is a map *key*, not a value — so every real run recorded `metadata_sources.model` as `not_observed` or `user_option`, and the smoke mocks emitted a fictional `model` field that confirmed the parser instead of reality. Verified against claude 2.1.170, codex 0.128.0, gemini 0.44.1.
- Consequence: Real runs now record `metadata_sources.model == "observed"` (primary model chosen by cost, context-window suffix like `[1m]` stripped), closing the Proof Quarter standing-zero for provider-observed metadata. Mocks now emit real installed-CLI shapes so the smoke exercises the true parse path. Provider output shapes stay volatile per AGENTS.md; the usage-map extractor is the documented contract, and a missing map degrades to byte-count capture rather than a fabricated model.
- Revisit when: A provider CLI changes its usage-map shape or begins emitting a stable top-level model/effort field.
