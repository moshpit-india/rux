# Rux

[![npm version](https://img.shields.io/npm/v/%40moshpits%2Frux)](https://www.npmjs.com/package/@moshpits/rux)
[![node](https://img.shields.io/node/v/%40moshpits%2Frux)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/%40moshpits%2Frux)](LICENSE)

Rux is an open-source, test-first run ledger for AI coding agents. It records what Claude Code, Codex, and Gemini CLI actually do in your repo — invocations, diffs, checks, verdicts — and turns that evidence into recommendations for the next run.

One loop:

```text
plan -> run -> record -> review -> improve
```

One practical question, answered from your own repo's history:

> For this repo and this task, which agent setup should we use, what happened, and what did we learn?

It is not a model gateway. Rux wraps the CLIs you already use, inherits their auth, and adds no telemetry. Your evidence stays in your repo.

## Quickstart

Requires Node 20+, git, and at least one provider CLI (`claude`, `codex`, or `gemini`) installed and authenticated.

```sh
npm install -g @moshpits/rux
rux init
rux status
```

Record one real loop:

```sh
rux run "review the navigation code" --runner gemini
rux show <run-id>
rux verdict <run-id> accepted --note "Useful review"
```

Already did the work in your current Claude/Codex/Gemini session? `rux record` captures it without spawning a nested provider run:

```sh
rux record "implemented the stats filters" --runner codex --check "npm test" --verdict accepted
```

For long sessions, `rux record --start "<task>" --runner <cli>` snapshots a baseline first so the final record diffs cleanly.

Interactive terminals get readable output; pipes and scripts get JSON. `--json` forces JSON anywhere it is supported.

## The Loop, By Command

| Step | Commands |
| --- | --- |
| Decide | `rux suggest`, `rux plan`, `rux rank`, `rux policy` |
| Capture | `rux run`, `rux record`, `rux import` |
| Review | `rux ls`, `rux show`, `rux eval`, `rux outcome`, `rux status`, `rux status --scorecard` |
| Label | `rux check`, `rux verdict`, `rux mark` |
| Share and ship | `rux export`, `rux propose`, `rux provider-smoke`, `rux release-check` |

Example:

```text
Rux plan
Task: fix the failing auth test
Kind: test
Runner: codex (evidence)
Roster: solo (1 agent, sequential)
Evidence: local_evidence, maturity directional from 3 run(s)
Command
rux run 'fix the failing auth test' --runner codex --roster solo
```

## What Rux Records

Every run leaves a repo-local evidence trail under `.rux/`:

- task, runner, roster, provider mode, task kind, model, effort, and cost hints,
- the provider invocation, transcript reference, output signal, and status,
- repo state before and after, changed files, and write-scope violations,
- checks, human verdicts, lifecycle marks, and feedback reports.

That record powers `show`, `eval`, `outcome`, `status`, `export`, `rank`, `suggest`, `plan`, `propose`, and `report`.

## What Rux Recommends

Rux recommends cautiously, from eligible local evidence only: checked or reviewed runs with real provenance. Imported history, probe runs, smoke runs, and vacuous checks never quietly become routing proof.

Every recommendation carries a maturity label — `none`, `thin`, `directional`, `strong`, or `mixed` — so you always know how much weight the advice deserves. When an agent session is already active, `rux suggest "<task>" --in-session claude|codex|gemini` weighs handoff cost instead of assuming a cold start.

## Safety Defaults

- Plan mode by default. Pass `--provider-mode write` when the provider should edit files.
- Real provider runs refuse dirty worktrees. Commit, stash, or revert first, or pass `--allow-dirty` only when the dirty files are intentional context.
- `--write-scope "path[,path...]"` declares where a provider may write. Out-of-scope edits are recorded as failed runs.
- Provider output mirrors to stderr live, so questions and quiet long-running work stay visible; stdout stays clean for scripts.
- No provider credentials stored, no API proxying, no telemetry, no silent self-modification.

## Team Policy

`rux.policy.json` is a committed, repo-local operating policy. It sets preferred runner order and roster defaults, and its `token_governor` block tells agents when to cap tool output, create session handoffs, and justify expensive models, high effort, or subagents. `rux policy` prints it; Rux-wrapped runs cap visible provider output while keeping full transcripts.

## What Rux Does Not Do

Rux does not replace your coding agent, store provider credentials, proxy model API calls, run a SaaS backend, or add telemetry. It wraps the tools you already use and proposes improvements with evidence. Humans decide what to run and what to change.

## Why Rux

Starting coding agents is easy now. Knowing which one to use, when extra agents are worth their cost, what failed last time, and what a team should standardize — that memory does not exist unless something keeps it. Rux keeps it:

- which agent works best for which kind of task,
- when a roster beats a solo run,
- what failed last time and why,
- what to standardize without losing developer choice.

That memory starts with capture. If the record is weak, routing is theater. Every run should make the next run smarter.

## Docs

- [Vision](docs/VISION.md)
- [State](docs/STATE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [v0 Plan](docs/V0_PLAN.md)
- [Standards](docs/STANDARDS.md)
- [Decisions](docs/DECISIONS.md)
- [Changelog](CHANGELOG.md)

## License

[Apache-2.0](LICENSE) © Moshpit Labs
