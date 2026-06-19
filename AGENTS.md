# Agent Instructions

Read this file before work in this repo.

## Product Shape

Rux is the selected product name for a test-first tool that records AI coding runs through one simple loop:

```
plan -> run -> record -> review -> improve
```

Keep the product agent-first, creator-friendly, and boring in the right places. Do not turn it into a generic LLM gateway, SaaS admin panel, benchmark website, or workflow-theory project.

Runtime naming lives in `src/identity.mjs`; package publishing stays gated by local smoke tests, real provider smoke tests, checked provider task evidence, and the release checklist.

## Working Rules

- Keep the current state in `docs/STATE.md` accurate after meaningful work.
- Prefer small docs and runnable examples over long strategy notes.
- Re-implement from scratch. Borrow concepts from other projects, never code or project-specific machinery.
- Treat adapter behavior as volatile. Verify provider CLI commands against the installed tool before documenting exact flags.
- Do not store provider credentials. Inherit auth from the wrapped CLI or the user's environment.
- Do not add telemetry by default.
- Refuse parallel runs over one subscription CLI account by default. Let users opt in only when they confirm their provider terms and account setup allow it.
- Do not let the tool silently change its own source code. Improvement loops may propose changes with evidence; a human decides.
- If a task needs multiple agents, state why one agent is not enough.
- If a feature adds new nouns, push back unless it clearly reduces user effort.

## Rux Proof Quarter — Routing With Receipts (until 2026-09-12)

All Moshpit repos follow this discipline for substantial agent work (implementation, review, repair — not trivial edits). The pre-registered bar lives in `docs/PROOF.md` in this repo. Rux 0.2.0+ is installed globally as `rux`.

1. Ask before working: `rux suggest "<task>" --in-session <your-cli> --cwd "$PWD"` where <your-cli> is claude|codex|gemini — the agent you are right now (so suggest can weigh handoff cost instead of assuming a cold start). Add `rux plan "<task>" --cwd "$PWD"` for large work. Note the recommendation and its maturity label, and whether it said to continue in-session or hand off.
   - Apply the committed `rux.policy.json` `token_governor` block as the operating policy for token discipline: bound tool output, keep full logs outside model context, create handoffs before long sessions continue, and require a budget reason plus expected artifact for expensive models, high effort, subagents, or review agents.
2. Capture the work:
   - Delegating to a provider CLI: `rux run "<task>" --runner claude|codex|gemini --provider-mode plan|write --task-kind <kind> --check "<repo check>" --cwd "$PWD"`, with `--write-scope "path[,path...]"` for tightly scoped edits. Do not pass `--allow-dirty` unless the dirty files are intentionally part of the provider context and the user accepted that risk.
   - Current session does the work itself: `rux record --start "<task>" --runner <your-cli> --cwd "$PWD"` before starting; when done, `rux record "<task>" --runner <your-cli> --task-kind <kind> --check "<repo check>" --verdict accepted|partial|rejected --cwd "$PWD"`. Never spawn a nested provider run just to satisfy the ledger.
3. Stamp the routing decision at decision time, never reconstructed later: `rux report "routing decision: <task>" --kind routing --run-id <run-id> --cwd "$PWD" --note "suggest recommended <runner/roster> (maturity <level>); followed|overridden because <reason>"`. Every override needs a reason.
4. Label honestly: real checks only; attach verdicts (`--verdict` inline or `rux verdict <run-id> ... --note "<why>"`); when earlier work is reverted or ships downstream, `rux mark <run-id> reverted|accepted-downstream --cwd "$PWD"`.
5. Report friction and wins: `rux report "<summary>" --kind bug|ux|adapter|docs|routing|orchestration|install|idea|success|other --cwd "$PWD"` (success reports require `--run-id`, `--record`, or `--no-run "REASON"`).

Never fabricate evidence, checks, or verdicts. If Rux is unavailable or would block an urgent or trivial task, continue and state in your summary why the evidence was not captured.

## Post-Goal Lead Review

After a goal is genuinely achieved and before creating the next goal, ask Claude CLI for lead-style review/advice using `prompts/post-goal-review.md`. Keep the prompt sanitized by default; do not send private repo names, local paths, proprietary code, secrets, customer data, or unpublished workspace details unless the user explicitly approves that disclosure after being told the risk. Record any unavailable requested model alias and the fallback used.

## Documentation Contract

This repo should stay readable in minutes:

- `README.md` tells a new user what this is.
- `docs/VISION.md` tells us the product arc and guardrails.
- `docs/STATE.md` tells the creator what is true now.
- `docs/ARCHITECTURE.md` explains the system in one sitting.
- `docs/V0_PLAN.md` tells us what to build first and what not to build.
- `docs/STANDARDS.md` defines coding and release standards.
- `docs/DECISIONS.md` records sticky decisions.

Do not add new docs until the existing ones cannot carry the work cleanly.
