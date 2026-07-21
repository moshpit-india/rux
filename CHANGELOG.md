# Changelog

Notable changes to `@moshpits/rux`, newest first. Release rules live in [docs/STANDARDS.md](docs/STANDARDS.md): weekly patch train, emergency patches only for dangerous or breaking behavior, version bumps only when cutting a release.

## 0.3.0 — 2026-07-21

Adds the read-only proof-quarter routing scorecard — the instrument `docs/PROOF.md` allows for judging whether `suggest` changes routing decisions for the better.

- `rux status --scorecard` reports adherence rate, followed-versus-overridden outcomes, the divergence test set, regret cases, standing-zero progress, and kill-criterion inputs, citing run IDs on every figure. It parses each stamped routing note as the decision-time record rather than recomputing the recommendation, and lists notes it cannot read as `unclassified` with their parse gaps.
- `rux status --scorecard --repos PATH[,PATH...]` pools decisions from explicitly named local repos, since the pre-registered quotas are cross-repo. Each repo is scored on its own ledger, so report-to-run joins never cross repo boundaries. Adds a per-repo breakout, a concentration warning when one repo supplies most of the record, bar-target progress, and parse coverage.
- `--since` / `--until` override the pre-registered window.

Read-only throughout: no ledger writes, no provider calls, no network, no auto-discovery, and no LLM judges. The view reports kill-criterion inputs and never declares the null result itself.

## 0.2.4 — 2026-07-21

Packaging and developer-experience polish. No runtime behavior changes.

- README rewritten as a concise public entry surface: badges, requirements, quickstart, loop-by-command table, safety defaults, honest recommendation claims.
- `rux help` output grouped by loop step with one-line command descriptions.
- npm metadata: keywords, author, and a sharper package description for discovery.
- Added this changelog; release notes now have a durable home.

## 0.2.3 — 2026-06-19

Routing-quality release: the first proof-quarter friction fixes, addressing the day-6 finding that `suggest` recommended unwarranted handoffs.

- `rux suggest --in-session claude|codex|gemini` weighs handoff cost instead of assuming every decision starts cold.
- Suggest matches query and evidence on the effective (changed-file corrected) task kind rather than mislabeled stored kinds.
- Provider model metadata is observed from real provider usage maps (Claude `modelUsage`, Gemini `stats.models`); Codex stays honestly `not_observed`. Verified against installed CLIs.

## 0.2.2 — 2026-06-14

Token-governor release.

- Advisory `token_governor` block in `rux.policy.json`: caps on visible tool output, session-handoff triggers, and budget-reason requirements for expensive models, high effort, subagents, and review agents.
- Rux-wrapped provider runs cap visible provider output while keeping full output in transcripts.
- npm publish dry-run supported in the local smoke.

## 0.2.1 — 2026-06-12

- Opt-in `--stream` mode for the Claude adapter.
- Better human-readable CLI surfaces and README.

## 0.2.0 — 2026-06-11

Wave 2 graduation: capture attribution and honest labeling hardening.

- Command-boundary file fingerprints attribute changed files to provider, check, or pre-existing dirt; inline-check mutations no longer credit the provider.
- Deterministic run-status precedence and read-time `effective_status` so old false positives can count as evidence without rewriting history.
- Vacuous-check flagging: passing checks that prove no useful work are blocked from routing evidence.
- Human-readable TTY output with dedicated summaries for `plan`, `suggest`, `rank`, `doctor`, and `export`; JSON preserved for pipes and `--json`.
- Interactive verdict prompts; ledger events move to `schema_version: 2` (v1 stays readable).
- Unknown CLI options fail before execution with nearest-option suggestions.

## 0.1.0 – 0.1.6 — 2026-06-08 to 2026-06-10

The capture spine, released as fast-follow patches while dogfooding:

- Repo-local append-only ledger under `.rux/` with `init`, `run`, `record`, `ls`, `show`, `eval`, `outcome`, `status`, `export`, `policy`, `doctor`, `report`, `propose`, and `release-check`.
- Conservative plan-mode adapters for Claude, Codex, and Gemini CLIs, plus a `fake` runner for smoke tests; provider auth always inherited, never stored.
- Explicit `--provider-mode plan|write`, dirty-worktree refusal for real runs, `--write-scope` violations recorded as failed runs.
- Manual current-session records with baselines (`rux record --start`), checks, verdicts, lifecycle marks, and feedback reports.
- Provider-smoke release evidence, strict release gate, and fixed rosters (`solo`, `pair`, `repair`, `plan-code-review`).
