# Current State

Last updated: 2026-06-12

## One-Line Summary

Rux is a public coding-agent run ledger that records real outcomes first, then uses that evidence to recommend agent rosters. The current npm release is `@moshpits/rux@0.2.2`, and the release posture is still test first: local verification before every publish.

## Decisions

- Build from scratch in `/Users/mihir/Documents/code/moshpit-india/rux`.
- Keep the current folder name for now; the selected product name is Rux.
- Do not use Vane as the release name; it conflicts with the popular [ItzCrazyKns/Vane](https://github.com/ItzCrazyKns/Vane) AI answering-engine project.
- Keep runtime naming centralized in `src/identity.mjs`.
- NPM org created: `moshpits` (`https://www.npmjs.com/org/moshpits`). Public package metadata lives under `@moshpits/rux`. The unscoped `rux` npm package is already occupied by an old, unrelated React/observable package; use the scoped package plus `rux` bin.
- `@moshpits/rux@0.2.2` is the token-governor release. It keeps the `0.2.1` opt-in Claude `--stream` mode and adds advisory `token_governor` policy plus visible provider-output capping for Rux-wrapped provider runs while preserving full transcript output.
- Package privacy has been deliberately removed for public release after local smoke, real provider smoke, and first routing-eligible provider task evidence passed.
- Keep the npm package lean. The package allowlist includes runtime source and the default policy file; internal docs, tests, and agent instructions stay repo-only.
- Local smoke now verifies the npm tarball contents, installs the packed tarball into a temporary prefix, and runs the installed `rux` bin.
- Start with docs, then a CLI focused on runner + capture.
- Treat v0.1 as the capture spine. Routing, roster planning, and self-improvement are product direction, not day-one implementation.
- Use repo-local files in v0. No daemon, server, or database until the capture loop proves useful.
- `rux init` creates a repo policy file and ensures `.rux/` is ignored without creating the ledger store or calling providers.
- Keep provider auth outside Rux.
- Claude runner capture is implemented conservatively: non-interactive `claude -p`, text output, and `--permission-mode plan`.
- Codex runner capture is implemented conservatively against the installed CLI: non-interactive `codex exec`, read-only sandbox, and color off.
- Gemini runner capture is implemented conservatively against the installed CLI: non-interactive `gemini -p`, text output, `--approval-mode plan`, and `--skip-trust`.
- `rux run` now supports explicit `--provider-mode plan|write`. The default remains `plan`; `write` maps to Claude `acceptEdits`, Codex `workspace-write`, and Gemini `auto_edit`. Planner/reviewer/provider-smoke legs remain plan-only.
- `rux record --start "<task>" --runner claude|codex|gemini` appends a manual session-baseline event with HEAD, dirty-file status, and dirty-file fingerprints. A later `rux record` diffs against the newest open baseline, warns on stderr when multiple open baselines exist, closes the open baselines it saw, and flags files that were already dirty at baseline but changed again as `contaminated_files`.
- `rux record "<task>" --runner claude|codex|gemini` captures current-session work without launching a nested provider CLI. Manual records store repo state, changed files, optional checks, notes, replay boundary metadata, optional session-baseline linkage, and an adapter note saying Rux did not observe the provider invocation. Checked or reviewed manual records can guide local recommendations, but they are down-weighted, labeled as manual evidence, subject to `--write-scope`, and do not satisfy release provider-task evidence.
- `rux report --kind success` now requires an existing successful run link, an inline successful manual record via `--record`, or an explicit `--no-run` reason. Other report kinds stay low-friction and print a stderr nudge when unlinked. Linked reports now appear on `show`, `eval`, and `export` so review surfaces do not lose the report-to-run relationship.
- `changed_files` attribution now uses command-boundary fingerprints instead of only git status codes. Untracked directories expand to leaf files, same-status dirty file edits are detected, inline `--check` mutations are attributed to the check instead of the provider run, and post-run checks use the same file-level attribution.
- Real provider launches now refuse dirty worktrees by default. Users must commit, stash, or revert existing changes first, or pass `--allow-dirty` when those changes are intentionally part of the provider context. Fake runs remain allowed in dirty trees for local smoke and ledger development.
- `rux run --write-scope "path[,path...]"` records the intended write boundary for a provider run. If the provider changes files outside those exact files or directory prefixes, the run is recorded as `failed` with `status_reason: write_scope_violation`, and routing/eval/export surface the violation.
- Provider stdout/stderr is mirrored to Rux stderr while the provider runs, while Rux stdout stays JSON for scripts.
- When stdout is an interactive TTY, Rux prints concise human-readable command output by default. Piped or redirected output remains JSON, and `--json` forces JSON on supported command surfaces. `plan`, `suggest`, `rank`, `doctor`, and `export` now have dedicated human summaries instead of the generic result wrapper.
- Rux now prints its own provider/check progress to stderr: provider start, periodic still-running heartbeat, provider finish, check start, check finish, and final ledger record. This keeps quiet provider runs inspectable without contaminating JSON stdout.
- Provider output is classified before a run can count as completed. Live-run status precedence is deterministic: `write_scope_violation` outranks `provider_plan_changed_files`, which outranks `check_failed`, which outranks `provider_needs_input`, which outranks `completed`.
- Read surfaces now expose `effective_status`, `effective_status_reason`, and `classifier_version` next to the stored status fields. Existing ledger records are not rewritten; routing, outcome, `rank`, and `suggest` consume effective labels so old `provider_needs_input` false positives with changed files and passing checks can count as completed evidence.
- Passing checks can be flagged as `vacuous` when they do not prove useful work: the effective run failed, or a change-like task produced no changed files. New check events stamp the flag, old records compute it at read time, and vacuous checks block routing evidence.
- New ledger events now use `schema_version: 2`; v1 records remain readable by `eval`, `rank`, and `export`. New run records no longer write the dead inline `human_verdict: null` field; verdicts remain joined from verdict events.
- Unknown CLI options now fail before execution and suggest the nearest known option when the typo is obvious. This prevents typos such as `--privoder-mode` from silently falling back to plan mode.
- `--model`, `--effort`, and `--cost-hint` are recorded as run metadata. When supported provider CLIs expose structured output, Rux also records observed model/effort/cost metadata and labels whether values came from user options or adapter output.
- Provider adapters now request structured output from installed CLIs where supported: Claude `--output-format json`, Codex `exec --json`, and Gemini `--output-format json`.
- Observed model extraction was fixed on 2026-06-14 after every real run recorded `metadata_sources.model` as `not_observed` or `user_option`. The installed Claude (`--output-format json`) and Gemini (`--output-format json`) CLIs report the active model only as a KEY inside a usage map (`modelUsage` / `stats.models`), and Codex `exec --json` reports no model at all — so the parser's search for a top-level `model` field never matched, and the Wave 2 smoke mocks emitted a fictional `model` field that confirmed the parser instead of reality. The adapter now reads the primary model from the usage map (chosen by cost, context-window suffix like `[1m]` stripped), Codex stays honestly `not_observed`, and the mocks emit real installed-CLI shapes. Verified against claude 2.1.170 / codex 0.128.0 / gemini 0.44.1; the first real `model: observed` live task run is in this repo's ledger (`20260614T082202Z-0fa917e9`).
- `rux provider-smoke --runner claude|codex|gemini` records explicit release evidence and fails the smoke run if files change. Provider-smoke runs are not routing evidence and cannot receive checks, verdicts, or lifecycle marks. Status and release-check expose the latest provider-smoke attempt, passing run, and attempt lineage per runner.
- Real provider-smoke evidence is now recorded in the Rux store for Claude (`20260607T180537Z-a133edf2`), Codex (`20260607T180353Z-747ebaa4`), and Gemini (`20260607T180507Z-5955c823`). Older Runbook-named evidence was migrated into `.rux/` as historical continuity data, and the legacy `.runbook/` directory has been removed.
- Fixed rosters are implemented sequentially: `solo`, `pair`, `repair`, and `plan-code-review`. Parent runs summarize the roster; child runs are visible through `show`.
- New run records capture git repo snapshots before and after execution: branch, HEAD, dirty count, and dirty files. Roster parent records capture the whole roster's before/after repo state, while child runs keep their own snapshots. Imports capture repo context at import time.
- New run records include replay metadata. Run summaries, `show`, and `export` expose a `replay` object; old records derive it where possible, while imports and roster children explain why they are not directly replayable. Derived replay uses original inline checks only, not checks appended later with `rux check`.
- New live run records also include `status_reason` and `adapter` metadata: observed command argv, exit code, timeout state, stdout/stderr byte counts, stderr signal classification, and whether model/effort/cost metadata came from user options or was not observed. Imports carry an explicit adapter-uncertainty note instead of pretending the original invocation was observed.
- Retrospective import is explicit-file only: `rux import --from PATH`. Imported runs are `source: imported`, `confidence: low`, and should not drive recommendations until labels are attached.
- `rux check <run-id> --command "COMMAND"` appends a `post_run_check` result without rerunning providers or rewriting the original run. `rux check` and `rux record` can also append a headless verdict with `--verdict accepted|rejected|partial|unknown`; interactive `rux run`/`rux record` prompts for a verdict only when stdin and stdout are TTYs. Post-run checks capture their own repo snapshot and changed-file list and print check progress to stderr. Inline checks captured during `rux run --check` are marked `run_check`. Passing checks can turn an unlabeled live provider run into recommendation evidence, but checks that modify files are blocked from routing evidence with `check_modified_files`; failing checks become negative evidence.
- `rux outcome <run-id>` explains the outcome signal for a run: human verdict, check result, provider-smoke readiness, imported-unverified history, failed run, or unlabeled run.
- Outcome labels keep check failures separate from provider/safety failures. A run with passing checks can still be `run_failed` if the provider timed out, exited badly, or violated plan-mode safety.
- `rux mark <run-id> reverted|replayed|accepted-downstream` appends downstream lifecycle evidence without rerunning providers. Reverted marks block routing; accepted-downstream marks can count as positive proof; replayed marks stay as risk/context.
- `rux ls` shows the latest lifecycle mark for each top-level run, and `rux doctor` includes check/verdict/mark counts in the local store summary.
- `rux eval <run-id>` explains routing eligibility, blockers, score basis, release evidence, outcome, status reason, adapter signals, stderr interpretation, checks, verdicts, lifecycle marks, and child-run signals. `show` includes the same evaluation object.
- `rux rank [--task-kind KIND]` shows current runner/model/effort/roster rankings from eligible local evidence.
- `rux suggest "<task>"` now provides the first routing signal. It classifies the task, considers live or manual high-confidence non-fake runs with checks or verdicts, ignores imported/unlabeled history, reports evidence counts, and labels recommendation maturity as `none`, `thin`, `directional`, `strong`, or `mixed`.
- `rux plan "<task>"` is the first roster-design surface. It is dry-run only: it reuses `suggest` evidence and maturity, falls back to policy-preferred successful provider-smoke evidence before raw CLI availability, applies fixed roster rules for cold start, explains why extra agents are needed when it proposes them, resolves role runners, prints a runnable command, and does not call providers or write the ledger.
- `rux status` is the clean overview surface. It is read-only and summarizes ledger health, outcome labels, recommendation maturity, real provider task evidence, provider-smoke readiness and attempts, runner availability, release blockers, recent runs, next-capture command guidance, and next actions. Next-capture guidance now explicitly flags provider calls, ledger writes, and human review.
- `rux status` and `rux release-check` expose an `identity` block that names the current product, CLI, package, policy file, store directory, and rename surfaces. This keeps any future pre-release rename small.
- `rux export` is the first team-review surface. It is read-only, emits shareable JSON summaries, omits transcript text by default, and includes transcripts only with `--include-transcripts`.
- `rux.policy.json` is the committed team policy file. `rux policy` reads it, `rux status` surfaces it, `rux plan` uses its cold-start runner order/default roster, and `release-check` requires it before publishing.
- `rux.policy.json` now includes an advisory `token_governor` block. It centralizes agent token discipline for Moshpit work: cap tool output in chat, keep full logs outside model context, create handoffs before long sessions continue, and require a budget reason plus expected artifact for expensive models, high effort, subagents, or review agents. `rux policy`, `rux status`, and `rux plan` expose the block; `rux run` caps visible provider output while keeping full output in transcripts. Active live-session interruption and arbitrary shell-output brokering are still future work.
- `rux propose` now writes local markdown improvement proposals under `.rux/proposals/` and appends proposal events to the ledger. Proposals cite run IDs, distinguish adapter-smoke evidence from task-quality evidence, include release-check blockers grouped by lifecycle, and never apply changes.
- `rux report "<summary>"` records local feedback under `.rux/reports/` and appends report events to the ledger. Feedback can be bugs, confusing UX, adapter issues, docs gaps, routing/orchestration observations, install problems, ideas, successes, or other notes. Reports can optionally link a run ID, command, source repo, and note; they do not open external issues or change policy.
- `rux doctor` is a read-only local readiness check for Node, git, ledger state, and runner CLI availability.
- `rux release-check` is a read-only publish gate. It checks package scope, package file shape, privacy, docs, scripts, committed release state, provider-smoke evidence, at least one routing-eligible live provider task, and name readiness. Mutating post-run checks are recorded but do not satisfy task-evidence release readiness. Gates declare lifecycle: `one_time`, `release`, or `permanent`. `release-check --strict` exits non-zero while blockers remain, and npm `prepublishOnly` runs `npm run release:verify` so publish attempts use the strict gate.
- Release cadence is documented in `docs/STANDARDS.md`: batch normal fixes into a weekly patch train, reserve emergency patches for dangerous execution behavior, data loss, broken installs, provider auth/security breakage, or unusable published packages, and bump package versions only when cutting a release.
- Rux now uses a Swami-lite docs system: `docs/VISION.md` for the grand product arc, `docs/DECISIONS.md` for sticky decisions, `docs/STANDARDS.md` for behavior/release rules, and `npm run check:docs` to catch stale naming, local-only framing, missing docs, and release verification drift.
- The README now reads as the public entry surface for Rux: it opens with the record-first loop, shows example terminal output, explains what Rux records and recommends, states what it does not do, and keeps the practical command set close to the top.
- Post-goal Claude review is a lightweight ritual, not infrastructure. Use `prompts/post-goal-review.md` after achieving a goal, sanitize private context by default, and report model fallbacks explicitly.
- Treat team support as explicit export/import and committed repo policy first, not RBAC or SaaS.
- Support local CLI adapters first. Remote job adapters such as GitHub-hosted coding agents are later release-track concerns, after the local runner contract is trustworthy.
- Refuse parallel-N over one subscription CLI account by default. Users can opt in only when their provider terms and account setup allow it.
- Use "agent runner" and "roster" in the product. Avoid "AI gateway" in user-facing language.
- Self-improvement is proposal-only: no silent self-modification.
- Wave 2 exited on 2026-06-11. The gated static landing page was cut; README remains the public entry surface until a proof page can cite real ledger output without inflated claims.
- The temporary Wave 2 sprint plan is archived at `docs/archive/sprint-2026-06.md`; permanent outcomes now live in `docs/DECISIONS.md`, `docs/STATE.md`, and `docs/V0_PLAN.md`.

## Research Takeaways

This is not fully solved, but many pieces are solved:

- [Claude dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) prove that parallel subagents are now a first-party coding-agent primitive, but they are provider-specific and token-heavy.
- [AWS CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator) proves that multi-CLI orchestration is already real: tmux sessions, supervisor-worker patterns, MCP, and cross-provider workers.
- [Microsoft Conductor](https://opensource.microsoft.com/blog/2026/05/14/conductor-deterministic-orchestration-for-multi-agent-ai-workflows/) proves deterministic, YAML-defined multi-agent workflows are now credible infrastructure.
- [amux](https://amux.io/) and similar tools show that "agent control plane" and multi-session dashboards are already contested territory.
- [OpenHands Enterprise](https://www.openhands.dev/blog/openhands-enterprise-agent-control-plane) shows the enterprise control-plane language is already being claimed around governance, cost, visibility, and scale.
- [Zed Agent Client Protocol](https://zed.dev/acp) is the strongest current signal for editor interoperability. Do not claim the `ACP` acronym.
- [OpenAI Codex CLI](https://github.com/openai/codex) and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) are local coding agents with their own auth, config, and tool behavior. Wrap them; do not flatten them into a generic model API.
- [Model Context Protocol](https://github.com/modelcontextprotocol/modelcontextprotocol) is now table stakes for tool/context integration. Use it where it helps; do not make it the whole product.
- Unified headless wrappers such as [headless-coder-sdk](https://github.com/OhadAssulin/headless-coder-sdk) are a warning: the wrapper layer alone is not enough of a wedge.

Local Moshpit learnings:

- Work OS Bench shows the useful shape of eval-backed routing: score by model and work kind, keep outcomes source-backed, and do not replace the underlying run lifecycle.
- Moshpit Labs shows the value of explicit run/review/evidence loops and blocked closeouts with recovery paths.
- Swami/Labs workflow feedback shows the right self-improvement shape: raw observations first, curated lessons second.

## Pushback

- Do not pretend eval exists before labels exist. v0.1 must capture test results and explicit human verdicts.
- Do not make the runner the wedge. The wedge is trustworthy outcome memory and later recommendation.
- Do not ship fanout first. Start with fixed useful rosters, then earn dynamic agent-count selection from evidence.
- Do not build IDE automation first. Surface results through files, branches, comments, and protocol adapters later.
- Do not build a full benchmark platform. Public benchmarks are useful references; the valuable signal is each user's own repos.
- Do not build subscription arbitrage. Provider terms and user trust matter.
- Do not create a heavy swarm vocabulary. Users need rosters, not a theory class.

## Open Decisions

- Implementation language: TypeScript is likely the best fit for CLI distribution and provider ecosystem; Python is viable if speed of authoring matters more.
- License: Apache-2.0 is the conservative open-source default for broad adoption.
- CLI name: `rux`.
- Package scope and slug: `@moshpits/rux`.
- Ledger location: `.rux/ledger/` inside the target repo, with optional global index later.
- First real runners: Claude Code plan-mode capture, Codex CLI read-only capture, and Gemini CLI plan-mode capture.
- First routing-eligible provider task evidence is recorded with Codex (`20260607T180641Z-f46c1b70`) and `npm run check`; next runner work is to broaden that evidence across real implementation, repair, and review tasks.
- Next eval work: improve reviewer semantics and broaden real-world adapter metadata evidence across non-mock provider runs.
- First dynamic roster work: `rux plan` chooses between fixed rosters using evidence plus simple rules; do not invent new swarm shapes until the ledger earns it.

## Next Action

The `0.2.2` package carries the first token-governor enforcement slice, and Wave 2 is exited. The current large goal is the pre-registered proof quarter (`docs/PROOF.md`, 2026-06-12 -> 2026-09-12): instrument every real routing decision — recommendation, choice, outcome — until the ledger proves or honestly refutes that `rux suggest` changes decisions for the better. The decision discipline is propagated to all Moshpit repos via their `AGENTS.md` (canonical block in this repo's `AGENTS.md`) plus user-level Claude/Codex/Gemini instruction files. Build work this quarter is limited to what the protocol needs: decision/adherence events, the scorecard view, deeper token-governor enforcement, and quota-blocking friction fixes.
