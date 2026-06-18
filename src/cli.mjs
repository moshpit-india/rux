#!/usr/bin/env node

import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { CLI_NAME, NPM_ORG, PRODUCT_NAME, STORE_DIR } from "./identity.mjs";

const LEDGER_DIR = "ledger";
const TRANSCRIPT_DIR = "transcripts";
const PROPOSAL_DIR = "proposals";
const REPORT_DIR = "reports";
const POLICY_FILE = "rux.policy.json";
const SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = "read-classifier-2026-06-11";
const rosterDefinitions = new Set(["solo", "pair", "repair", "plan-code-review"]);
const lifecycleMarkDefinitions = new Set(["reverted", "replayed", "accepted-downstream"]);
const verdictDefinitions = new Set(["accepted", "rejected", "partial", "unknown"]);
const reportKindDefinitions = new Set(["bug", "ux", "adapter", "docs", "routing", "orchestration", "install", "idea", "success", "other"]);
const knownOptionNames = new Set([
  "allow-dirty",
  "check",
  "coder-runner",
  "command",
  "cost-hint",
  "cwd",
  "effort",
  "force",
  "from",
  "implementer-runner",
  "in-session",
  "include-probes",
  "include-transcripts",
  "json",
  "kind",
  "limit",
  "mode",
  "model",
  "no-run",
  "note",
  "planner-runner",
  "provider-mode",
  "purpose",
  "record",
  "repair-runner",
  "reviewer-runner",
  "roster",
  "run-id",
  "runner",
  "source-repo",
  "started-at",
  "start",
  "status",
  "strict",
  "stream",
  "task",
  "task-kind",
  "timeout-ms",
  "verdict",
  "write-scope"
]);
const booleanOptionNames = new Set([
  "allow-dirty",
  "force",
  "include-transcripts",
  "include-probes",
  "json",
  "record",
  "start",
  "strict",
  "stream"
]);

const runnerDefinitions = {
  fake: {
    label: "Fake runner",
    command: null,
    available: true,
    notes: "Built-in runner for smoke tests and ledger development."
  },
  claude: {
    label: "Claude Code",
    command: "claude",
    notes: "Uses the installed Claude Code CLI and its existing auth. Runs in plan mode by default."
  },
  codex: {
    label: "Codex CLI",
    command: "codex",
    notes: "Uses the installed Codex CLI and its existing auth. Runs with read-only sandbox by default."
  },
  gemini: {
    label: "Gemini CLI",
    command: "gemini",
    notes: "Uses the installed Gemini CLI and its existing auth. Runs in plan approval mode by default."
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "runners":
      return printRunners(args);
    case "init":
      return initRepo(args);
    case "run":
      return runCommand(args);
    case "record":
      return recordManualRun(args);
    case "provider-smoke":
      return providerSmoke(args);
    case "ls":
      return listRuns(args);
    case "show":
      return showRun(args);
    case "eval":
      return evaluateRunCommand(args);
    case "outcome":
      return outcomeRun(args);
    case "import":
      return importRun(args);
    case "plan":
      return planRun(args);
    case "suggest":
      return suggestRun(args);
    case "rank":
      return rankRuns(args);
    case "status":
      return status(args);
    case "export":
      return exportRuns(args);
    case "policy":
      return showPolicy(args);
    case "doctor":
      return doctor(args);
    case "release-check":
      return releaseCheck(args);
    case "propose":
      return proposeImprovements(args);
    case "report":
      return recordReport(args);
    case "check":
      return addCheck(args);
    case "verdict":
      return addVerdict(args);
    case "mark":
      return addLifecycleMark(args);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return printHelp();
    case "version":
    case "--version":
    case "-v":
      return printVersion();
    default:
      throw new Error(`Unknown command: ${command}\nRun "rux help".`);
  }
}

function printHelp() {
  console.log(`${PRODUCT_NAME}

Usage:
  ${CLI_NAME} runners
  ${CLI_NAME} init [--cwd PATH] [--force]
  ${CLI_NAME} run "<task>" [--runner fake|claude|codex|gemini] [--roster solo|pair|repair|plan-code-review] [--purpose task|probe] [--task-kind KIND] [--provider-mode plan|write] [--model NAME] [--effort LEVEL] [--cost-hint USD] [--cwd PATH] [--check "COMMAND"] [--timeout-ms N] [--write-scope PATH[,PATH...]] [--stream] [--allow-dirty] [--json]
  ${CLI_NAME} record --start "<task>" --runner claude|codex|gemini [--task-kind KIND] [--cwd PATH] [--note "TEXT"] [--model NAME] [--effort LEVEL] [--cost-hint USD] [--json]
  ${CLI_NAME} record "<task>" --runner claude|codex|gemini [--task-kind KIND] [--cwd PATH] [--check "COMMAND"] [--verdict accepted|rejected|partial|unknown] [--note "TEXT"] [--model NAME] [--effort LEVEL] [--cost-hint USD] [--write-scope PATH[,PATH...]] [--json]
  ${CLI_NAME} provider-smoke --runner claude|codex|gemini [--model NAME] [--effort LEVEL] [--cwd PATH] [--timeout-ms N] [--allow-dirty]
  ${CLI_NAME} import --from PATH [--runner claude|codex|gemini|unknown] [--task "TEXT"] [--model NAME] [--effort LEVEL] [--cost-hint USD] [--cwd PATH]
  ${CLI_NAME} plan "<task>" [--runner fake|claude|codex|gemini] [--roster solo|pair|repair|plan-code-review] [--model NAME] [--effort LEVEL] [--cost-hint USD] [--cwd PATH] [--check "COMMAND"]
  ${CLI_NAME} suggest "<task>" [--in-session claude|codex|gemini] [--include-probes] [--cwd PATH] [--json]
  ${CLI_NAME} rank [--task-kind KIND] [--include-probes] [--cwd PATH] [--json]
  ${CLI_NAME} status [--cwd PATH] [--json]
  ${CLI_NAME} export [--cwd PATH] [--limit N] [--run-id ID] [--include-transcripts] [--json]
  ${CLI_NAME} policy [--cwd PATH]
  ${CLI_NAME} doctor [--cwd PATH]
  ${CLI_NAME} release-check [--cwd PATH] [--strict]
  ${CLI_NAME} propose [--cwd PATH]
  ${CLI_NAME} report "<summary>" [--kind bug|ux|adapter|docs|routing|orchestration|install|idea|success|other] [--source-repo PATH] [--run-id ID | --record --runner claude|codex|gemini | --no-run "REASON"] [--command "COMMAND"] [--note "TEXT"] [--cwd PATH]
  ${CLI_NAME} --version
  ${CLI_NAME} ls [--cwd PATH]
  ${CLI_NAME} show <run-id> [--cwd PATH]
  ${CLI_NAME} eval <run-id> [--cwd PATH]
  ${CLI_NAME} outcome <run-id> [--cwd PATH]
  ${CLI_NAME} check <run-id> --command "COMMAND" [--verdict accepted|rejected|partial|unknown] [--note "TEXT"] [--cwd PATH] [--json]
  ${CLI_NAME} verdict <run-id> accepted|rejected|partial|unknown [--note "TEXT"] [--cwd PATH]
  ${CLI_NAME} mark <run-id> reverted|replayed|accepted-downstream [--note "TEXT"] [--cwd PATH]
`);
}

async function printVersion() {
  const packageJson = await readJsonIfExists(new URL("../package.json", import.meta.url));
  console.log(`${CLI_NAME} ${packageJson?.version ?? "unknown"}`);
}

function emitResult(options, payload, humanFormatter = formatHumanResult) {
  if (shouldEmitJson(options)) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(humanFormatter(payload));
}

function shouldEmitJson(options) {
  return options.json === true || !stdoutIsHumanTty();
}

function stdoutIsHumanTty() {
  if (process.env.RUX_FORCE_TTY === "1") return true;
  return process.stdout.isTTY === true;
}

function formatHumanResult(payload) {
  if (Array.isArray(payload)) {
    return [
      `${PRODUCT_NAME} result`,
      ...payload.slice(0, 12).map((item) => `- ${formatHumanSummaryLine(item)}`)
    ].join("\n");
  }

  const lines = [`${PRODUCT_NAME} result`];
  if (payload?.id) lines.push(`ID: ${payload.id}`);
  if (payload?.run_id) lines.push(`Run: ${payload.run_id}`);
  if (payload?.type) lines.push(`Type: ${payload.type}`);
  if (payload?.runner) lines.push(`Runner: ${payload.runner}`);
  if (payload?.roster) lines.push(`Roster: ${payload.roster}`);
  if (payload?.status) lines.push(`Status: ${payload.status}${payload.status_reason ? ` (${payload.status_reason})` : ""}`);
  if (payload?.effective_status && payload.effective_status !== payload.status) {
    lines.push(`Effective: ${payload.effective_status}${payload.effective_status_reason ? ` (${payload.effective_status_reason})` : ""}`);
  }
  if (payload?.verdict) lines.push(`Verdict: ${payload.verdict}`);
  if (payload?.verdict_recorded?.verdict) lines.push(`Verdict recorded: ${payload.verdict_recorded.verdict}`);
  if (payload?.task) lines.push(`Task: ${formatListTask(payload.task)}`);
  if (Array.isArray(payload?.changed_files)) lines.push(`Changed files: ${payload.changed_files.length}`);
  if (Array.isArray(payload?.checks)) lines.push(`Checks: ${payload.checks.length}`);
  if (Array.isArray(payload?.mark_nudges) && payload.mark_nudges.length > 0) {
    lines.push("Mark nudges:");
    lines.push(...payload.mark_nudges.slice(0, 3).map((nudge) => `- ${nudge.action}`));
  }
  if (payload?.replay?.command) lines.push(`Replay: ${payload.replay.command}`);
  return lines.join("\n");
}

function formatHumanSummaryLine(item) {
  if (item && typeof item === "object") {
    return [item.name, item.id, item.runner, item.status, item.task].filter(Boolean).join(" ");
  }
  return String(item);
}

function formatStatusHuman(status) {
  const lines = [
    `${PRODUCT_NAME} status`,
    `Repo: ${status.cwd}`,
    `Runs: ${status.ledger.runs} (${status.ledger.top_level_runs} top-level)`,
    `Evidence: ${status.evidence.eligible_runs} eligible, maturity ${status.evidence.maturity.strongest_level}`,
    `Release: ${status.release.ready ? "ready" : `blocked (${status.release.blockers.join(", ")})`}`
  ];

  const statements = topEvidenceStatements(status).slice(0, 3);
  if (statements.length > 0) {
    lines.push("", "Evidence");
    lines.push(...statements.map((statement) => `- ${statement}`));
  }

  if (Array.isArray(status.mark_nudges) && status.mark_nudges.length > 0) {
    lines.push("", "Mark Nudges");
    lines.push(...status.mark_nudges.slice(0, 3).map((nudge) => `- ${nudge.action}`));
  }

  if (Array.isArray(status.next_actions) && status.next_actions.length > 0) {
    lines.push("", "Next");
    lines.push(...status.next_actions.slice(0, 5).map((action) => `- ${action}`));
  }

  return lines.join("\n");
}

function topEvidenceStatements(status) {
  const rankings = status?.evidence?.rankings ?? [];
  return rankings.flatMap((ranking) => {
    const top = ranking.top?.[0];
    if (!top) return [];
    const runs = top.evidence_runs ?? [];
    return `${ranking.task_kind}: ${top.runner}/${top.roster} ${top.model ?? "default-model"} ${top.effort ?? "default-effort"} score=${top.score} from ${top.total} run(s): ${runs.join(", ")}`;
  });
}

function formatReleaseHuman(result) {
  return [
    `${PRODUCT_NAME} release-check`,
    `Ready: ${result.ready ? "yes" : "no"}`,
    `Package: ${result.package?.name ?? "unknown"} ${result.package?.version ?? ""}`.trim(),
    result.blocker_summary.total === 0
      ? "Blockers: none"
      : `Blockers: ${result.gates.filter((gate) => !gate.ok).map((gate) => gate.name).join(", ")}`
  ].join("\n");
}

function formatDoctorHuman(result) {
  const availableRunners = (result.runners ?? []).filter((runner) => runner.available).map((runner) => runner.name);
  return [
    `${PRODUCT_NAME} doctor`,
    `Repo: ${result.cwd}`,
    `Node: ${result.node?.version ?? "unknown"} ${result.node?.ok ? "ok" : "not ok"}`,
    `Git: ${result.git?.inside_work_tree ? "worktree" : "not a worktree"}, dirty=${result.git?.dirty_entries ?? "unknown"}`,
    `Store: ${result.store?.exists ? "present" : "missing"} (${result.store?.runs ?? 0} runs, ${result.store?.verdicts ?? 0} verdicts, ${result.store?.marks ?? 0} marks)`,
    `Runners: ${availableRunners.length > 0 ? availableRunners.join(", ") : "none available"}`,
    "",
    "Notes",
    ...((result.notes ?? []).map((note) => `- ${note}`))
  ].join("\n");
}

function formatPlanHuman(result) {
  const recommendation = result.recommendation ?? {};
  const maturity = recommendation.maturity ?? {};
  const lines = [
    `${PRODUCT_NAME} plan`,
    `Task: ${formatListTask(result.task)}`,
    `Kind: ${result.task_kind ?? "unspecified"}`,
    `Runner: ${recommendation.runner ?? "none"} (${result.runner_source ?? "unknown source"})`,
    `Roster: ${recommendation.roster ?? "none"} (${recommendation.agents ?? 0} agent${recommendation.agents === 1 ? "" : "s"}, ${recommendation.execution ?? "unknown"})`,
    `Evidence: ${recommendation.confidence ?? "unknown"}, maturity ${maturity.level ?? "unknown"} from ${maturity.runs ?? 0} run(s)`,
    `Reason: ${recommendation.reason ?? "No reason recorded."}`
  ];

  if (recommendation.one_agent_not_enough) {
    lines.push(`Why not one agent: ${recommendation.one_agent_not_enough}`);
  }

  const governor = result.policy?.token_governor;
  if (governor && governor.mode !== "off") {
    lines.push(`Governor: ${governor.mode}; cap tool output at ${governor.max_tool_output_chars} chars; handoff after ${governor.handoff_after_turns} turns or ${governor.handoff_after_session_tokens} tokens.`);
  }

  if (Array.isArray(recommendation.roles) && recommendation.roles.length > 0) {
    lines.push("", "Roles");
    lines.push(...recommendation.roles.map((role) => `- ${role.role}: ${role.runner} - ${role.purpose}`));
  }

  if (result.command) {
    lines.push("", "Command", result.command);
  }

  if (Array.isArray(result.next_actions) && result.next_actions.length > 0) {
    lines.push("", "Next");
    lines.push(...result.next_actions.map((action) => `- ${action}`));
  }

  return lines.join("\n");
}

function formatSuggestHuman(result) {
  const recommendation = result.recommendation ?? {};
  const maturity = recommendation.maturity ?? {};
  const lines = [
    `${PRODUCT_NAME} suggest`,
    `Task: ${formatListTask(result.task)}`,
    `Kind: ${result.task_kind ?? "unspecified"}`
  ];

  if (recommendation.continue_in_session) {
    // Attribute the maturity to whose evidence it is — never render it as
    // confidence in staying, which we do not have.
    const evidenceLine = recommendation.evidence_runner
      ? `Evidence: ${recommendation.evidence_runner} history is ${maturity.level ?? "unknown"} (${maturity.runs ?? 0} run(s)); staying avoids handoff cost`
      : "Evidence: none eligible yet; staying avoids handoff risk";
    lines.push(
      `Recommendation: continue in current session (${recommendation.runner}, no handoff)`,
      evidenceLine,
      `Reason: ${recommendation.reason ?? "No reason recorded."}`
    );
  } else if (recommendation.runner) {
    lines.push(
      `Recommendation: ${recommendation.runner}/${recommendation.roster ?? "solo"} ${recommendation.model ?? "default-model"} ${recommendation.effort ?? "default-effort"}`,
      `Confidence: ${recommendation.confidence ?? "unknown"}, maturity ${maturity.level ?? "unknown"} from ${maturity.runs ?? 0} run(s)`,
      `Reason: ${recommendation.reason ?? "No reason recorded."}`
    );
    if (recommendation.handoff === "recommended") {
      lines.push(`Handoff: recommended over staying in ${recommendation.in_session}`);
    }
  } else {
    lines.push(
      "Recommendation: none yet",
      `Confidence: ${recommendation.confidence ?? "cold_start"}`,
      `Reason: ${recommendation.reason ?? "No eligible evidence yet."}`
    );
  }

  if (Array.isArray(recommendation.evidence_runs) && recommendation.evidence_runs.length > 0) {
    lines.push(`Evidence runs: ${recommendation.evidence_runs.slice(0, 5).join(", ")}`);
  }

  const stats = recommendation.stats ?? {};
  lines.push(
    `Stats: ${stats.labeled_runs ?? 0} labeled, ${stats.adapter_observed_runs ?? 0} adapter-observed, ${stats.manual_runs ?? 0} manual`,
    `Ignored: ${result.evidence?.ignored_runs ?? 0} run(s)`
  );

  return lines.join("\n");
}

function formatRankHuman(result) {
  const lines = [
    `${PRODUCT_NAME} rank`,
    `Evidence: ${result.evidence?.eligible_runs ?? 0} eligible, maturity ${result.evidence?.maturity?.strongest_level ?? "unknown"}`
  ];

  if (result.task_kind) {
    lines.push(`Scope: ${result.task_kind}`);
  }

  for (const ranking of result.rankings ?? []) {
    lines.push("", `${ranking.task_kind}`);
    if (!Array.isArray(ranking.candidates) || ranking.candidates.length === 0) {
      lines.push("- no candidates");
      continue;
    }
    for (const candidate of ranking.candidates.slice(0, 3)) {
      const runs = (candidate.evidence_runs ?? []).slice(0, 3).join(", ");
      lines.push(`- ${candidate.runner}/${candidate.roster} ${candidate.model ?? "default-model"} ${candidate.effort ?? "default-effort"} score=${candidate.score} maturity=${candidate.maturity?.level ?? "unknown"} runs=${candidate.total}${runs ? ` (${runs})` : ""}`);
    }
  }

  if (Array.isArray(result.notes) && result.notes.length > 0) {
    lines.push("", "Notes");
    lines.push(...result.notes.map((note) => `- ${note}`));
  }

  return lines.join("\n");
}

function formatExportHuman(result) {
  const lines = [
    `${PRODUCT_NAME} export`,
    `Scope: ${result.scope}`,
    `Runs: ${result.counts?.exported_runs ?? 0} exported of ${result.counts?.total_runs ?? 0}`,
    `Transcripts: ${result.include_transcripts ? "included" : "omitted"}`
  ];

  if (Array.isArray(result.runs) && result.runs.length > 0) {
    lines.push("", "Runs");
    lines.push(...result.runs.slice(0, 10).map((run) => {
      const verdict = run.verdict?.verdict ? ` verdict=${run.verdict.verdict}` : "";
      return `- ${run.id} ${run.effective_status ?? run.status} ${run.runner}/${run.roster} ${run.outcome?.label ?? "unlabeled"}${verdict} - ${formatListTask(run.task)}`;
    }));
  }

  if (Array.isArray(result.notes) && result.notes.length > 0) {
    lines.push("", "Notes");
    lines.push(...result.notes.map((note) => `- ${note}`));
  }

  return lines.join("\n");
}

function normalizeVerdictOption(value) {
  if (value === undefined) return null;
  if (value === true) {
    throw new Error("--verdict requires accepted, rejected, partial, or unknown.");
  }
  const verdict = String(value).trim();
  if (!verdictDefinitions.has(verdict)) {
    throw new Error("--verdict must be one of accepted, rejected, partial, or unknown.");
  }
  return verdict;
}

function formatVerdictEvent(event) {
  return {
    verdict: event.verdict,
    note: event.note ?? "",
    created_at: event.created_at
  };
}

async function createVerdictEvent({ cwd, runId, verdict, note = "" }) {
  const normalized = normalizeVerdictOption(verdict);
  if (!normalized) {
    throw new Error("--verdict requires accepted, rejected, partial, or unknown.");
  }

  const events = await readLedger(cwd);
  const run = events.find((event) => event.type === "run" && event.id === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  if (run.purpose === "provider_smoke") {
    throw new Error("Provider-smoke runs prove adapter readiness only; do not attach human verdicts to them.");
  }

  const event = {
    schema_version: SCHEMA_VERSION,
    type: "verdict",
    id: randomUUID(),
    run_id: runId,
    verdict: normalized,
    note,
    created_at: new Date().toISOString()
  };
  await appendLedger(cwd, event);
  return event;
}

async function maybeAttachRunVerdict({ cwd, run, options }) {
  const explicitVerdict = normalizeVerdictOption(options.verdict);
  if (explicitVerdict) {
    return createVerdictEvent({
      cwd,
      runId: run.id,
      verdict: explicitVerdict,
      note: options.note ? String(options.note) : ""
    });
  }

  if (!shouldPromptForVerdict(options, run)) return null;
  const prompted = await promptForVerdict(run);
  if (!prompted) return null;
  return createVerdictEvent({
    cwd,
    runId: run.id,
    verdict: prompted.verdict,
    note: prompted.note
  });
}

function shouldPromptForVerdict(options, run) {
  return (
    run?.purpose !== "provider_smoke" &&
    !shouldEmitJson(options) &&
    process.stdin.isTTY === true &&
    stdoutIsHumanTty()
  );
}

async function promptForVerdict(run) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true
  });
  try {
    const answer = (await rl.question(`Verdict for ${run.id} [accepted/rejected/partial/unknown/skip]: `)).trim().toLowerCase();
    if (!answer || answer === "skip") return null;
    if (!verdictDefinitions.has(answer)) {
      writeRuxProgress("verdict skipped: expected accepted, rejected, partial, unknown, or skip.");
      return null;
    }
    const note = (await rl.question("Verdict note (optional): ")).trim();
    return { verdict: answer, note };
  } finally {
    rl.close();
  }
}

function parseOptions(args) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    if (!knownOptionNames.has(key)) {
      throw new Error(formatUnknownOption(key));
    }

    if (booleanOptionNames.has(key)) {
      options[key] = true;
      continue;
    }

    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { positionals, options };
}

function formatUnknownOption(key) {
  const suggestion = nearestKnownOption(key);
  return suggestion
    ? `Unknown option --${key}. Did you mean --${suggestion}?`
    : `Unknown option --${key}. Run "${CLI_NAME} help".`;
}

function nearestKnownOption(key) {
  let best = null;
  for (const candidate of knownOptionNames) {
    const distance = editDistance(key, candidate);
    if (!best || distance < best.distance) {
      best = { candidate, distance };
    }
  }
  return best && best.distance <= 3 ? best.candidate : null;
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function resolveCwd(options) {
  return resolve(String(options.cwd ?? process.cwd()));
}

function metadataFromOptions(options) {
  return {
    model: normalizeOptionalString(options.model),
    effort: normalizeOptionalString(options.effort),
    cost_hint: parseCostHint(options["cost-hint"])
  };
}

function mergeObservedMetadata(userMetadata, observedMetadata = {}) {
  return {
    model: userMetadata.model ?? observedMetadata.model ?? null,
    effort: userMetadata.effort ?? observedMetadata.effort ?? null,
    cost_hint: userMetadata.cost_hint ?? observedMetadata.cost_hint ?? null
  };
}

function normalizeOptionalString(value) {
  if (value === undefined || value === true) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parseCostHint(value) {
  if (value === undefined || value === true) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const amount = Number(raw);
  if (Number.isFinite(amount) && amount >= 0) {
    return {
      amount,
      currency: "USD",
      source: "user"
    };
  }
  return {
    raw,
    source: "user"
  };
}

function parsePositiveInteger(value, fallback, flagName) {
  if (value === undefined || value === true) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return number;
}

function parseWriteScope(value) {
  if (value === undefined) {
    return {
      declared: false,
      entries: []
    };
  }
  if (value === true) {
    throw new Error("--write-scope requires a comma-separated list of files or directories");
  }

  const entries = String(value)
    .split(",")
    .map((entry) => normalizeWriteScopeEntry(entry))
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error("--write-scope requires at least one file or directory");
  }
  return {
    declared: true,
    entries: unique(entries)
  };
}

function normalizeWriteScopeEntry(entry) {
  return String(entry)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}

function normalizeReportKind(value) {
  const normalized = value.toLowerCase();
  if (!reportKindDefinitions.has(normalized)) {
    throw new Error(`Unsupported report kind: ${value}. Use ${[...reportKindDefinitions].join(", ")}.`);
  }
  return normalized;
}

function defaultPolicy() {
  return {
    schema_version: SCHEMA_VERSION,
    preferred_runner_order: ["claude", "codex", "gemini"],
    default_roster: "solo",
    parallel_provider_cli_runs: false,
    provider_auth: "inherit_cli_environment",
    transcript_export_default: "omit",
    self_modification: "proposal_only",
    token_governor: defaultTokenGovernorPolicy(),
    notes: [
      "Default runtime policy used because no committed policy file exists."
    ]
  };
}

function defaultTokenGovernorPolicy() {
  return {
    mode: "advisory",
    max_tool_output_chars: 20000,
    store_full_tool_output: true,
    handoff_after_turns: 120,
    handoff_after_session_tokens: 40000000,
    handoff_after_major_milestone: true,
    subagents_require_budget: true,
    subagents_require_artifact: true,
    review_agents_require_named_scope: true,
    expensive_routes_require_reason: true,
    expensive_route_allowlist: ["architecture", "production-debug", "launch-risk", "security", "release"],
    default_effort: "medium",
    routine_effort: "low",
    notes: [
      "Rux is the source of truth for agent token discipline.",
      "Agents should summarize oversized command output, keep full logs outside model context, and create handoffs before long sessions become the operating default.",
      "Use expensive models, high effort, and subagents only when the task class and expected artifact justify the extra context."
    ]
  };
}

async function loadPolicy(cwd) {
  const path = join(cwd, POLICY_FILE);
  const fromFile = await readJsonIfExists(path);
  const policy = fromFile ? normalizePolicy(fromFile) : defaultPolicy();
  return {
    path,
    exists: Boolean(fromFile),
    source: fromFile ? "file" : "default",
    policy
  };
}

function normalizePolicy(policy) {
  const defaults = defaultPolicy();
  const preferredRunnerOrder = Array.isArray(policy.preferred_runner_order)
    ? policy.preferred_runner_order.filter((runner) => typeof runner === "string" && runnerDefinitions[runner])
    : defaults.preferred_runner_order;
  return {
    ...defaults,
    ...policy,
    schema_version: Number(policy.schema_version ?? defaults.schema_version),
    preferred_runner_order: preferredRunnerOrder.length > 0 ? preferredRunnerOrder : defaults.preferred_runner_order,
    default_roster: rosterDefinitions.has(policy.default_roster) ? policy.default_roster : defaults.default_roster,
    parallel_provider_cli_runs: Boolean(policy.parallel_provider_cli_runs),
    token_governor: normalizeTokenGovernorPolicy(policy.token_governor, defaults.token_governor),
    notes: Array.isArray(policy.notes) ? policy.notes.map(String) : defaults.notes
  };
}

function normalizeTokenGovernorPolicy(policy, defaults = defaultTokenGovernorPolicy()) {
  const source = policy && typeof policy === "object" ? policy : {};
  return {
    ...defaults,
    ...source,
    mode: ["off", "advisory", "enforced"].includes(source.mode) ? source.mode : defaults.mode,
    max_tool_output_chars: positiveIntegerOrDefault(source.max_tool_output_chars, defaults.max_tool_output_chars),
    store_full_tool_output: source.store_full_tool_output === undefined ? defaults.store_full_tool_output : Boolean(source.store_full_tool_output),
    handoff_after_turns: positiveIntegerOrDefault(source.handoff_after_turns, defaults.handoff_after_turns),
    handoff_after_session_tokens: positiveIntegerOrDefault(source.handoff_after_session_tokens, defaults.handoff_after_session_tokens),
    handoff_after_major_milestone: source.handoff_after_major_milestone === undefined ? defaults.handoff_after_major_milestone : Boolean(source.handoff_after_major_milestone),
    subagents_require_budget: source.subagents_require_budget === undefined ? defaults.subagents_require_budget : Boolean(source.subagents_require_budget),
    subagents_require_artifact: source.subagents_require_artifact === undefined ? defaults.subagents_require_artifact : Boolean(source.subagents_require_artifact),
    review_agents_require_named_scope: source.review_agents_require_named_scope === undefined ? defaults.review_agents_require_named_scope : Boolean(source.review_agents_require_named_scope),
    expensive_routes_require_reason: source.expensive_routes_require_reason === undefined ? defaults.expensive_routes_require_reason : Boolean(source.expensive_routes_require_reason),
    expensive_route_allowlist: Array.isArray(source.expensive_route_allowlist)
      ? source.expensive_route_allowlist.map(String).filter(Boolean)
      : defaults.expensive_route_allowlist,
    default_effort: typeof source.default_effort === "string" && source.default_effort.trim() ? source.default_effort : defaults.default_effort,
    routine_effort: typeof source.routine_effort === "string" && source.routine_effort.trim() ? source.routine_effort : defaults.routine_effort,
    notes: Array.isArray(source.notes) ? source.notes.map(String) : defaults.notes
  };
}

function positiveIntegerOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function initRepo(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const force = options.force === true;
  const policyPath = join(cwd, POLICY_FILE);
  const gitignorePath = join(cwd, ".gitignore");
  const policyExists = existsSync(policyPath);
  const policyWritten = !policyExists || force;
  const actions = [];

  if (policyWritten) {
    await writeFile(policyPath, `${JSON.stringify(defaultPolicy(), null, 2)}\n`, "utf8");
    actions.push(policyExists ? `${POLICY_FILE} overwritten` : `${POLICY_FILE} created`);
  } else {
    actions.push(`${POLICY_FILE} already exists`);
  }

  const gitignoreBefore = await readTextIfExists(gitignorePath);
  const gitignoreHasStore = gitignoreBefore.split(/\r?\n/).some((line) => line.trim() === `${STORE_DIR}/`);
  let gitignoreWritten = false;
  if (!gitignoreHasStore) {
    const prefix = gitignoreBefore && !gitignoreBefore.endsWith("\n") ? "\n" : "";
    await writeFile(gitignorePath, `${gitignoreBefore}${prefix}${STORE_DIR}/\n`, "utf8");
    gitignoreWritten = true;
    actions.push(".gitignore updated");
  } else {
    actions.push(".gitignore already ignores store");
  }

  emitResult(options, {
    product: PRODUCT_NAME,
    cwd,
    policy: {
      path: relative(cwd, policyPath),
      created: !policyExists,
      overwritten: policyExists && force,
      written: policyWritten
    },
    gitignore: {
      path: relative(cwd, gitignorePath),
      written: gitignoreWritten,
      ignores_store: true
    },
    actions,
    notes: [
      "init does not call providers.",
      `${STORE_DIR}/ stores local run transcripts and ledger files and should stay out of git.`
    ]
  });
}

function normalizeRunner(runner) {
  if (!runnerDefinitions[runner]) {
    throw new Error(`Unknown runner: ${runner}`);
  }
  return runner;
}

function normalizeManualRunner(runner) {
  const normalized = runner.toLowerCase();
  const allowed = new Set(["claude", "codex", "gemini"]);
  if (!allowed.has(normalized)) {
    throw new Error(`Unsupported record runner: ${runner}. Use claude, codex, or gemini.`);
  }
  return normalized;
}

function normalizeRoster(roster) {
  if (!rosterDefinitions.has(roster)) {
    throw new Error(`Unknown roster: ${roster}. Use solo, pair, repair, or plan-code-review.`);
  }
  return roster;
}

function normalizeRunPurpose(value) {
  const purpose = String(value ?? "task").trim();
  if (purpose === "task" || purpose === "task_run") return "task_run";
  if (purpose === "probe") return "probe";
  throw new Error("--purpose requires task or probe");
}

function normalizeTaskKind(value) {
  const kind = String(value ?? "").trim();
  const allowed = new Set(["unspecified", "docs", "test", "bugfix", "refactor", "review", "feature", "general"]);
  if (!allowed.has(kind)) {
    throw new Error(`Unsupported task kind: ${value}. Use ${[...allowed].join(", ")}.`);
  }
  return kind;
}

function resolveRosterRunners(roster, primaryRunner, options) {
  if (roster === "solo") {
    return { primary: primaryRunner, implementer: primaryRunner };
  }

  if (roster === "pair") {
    return {
      primary: primaryRunner,
      implementer: normalizeRunner(String(options["implementer-runner"] ?? options["coder-runner"] ?? primaryRunner)),
      reviewer: normalizeRunner(String(options["reviewer-runner"] ?? primaryRunner))
    };
  }

  if (roster === "repair") {
    return {
      primary: primaryRunner,
      implementer: normalizeRunner(String(options["implementer-runner"] ?? options["coder-runner"] ?? primaryRunner)),
      repairer: normalizeRunner(String(options["repair-runner"] ?? primaryRunner))
    };
  }

  if (roster === "plan-code-review") {
    return {
      primary: primaryRunner,
      planner: normalizeRunner(String(options["planner-runner"] ?? primaryRunner)),
      coder: normalizeRunner(String(options["coder-runner"] ?? options["implementer-runner"] ?? primaryRunner)),
      reviewer: normalizeRunner(String(options["reviewer-runner"] ?? primaryRunner))
    };
  }

  throw new Error(`Unsupported roster: ${roster}`);
}

function ensureRunnersAvailable(runners) {
  for (const runner of unique(runners)) {
    if (runner !== "fake" && !commandExists(runnerDefinitions[runner].command)) {
      throw new Error(`${runner} runner is not available. Run "rux runners" for details.`);
    }
  }
}

async function printRunners(args) {
  const { options } = parseOptions(args);
  const rows = Object.entries(runnerDefinitions).map(([name, definition]) => {
    const available = definition.available === true || commandExists(definition.command);
    return {
      name,
      available,
      command: definition.command ?? "(built-in)",
      notes: definition.notes
    };
  });

  emitResult(options, rows);
}

async function doctor(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const runs = events.filter((event) => event.type === "run");
  const proposals = events.filter((event) => event.type === "proposal");
  const reports = events.filter((event) => event.type === "report");
  const checks = events.filter((event) => event.type === "check");
  const verdicts = events.filter((event) => event.type === "verdict");
  const marks = events.filter((event) => event.type === "mark");
  const runners = Object.entries(runnerDefinitions).map(([name, definition]) => ({
    name,
    label: definition.label,
    command: definition.command ?? "(built-in)",
    available: definition.available === true || commandExists(definition.command),
    notes: definition.notes
  }));

  emitResult(options, {
    product: PRODUCT_NAME,
    cli: CLI_NAME,
    schema_version: SCHEMA_VERSION,
    cwd,
    node: {
      version: process.version,
      ok: Number(process.versions.node.split(".")[0]) >= 20
    },
    git: gitDoctor(cwd),
    store: {
      path: join(cwd, STORE_DIR),
      exists: existsSync(join(cwd, STORE_DIR)),
      ledger_events: events.length,
      runs: runs.length,
      checks: checks.length,
      verdicts: verdicts.length,
      marks: marks.length,
      proposals: proposals.length,
      reports: reports.length
    },
    runners,
    notes: [
      "doctor is read-only and does not call provider services.",
      "Provider availability only means the CLI binary is on PATH; auth and live behavior still require provider-smoke."
    ]
  }, formatDoctorHuman);
}

async function releaseCheck(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const result = await buildReleaseCheck(cwd);
  emitResult(options, result, formatReleaseHuman);
  if (options.strict === true && !result.ready) {
    process.exitCode = 1;
  }
}

async function buildReleaseCheck(cwd) {
  const packageJson = await readJsonIfExists(join(cwd, "package.json"));
  const policy = await loadPolicy(cwd);
  const identity = await buildIdentitySummary(cwd, packageJson);
  const events = await readLedger(cwd);
  const topRuns = topLevelRuns(runsWithAppendedChecks(events));
  const verdicts = latestVerdictByRun(events);
  const marks = lifecycleMarksByRun(events);
  const eligibility = partitionRecommendationEvidence(topRuns, verdicts, marks);
  const git = gitDoctor(cwd);
  const packageFilesScoped = packageFilesAreReleaseScoped(packageJson);
  const providerSmoke = ["claude", "codex", "gemini"].map((runner) => providerSmokeStatus(topRuns, runner));
  const gates = [
    releaseGate("package_json", Boolean(packageJson), "package.json exists.", { lifecycle: "permanent", category: "package" }),
    releaseGate("package_scope_matches_npm_org", packageNameUsesNpmOrg(packageJson), `package name uses the @${NPM_ORG}/ npm org scope.`, { lifecycle: "permanent", category: "package" }),
    releaseGate("package_private_removed", packageJson?.private === false, "`private: true` must be deliberately removed before publish.", { lifecycle: "one_time", category: "publish_decision" }),
    releaseGate("package_files_allowlist", packageFilesScoped, "package.json files allowlist excludes internal docs, tests, and agent instructions.", { lifecycle: "permanent", category: "package" }),
    releaseGate("license", existsSync(join(cwd, "LICENSE")), "LICENSE exists.", { lifecycle: "permanent", category: "docs" }),
    releaseGate("readme", existsSync(join(cwd, "README.md")), "README.md exists.", { lifecycle: "permanent", category: "docs" }),
    releaseGate("policy_file", policy.exists, `${POLICY_FILE} exists.`, { lifecycle: "permanent", category: "policy" }),
    releaseGate("state_doc", existsSync(join(cwd, "docs", "STATE.md")), "docs/STATE.md exists.", { lifecycle: "release", category: "docs" }),
    releaseGate("architecture_doc", existsSync(join(cwd, "docs", "ARCHITECTURE.md")), "docs/ARCHITECTURE.md exists.", { lifecycle: "release", category: "docs" }),
    releaseGate("v0_plan", existsSync(join(cwd, "docs", "V0_PLAN.md")), "docs/V0_PLAN.md exists.", { lifecycle: "one_time", category: "docs" }),
    releaseGate("name_release_decision", identity.release_name_locked, "Docs no longer describe the name as undecided.", { lifecycle: "one_time", category: "naming" }),
    releaseGate("local_smoke_script", Boolean(packageJson?.scripts?.smoke), "Local smoke script exists.", { lifecycle: "permanent", category: "verification" }),
    releaseGate("check_script", Boolean(packageJson?.scripts?.check), "Syntax/check script exists.", { lifecycle: "permanent", category: "verification" }),
    releaseGate("prepublish_release_guard", packageScriptsHaveReleaseGuard(packageJson), "npm prepublishOnly runs release verification with strict release-check.", { lifecycle: "permanent", category: "verification" }),
    releaseGate("worktree_clean", git.available && git.inside_work_tree && git.dirty_entries === 0, "Git worktree has no uncommitted changes outside .rux/.", { lifecycle: "permanent", category: "repo_hygiene" }),
    releaseGate("claude_smoke_evidence", providerSmoke.find((item) => item.runner === "claude")?.ok === true, "Ledger contains a successful Claude provider-smoke run with no file changes.", { lifecycle: "release", category: "provider_evidence" }),
    releaseGate("codex_smoke_evidence", providerSmoke.find((item) => item.runner === "codex")?.ok === true, "Ledger contains a successful Codex provider-smoke run with no file changes.", { lifecycle: "release", category: "provider_evidence" }),
    releaseGate("gemini_smoke_evidence", providerSmoke.find((item) => item.runner === "gemini")?.ok === true, "Ledger contains a successful Gemini provider-smoke run with no file changes.", { lifecycle: "release", category: "provider_evidence" }),
    releaseGate("real_provider_task_evidence", eligibility.eligible.some(isLiveProviderTaskRun), "Ledger contains at least one routing-eligible live provider task with a check or human verdict.", { lifecycle: "one_time", category: "provider_evidence" }),
    releaseGate("no_local_only_language", !(await hasLocalOnlyLanguage(cwd)), "Docs do not describe the product as local-only.", { lifecycle: "one_time", category: "docs" })
  ];

  const ready = gates.every((gate) => gate.ok);
  const blockers = gates.filter((gate) => !gate.ok);
  return {
    product: PRODUCT_NAME,
    cwd,
    ready,
    package: packageJson ? {
      name: packageJson.name,
      version: packageJson.version,
      private: packageJson.private,
      license: packageJson.license
    } : null,
    identity,
    provider_smoke: providerSmoke,
    gates,
    blocker_summary: summarizeReleaseBlockers(blockers),
    next_actions: blockers.map((gate) => gate.action)
  };
}

async function buildIdentitySummary(cwd, packageJson) {
  const releaseNameLocked = !(await hasWorkingNameLanguage(cwd));
  const packageBin = packageJson?.bin && typeof packageJson.bin === "object"
    ? Object.keys(packageJson.bin).sort()
    : [];
  const packageFiles = Array.isArray(packageJson?.files)
    ? packageJson.files.map(normalizePackageFileEntry)
    : [];

  return {
    product: PRODUCT_NAME,
    cli: CLI_NAME,
    npm_org: NPM_ORG,
    package_name: packageJson?.name ?? null,
    package_bin: packageBin,
    package_files: packageFiles,
    store_dir: STORE_DIR,
    policy_file: POLICY_FILE,
    release_name_locked: releaseNameLocked,
    name_status: releaseNameLocked ? "release_name_selected" : "working_name",
    release_gate: "name_release_decision",
    rename_surfaces: [
      "src/identity.mjs: PRODUCT_NAME, CLI_NAME, STORE_DIR",
      "package.json: name, bin, files",
      "policy file name and src/cli.mjs POLICY_FILE",
      ".gitignore store rule",
      "README.md, AGENTS.md, docs/STATE.md, docs/ARCHITECTURE.md, docs/V0_PLAN.md",
      "tests/smoke.mjs package, bin, store, and policy expectations"
    ]
  };
}

function packageFilesAreReleaseScoped(packageJson) {
  if (!Array.isArray(packageJson?.files)) return false;

  const files = packageJson.files.map(normalizePackageFileEntry);
  const required = ["src/", "rux.policy.json"];
  const allowed = new Set(required);

  return required.every((entry) => files.includes(entry)) &&
    files.every((entry) => allowed.has(entry));
}

function normalizePackageFileEntry(entry) {
  const value = String(entry).replace(/^\.\//, "");
  if (value === "src") return "src/";
  return value;
}

function packageNameUsesNpmOrg(packageJson) {
  return typeof packageJson?.name === "string" && packageJson.name.startsWith(`@${NPM_ORG}/`);
}

function packageScriptsHaveReleaseGuard(packageJson) {
  const scripts = packageJson?.scripts ?? {};
  return typeof scripts["prepublishOnly"] === "string" &&
    scripts["prepublishOnly"].includes("release:verify") &&
    typeof scripts["release:verify"] === "string" &&
    scripts["release:verify"].includes("npm run check") &&
    scripts["release:verify"].includes("npm run smoke") &&
    scripts["release:verify"].includes("release-check --strict");
}

async function status(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const policy = await loadPolicy(cwd);
  const packageJson = await readJsonIfExists(join(cwd, "package.json"));
  const runs = runsWithAppendedChecks(events);
  const topRuns = topLevelRuns(runs);
  const proposals = events.filter((event) => event.type === "proposal");
  const reports = events.filter((event) => event.type === "report");
  const verdicts = latestVerdictByRun(events);
  const marks = lifecycleMarksByRun(events);
  const release = await buildReleaseCheck(cwd);
  const eligibility = partitionRecommendationEvidence(topRuns, verdicts, marks);
  const liveProviderTaskRuns = topRuns.filter(isLiveProviderTaskRun);
  const manualTaskRuns = topRuns.filter(isManualTaskRun);
  const providerSmokeRuns = topRuns.filter((run) => run.purpose === "provider_smoke");
  const markNudges = markNudgesForStatus(topRuns, marks);
  const outcomes = topRuns.map((run) => summarizeOutcome(
    run,
    runs.filter((candidate) => candidate.parent_id === run.id),
    verdicts.get(run.id) ?? null,
    marks.get(run.id) ?? []
  ));
  const eligibleTaskKinds = unique(eligibility.eligible.map((run) => run.task_kind ?? classifyTask(run.task ?? ""))).sort();
  const rankings = eligibleTaskKinds.map((taskKind) => ({
    task_kind: taskKind,
    top: summarizeEvidenceGroups(
      eligibility.eligible.filter((run) => (run.task_kind ?? classifyTask(run.task ?? "")) === taskKind),
      verdicts,
      marks
    ).slice(0, 3)
  }));
  const nextActions = statusNextActions({ topRuns, liveProviderTaskRuns, eligibility, release, proposals });
  const nextCapture = buildNextCapture({
    events,
    liveProviderTaskRuns,
    eligibility,
    policy: policy.policy,
    packageJson
  });

  emitResult(options, {
    product: PRODUCT_NAME,
    cli: CLI_NAME,
    identity: release.identity,
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    cwd,
    repo: gitDoctor(cwd),
    policy: {
      path: relative(cwd, policy.path),
      exists: policy.exists,
      source: policy.source,
      preferred_runner_order: policy.policy.preferred_runner_order,
      default_roster: policy.policy.default_roster,
      parallel_provider_cli_runs: policy.policy.parallel_provider_cli_runs,
      provider_auth: policy.policy.provider_auth,
      transcript_export_default: policy.policy.transcript_export_default,
      self_modification: policy.policy.self_modification,
      token_governor: policy.policy.token_governor
    },
    ledger: {
      path: join(cwd, STORE_DIR),
      exists: existsSync(join(cwd, STORE_DIR)),
      events: events.length,
      runs: runs.length,
      top_level_runs: topRuns.length,
      child_runs: runs.length - topRuns.length,
      checks: events.filter((event) => event.type === "check").length,
      verdicts: events.filter((event) => event.type === "verdict").length,
      marks: events.filter((event) => event.type === "mark").length,
      proposals: proposals.length,
      reports: reports.length
    },
    outcomes: {
      labels: countBy(outcomes.map((outcome) => outcome.label)),
      positive: outcomes.filter((outcome) => outcome.score > 0).length,
      missing_signal: outcomes.filter((outcome) => outcome.label === "unlabeled").length,
      release_only: outcomes.filter((outcome) => outcome.confidence === "release_only").length
    },
    evidence: {
      eligible_runs: eligibility.eligible.length,
      live_provider_task_runs: liveProviderTaskRuns.length,
      manual_task_runs: manualTaskRuns.length,
      provider_smoke_runs: providerSmokeRuns.length,
      ignored_runs: eligibility.ignored.length,
      ignored_reasons: countBy(eligibility.ignored.map((item) => item.reason)),
      maturity: summarizeEvidenceMaturity(eligibility.eligible, verdicts, marks),
      rankings
    },
    provider_smoke: ["claude", "codex", "gemini"].map((runner) => providerSmokeStatus(topRuns, runner)),
    runners: Object.entries(runnerDefinitions).map(([name, definition]) => ({
      name,
      available: definition.available === true || commandExists(definition.command),
      command: definition.command ?? "(built-in)"
    })),
    release: {
      ready: release.ready,
      blockers: release.gates.filter((gate) => !gate.ok).map((gate) => gate.name),
      blocker_summary: release.blocker_summary,
      next_actions: release.next_actions
    },
    latest_runs: newestRuns(topRuns).slice(0, 5).map((run) => {
      const classification = readClassification(run);
      const outcome = summarizeOutcome(
        run,
        runs.filter((candidate) => candidate.parent_id === run.id),
        verdicts.get(run.id) ?? null,
        marks.get(run.id) ?? []
      );
      return {
        id: run.id,
        purpose: run.purpose ?? "task_run",
        runner: run.runner,
        roster: run.roster,
        provider_mode: run.provider_mode ?? inferProviderMode(run),
        status: run.status,
        effective_status: classification.status,
        effective_status_reason: classification.status_reason,
        classifier_version: classification.classifier_version,
        outcome: outcome.label,
        task_kind: run.task_kind ?? classifyTask(run.task ?? ""),
        task_kind_source: run.task_kind_source ?? "legacy_inferred",
        task_kind_suggestion: run.task_kind_suggestion ?? null,
        task_summary: formatListTask(run.task),
        task: run.task
      };
    }),
    mark_nudges: markNudges,
    next_capture: nextCapture,
    next_actions: nextActions,
    notes: [
      "status is read-only and does not call providers.",
      "Provider-smoke evidence proves adapter readiness, not task quality."
    ]
  }, formatStatusHuman);
}

async function showPolicy(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const policy = await loadPolicy(cwd);
  emitResult(options, {
    product: PRODUCT_NAME,
    cwd,
    path: relative(cwd, policy.path),
    exists: policy.exists,
    source: policy.source,
    policy: policy.policy,
    notes: [
      "policy is read-only and does not call providers.",
      "A committed policy file lets teams review local runner safety defaults before a hosted layer exists."
    ]
  });
}

async function exportRuns(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const allRuns = runsWithAppendedChecks(events);
  const topRuns = topLevelRuns(allRuns);
  const verdicts = latestVerdictByRun(events);
  const marks = lifecycleMarksByRun(events);
  const reports = reportsByRunId(events);
  const runId = normalizeOptionalString(options["run-id"]);
  const limit = parsePositiveInteger(options.limit, 20, "--limit");
  const includeTranscripts = options["include-transcripts"] === true;
  const candidates = runId
    ? allRuns.filter((run) => run.id === runId)
    : topRuns.slice(-limit).reverse();
  if (runId && candidates.length === 0) {
    throw new Error(`Run not found: ${runId}`);
  }

  const exportedRuns = [];
  for (const run of candidates) {
    const children = allRuns.filter((candidate) => candidate.parent_id === run.id);
    exportedRuns.push(await exportRunRecord({
      cwd,
      run,
      children,
      verdicts,
      marks,
      reports,
      includeTranscripts
    }));
  }

  emitResult(options, {
    product: PRODUCT_NAME,
    cli: CLI_NAME,
    schema_version: SCHEMA_VERSION,
    export_version: 1,
    exported_at: new Date().toISOString(),
    cwd,
    scope: runId ? "single_run" : "recent_runs",
    include_transcripts: includeTranscripts,
    runs: exportedRuns,
    counts: {
      ledger_events: events.length,
      total_runs: allRuns.length,
      exported_runs: exportedRuns.length,
      truncated: !runId && topRuns.length > exportedRuns.length
    },
    notes: [
      "export is read-only and does not call providers.",
      includeTranscripts
        ? "Transcript text is included because --include-transcripts was provided. Review before sharing."
        : "Transcript text is omitted by default. Use --include-transcripts only after reviewing sensitivity."
    ]
  }, formatExportHuman);
}

async function exportRunRecord({ cwd, run, children, verdicts, marks, reports, includeTranscripts }) {
  const verdict = verdicts.get(run.id) ?? null;
  const runMarks = marks.get(run.id) ?? [];
  const runReports = reports.get(run.id) ?? [];
  const classification = readClassification(run);
  const evaluation = evaluateRunRecord(run, children, verdicts, marks, reports);
  const record = {
    id: run.id,
    purpose: run.purpose ?? "task_run",
    source: run.source ?? "live",
    confidence: run.confidence ?? "unknown",
    task: run.task,
    task_kind: run.task_kind ?? classifyTask(run.task ?? ""),
    task_kind_source: run.task_kind_source ?? "legacy_inferred",
    task_kind_suggestion: run.task_kind_suggestion ?? null,
    runner: run.runner,
    model: run.model ?? null,
    effort: run.effort ?? null,
    roster: run.roster,
    role: run.role ?? null,
    provider_mode: run.provider_mode ?? inferProviderMode(run),
    replay: replayMetadataForRun(run),
    status: run.status,
    status_reason: run.status_reason ?? null,
    effective_status: classification.status,
    effective_status_reason: classification.status_reason,
    classifier_version: classification.classifier_version,
    started_at: run.started_at,
    ended_at: run.ended_at,
    duration_ms: run.duration_ms,
    adapter: run.adapter ?? null,
    repo: run.repo ?? null,
    changed_files: Array.isArray(run.changed_files) ? run.changed_files : [],
    session_baseline: run.session_baseline ?? null,
    contaminated_files: Array.isArray(run.contaminated_files) ? run.contaminated_files : [],
    write_scope: run.write_scope ?? null,
    checks: Array.isArray(run.checks) ? run.checks.map((check) => ({
      id: check.id ?? null,
      source: check.source ?? "run_check",
      command: check.command,
      exit_code: check.exit_code,
      duration_ms: check.duration_ms ?? null,
      repo: check.repo ?? null,
      changed_files: Array.isArray(check.changed_files) ? check.changed_files : [],
      vacuous: check.vacuous === true || isVacuousCheckForRun(run, check)
    })) : [],
    verdict: verdict ? {
      verdict: verdict.verdict,
      note: verdict.note,
      created_at: verdict.created_at
    } : null,
    marks: runMarks.map(formatLifecycleMark),
    reports: runReports.map(formatLinkedReport),
    outcome: evaluation.outcome,
    routing: evaluation.routing,
    release: evaluation.release,
    child_runs: children.map((child) => ({
      id: child.id,
      role: child.role,
      runner: child.runner,
      status: child.status,
      replay: replayMetadataForRun(child),
      transcript_path: child.transcript_path
    })),
    transcript_path: run.transcript_path
  };

  if (includeTranscripts) {
    record.transcript = await readTextIfExists(join(cwd, run.transcript_path ?? ""));
    record.child_runs = await Promise.all(record.child_runs.map(async (child) => ({
      ...child,
      transcript: await readTextIfExists(join(cwd, child.transcript_path ?? ""))
    })));
  }

  return record;
}

async function runCommand(args) {
  const { positionals, options } = parseOptions(args);
  const task = positionals.join(" ").trim();
  if (!task) {
    throw new Error(`Missing task. Example: ${CLI_NAME} run "update the README" --runner fake`);
  }

  const cwd = resolveCwd(options);
  const policy = await loadPolicy(cwd);
  const runner = normalizeRunner(String(options.runner ?? "fake"));
  const roster = normalizeRoster(String(options.roster ?? "solo"));
  const purpose = normalizeRunPurpose(options.purpose);
  const runnerByRole = resolveRosterRunners(roster, runner, options);
  const metadata = metadataFromOptions(options);
  normalizeVerdictOption(options.verdict);
  ensureRunnersAvailable(Object.values(runnerByRole));

  await ensureStore(cwd);

  if (roster !== "solo") {
    const run = await executeRoster({ roster, task, cwd, options, runnerByRole, metadata, purpose, policy: policy.policy });
    const verdict = await maybeAttachRunVerdict({ cwd, run, options });
    emitResult(options, await summarizeRecordedRun({ cwd, run, verdict }));
    return;
  }

  const run = await captureRunAttempt({
    runner,
    roster,
    task,
    cwd,
    options,
    checkCommand: options.check ? String(options.check) : null,
    purpose,
    metadata,
    policy: policy.policy,
    replay: recordedReplayMetadata(buildRunCommand({
      task,
      runner,
      roster,
      options,
      model: metadata.model,
      effort: metadata.effort
    }), {
      runner,
      humanReviewRequired: true,
      reason: "Recorded from the original run command."
    })
  });

  const verdict = await maybeAttachRunVerdict({ cwd, run, options });
  emitResult(options, await summarizeRecordedRun({ cwd, run, verdict }));
}

async function providerSmoke(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const policy = await loadPolicy(cwd);
  if (!options.runner) {
    throw new Error("provider-smoke requires --runner claude, --runner codex, or --runner gemini");
  }
  const runner = normalizeRunner(String(options.runner));
  const metadata = metadataFromOptions(options);
  if (runner === "fake") {
    throw new Error("provider-smoke requires a real provider runner: claude, codex, or gemini");
  }
  ensureRunnersAvailable([runner]);
  await ensureStore(cwd);
  const previousAttempts = providerSmokeAttempts(topLevelRuns(runsWithAppendedChecks(await readLedger(cwd))), runner);
  const oldestAttempt = previousAttempts.at(-1) ?? null;
  const latestAttempt = previousAttempts[0] ?? null;
  const attempt = {
    kind: "provider_smoke",
    group_id: `provider-smoke:${runner}`,
    number: previousAttempts.length + 1,
    previous_run_id: latestAttempt?.id ?? null,
    root_run_id: oldestAttempt?.id ?? null
  };

  const run = await captureRunAttempt({
    runner,
    roster: "solo",
    task: providerSmokeTask(runner),
    cwd,
    options,
    checkCommand: null,
    purpose: "provider_smoke",
    attempt,
    metadata,
    policy: policy.policy,
    failOnChangedFiles: true,
    replay: recordedReplayMetadata(buildProviderSmokeCommand({
      runner,
      options,
      model: metadata.model,
      effort: metadata.effort
    }), {
      runner,
      humanReviewRequired: false,
      reason: "Recorded from the original provider-smoke command."
    }),
    notes: [
      "Provider smoke run. Release-check uses this as explicit provider evidence.",
      "This run should not change files."
    ]
  });

  emitResult(options, summarizeRun(run));
}

async function recordManualRun(args) {
  const { positionals, options } = parseOptions(args);
  const task = positionals.join(" ").trim();
  normalizeVerdictOption(options.verdict);
  if (options.start === true) {
    return recordSessionBaseline({ task, options });
  }

  const run = await createManualRun({ task, options });
  const verdict = await maybeAttachRunVerdict({ cwd: run.cwd, run, options });
  emitResult(options, await summarizeRecordedRun({ cwd: run.cwd, run, verdict }));
}

async function createManualRun({ task, options, extraNotes = [] }) {
  if (!task || !options.runner) {
    throw new Error(`Usage: ${CLI_NAME} record "<task>" --runner claude|codex|gemini [--check "COMMAND"] [--note "TEXT"]`);
  }

  const cwd = resolveCwd(options);
  const runner = normalizeManualRunner(String(options.runner));
  const metadata = metadataFromOptions(options);
  const note = normalizeOptionalString(options.note);
  const startedAt = new Date();
  await ensureStore(cwd);

  const sessionBaseline = await resolveSessionBaseline(cwd);
  if (sessionBaseline.warning) {
    writeRuxProgress(sessionBaseline.warning);
  }
  const recordedStatus = gitStatusMap(cwd);
  const recordedFingerprints = fingerprintStatusMap(cwd, recordedStatus);
  const recordedRepo = gitSnapshot(cwd, recordedStatus);
  const baselineDiff = sessionBaseline.baseline
    ? diffStatusAgainstBaseline(cwd, sessionBaseline.baseline, recordedStatus)
    : null;
  const changedFiles = baselineDiff ? baselineDiff.changed_files : [...recordedStatus.keys()].sort();
  const taskKind = taskKindMetadata(task, options, changedFiles);
  maybeWarnUnspecifiedTaskKind(options);
  const check = options.check ? { source: "record_check", ...runCheckWithProgress(String(options.check), cwd) } : null;
  const afterCheckStatus = gitStatusMap(cwd);
  const afterCheckFingerprints = check ? fingerprintStatusMap(cwd, afterCheckStatus) : null;
  const afterCheckRepo = gitSnapshot(cwd, afterCheckStatus);
  const checkChangedFiles = check
    ? gitChangedFilesBetween(recordedStatus, afterCheckStatus, cwd, recordedFingerprints, afterCheckFingerprints)
    : [];
  const writeScope = evaluateWriteScope(options, changedFiles);
  if (check) {
    check.repo = {
      before: recordedRepo,
      after: afterCheckRepo
    };
    check.changed_files = checkChangedFiles;
  }
  const endedAt = new Date();
  let status = check && check.exit_code !== 0 ? "failed" : "ok";
  let statusReason = check && check.exit_code !== 0 ? "check_failed" : "manual_recorded";
  let outputSignal = {
    kind: "manual_record",
    status,
    reason: statusReason,
    note: "Rux recorded current-session work without launching a provider CLI."
  };
  const notes = [
    "Manual/current-session record. Rux did not launch the provider adapter for this run.",
    "Manual records are down-weighted in recommendations and do not satisfy release provider-task evidence.",
    ...(sessionBaseline.baseline ? [`Diffed against record baseline ${sessionBaseline.baseline.id}.`] : []),
    ...(baselineDiff && baselineDiff.contaminated_files.length > 0 ? [`Files changed after already being dirty at baseline: ${baselineDiff.contaminated_files.join(", ")}.`] : []),
    ...extraNotes,
    ...(note ? [note] : [])
  ];
  if (status === "ok" && writeScope.violations.length > 0) {
    status = "failed";
    statusReason = "write_scope_violation";
    outputSignal = {
      kind: "write_scope_violation",
      status: "failed",
      reason: "write_scope_violation",
      note: `Manual record changed files outside --write-scope: ${writeScope.violations.join(", ")}.`
    };
    notes.push(outputSignal.note);
  }
  const id = createRunId(startedAt);
  const transcript = formatManualTranscript({
    runner,
    task,
    note,
    check,
    changedFiles,
    sessionBaseline: sessionBaseline.baseline,
    contaminatedFiles: baselineDiff?.contaminated_files ?? [],
    startedAt,
    endedAt
  });
  const transcriptPath = await writeTranscript(cwd, id, transcript);
  const replayCommand = buildRecordCommand({
    task,
    runner,
    options,
    model: metadata.model,
    effort: metadata.effort
  });

  const run = {
    schema_version: SCHEMA_VERSION,
    type: "run",
    id,
    purpose: "task_run",
    source: "manual",
    confidence: "high",
    task,
    task_kind: taskKind.task_kind,
    task_kind_source: taskKind.task_kind_source,
    task_kind_suggestion: taskKind.task_kind_suggestion,
    runner,
    model: metadata.model ?? null,
    effort: metadata.effort ?? null,
    roster: "solo",
    parent_id: null,
    role: "runner",
    cwd,
    status,
    status_reason: statusReason,
    provider_mode: "internal",
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: endedAt.getTime() - startedAt.getTime(),
    repo: {
      recorded_at: recordedRepo,
      after_check: check ? afterCheckRepo : null
    },
    session_baseline: sessionBaseline.baseline ? {
      id: sessionBaseline.baseline.id,
      created_at: sessionBaseline.baseline.created_at,
      head: sessionBaseline.baseline.repo?.head ?? null,
      dirty_files: Array.isArray(sessionBaseline.baseline.dirty_files) ? sessionBaseline.baseline.dirty_files : [],
      contaminated_files: baselineDiff?.contaminated_files ?? [],
      open_baselines_found: sessionBaseline.open_count,
      closed_baseline_ids: sessionBaseline.open_ids
    } : null,
    contaminated_files: baselineDiff?.contaminated_files ?? [],
    transcript_path: relative(cwd, transcriptPath),
    changed_files: changedFiles,
    write_scope: writeScope.declared ? {
      allowed: writeScope.allowed,
      violations: writeScope.violations
    } : null,
    checks: check ? [check] : [],
    cost_hint: metadata.cost_hint ?? null,
    output_signal: outputSignal,
    adapter: buildManualAdapterRecord(runner, metadata),
    replay: manualReplayMetadata(replayCommand),
    notes
  };
  stampVacuousChecks(run);

  await appendLedger(cwd, run);
  writeRuxProgress(`recorded manual run ${run.id} status=${run.status} reason=${run.status_reason}`);
  return run;
}

async function recordSessionBaseline({ task, options }) {
  if (!task || !options.runner) {
    throw new Error(`Usage: ${CLI_NAME} record --start "<task>" --runner claude|codex|gemini [--cwd PATH] [--note "TEXT"]`);
  }

  if (options.check !== undefined || options["write-scope"] !== undefined || options.verdict !== undefined) {
    throw new Error("record --start captures a baseline only; run checks, verdicts, and write-scope validation on the later record.");
  }

  const cwd = resolveCwd(options);
  const runner = normalizeManualRunner(String(options.runner));
  const metadata = metadataFromOptions(options);
  const note = normalizeOptionalString(options.note);
  const createdAt = new Date();
  const statusMap = gitStatusMap(cwd);
  const repo = gitSnapshot(cwd, statusMap);
  const dirtyFiles = [...statusMap.keys()].sort();
  const taskKind = taskKindMetadata(task, options, dirtyFiles);
  maybeWarnUnspecifiedTaskKind(options);
  const event = {
    schema_version: SCHEMA_VERSION,
    type: "session_baseline",
    id: `baseline-${createRunId(createdAt)}`,
    source: "manual",
    confidence: "high",
    task,
    task_kind: taskKind.task_kind,
    task_kind_source: taskKind.task_kind_source,
    task_kind_suggestion: taskKind.task_kind_suggestion,
    runner,
    model: metadata.model ?? null,
    effort: metadata.effort ?? null,
    cwd,
    created_at: createdAt.toISOString(),
    repo,
    dirty_files: dirtyFiles,
    dirty_status: Object.fromEntries([...statusMap.entries()].sort((left, right) => left[0].localeCompare(right[0]))),
    dirty_fingerprints: fingerprintStatusMap(cwd, statusMap),
    cost_hint: metadata.cost_hint ?? null,
    replay: recordBaselineReplayMetadata(buildRecordStartCommand({
      task,
      runner,
      options,
      model: metadata.model,
      effort: metadata.effort
    })),
    notes: [
      "Record baseline. The next manual record diffs against this snapshot unless a newer open baseline exists.",
      ...(note ? [note] : [])
    ]
  };

  await appendLedger(cwd, event);
  writeRuxProgress(`recorded manual baseline ${event.id} dirty_files=${dirtyFiles.length}`);
  emitResult(options, summarizeSessionBaseline(event));
}

async function captureRunAttempt({
  runner,
  roster,
  task,
  cwd,
  options,
  checkCommand,
  parentId = null,
  role = null,
  purpose = "task_run",
  failOnChangedFiles = false,
  skipDirtyGuard = false,
  notes = [],
  metadata = {},
  policy = defaultPolicy(),
  attempt = null,
  replay = null
}) {
  const startedAt = new Date();
  const beforeStatus = gitStatusMap(cwd);
  const beforeFingerprints = fingerprintStatusMap(cwd, beforeStatus);
  if (!skipDirtyGuard) {
    assertProviderWorktreeReady({
      cwd,
      runners: [runner],
      options,
      statusMap: beforeStatus,
      context: `${CLI_NAME} run --runner ${runner}`
    });
  }
  const beforeRepo = gitSnapshot(cwd, beforeStatus);
  const transcript = await executeRunner({ runner, task, cwd, options, role, purpose, policy });
  const observedMetadata = transcript.observed_metadata ?? transcript.adapter?.observed_metadata ?? {};
  const runMetadata = mergeObservedMetadata(metadata, observedMetadata);
  const providerAfterStatus = gitStatusMap(cwd);
  const providerAfterFingerprints = fingerprintStatusMap(cwd, providerAfterStatus);
  const providerAfterRepo = gitSnapshot(cwd, providerAfterStatus);
  const changedFiles = gitChangedFilesBetween(beforeStatus, providerAfterStatus, cwd, beforeFingerprints, providerAfterFingerprints);
  const taskKind = taskKindMetadata(task, options, changedFiles);
  maybeWarnUnspecifiedTaskKind(options);
  const check = checkCommand ? { source: "run_check", ...runCheckWithProgress(checkCommand, cwd) } : null;
  const afterStatus = check ? gitStatusMap(cwd) : providerAfterStatus;
  const afterFingerprints = check ? fingerprintStatusMap(cwd, afterStatus) : providerAfterFingerprints;
  const afterRepo = check ? gitSnapshot(cwd, afterStatus) : providerAfterRepo;
  if (check) {
    check.repo = {
      before: providerAfterRepo,
      after: afterRepo
    };
    check.changed_files = gitChangedFilesBetween(providerAfterStatus, afterStatus, cwd, providerAfterFingerprints, afterFingerprints);
  }
  const writeScope = evaluateWriteScope(options, changedFiles);
  const endedAt = new Date();
  let outputSignal = classifyProviderOutputSignal({ runner, purpose, role, task, transcript, changedFiles, check });
  const executionMode = runner === "fake" ? "internal" : providerExecutionMode(options, { role, purpose });
  let status = transcript.status;
  let statusReason = classifyRunStatus({ transcript, check: null, failOnChangedFiles: false, changedFiles: [] });
  const runNotes = [...notes];
  const providerChangedFilesInPlanMode = executionMode === "plan" && purpose === "task_run" && runner !== "fake" && changedFiles.length > 0;
  if (failOnChangedFiles && changedFiles.length > 0) {
    status = "failed";
    statusReason = "provider_smoke_changed_files";
    runNotes.push("Provider smoke failed because files changed during the run.");
  } else if (writeScope.violations.length > 0) {
    outputSignal = {
      kind: "write_scope_violation",
      status: "failed",
      reason: "write_scope_violation",
      note: `Provider changed files outside --write-scope: ${writeScope.violations.join(", ")}.`
    };
    status = "failed";
    statusReason = "write_scope_violation";
    runNotes.push(outputSignal.note);
  } else if (providerChangedFilesInPlanMode) {
    outputSignal = {
      kind: "plan_changed_files",
      status: "failed",
      reason: "provider_plan_changed_files",
      note: "Provider was invoked in plan mode but changed files. Rux recorded the run as failed because the adapter violated the requested safety mode."
    };
    status = "failed";
    statusReason = "provider_plan_changed_files";
    runNotes.push(outputSignal.note);
  } else if (check && check.exit_code !== 0) {
    status = "failed";
    statusReason = "check_failed";
  } else if (outputSignal.status === "blocked") {
    status = "blocked";
    statusReason = outputSignal.reason;
    runNotes.push(outputSignal.note);
  }
  const id = createRunId(startedAt);
  const runAttempt = attempt ? { ...attempt, root_run_id: attempt.root_run_id ?? id } : null;
  const transcriptPath = await writeTranscript(cwd, id, transcript.text);

  const run = {
    schema_version: SCHEMA_VERSION,
    type: "run",
    id,
    purpose,
    source: "live",
    confidence: "high",
    task,
    task_kind: taskKind.task_kind,
    task_kind_source: taskKind.task_kind_source,
    task_kind_suggestion: taskKind.task_kind_suggestion,
    runner,
    model: runMetadata.model ?? null,
    effort: runMetadata.effort ?? null,
    roster,
    parent_id: parentId,
    role,
    cwd,
    status,
    status_reason: statusReason,
    provider_mode: executionMode,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: endedAt.getTime() - startedAt.getTime(),
    repo: {
      before: beforeRepo,
      after: afterRepo,
      after_provider: check ? providerAfterRepo : null
    },
    transcript_path: relative(cwd, transcriptPath),
    changed_files: changedFiles,
    write_scope: writeScope.declared ? {
      allowed: writeScope.allowed,
      violations: writeScope.violations
    } : null,
    checks: check ? [check] : [],
    cost_hint: runMetadata.cost_hint ?? null,
    output_signal: outputSignal,
    adapter: buildAdapterRecord(transcript.adapter, metadata, observedMetadata),
    attempt: runAttempt,
    replay,
    notes: runNotes
  };
  stampVacuousChecks(run);

  await appendLedger(cwd, run);
  writeRuxProgress(`recorded run ${run.id} status=${run.status} reason=${run.status_reason ?? "unknown"}`);
  return run;
}

async function executeRoster({ roster, task, cwd, options, runnerByRole, metadata, purpose = "task_run", policy = defaultPolicy() }) {
  const parentStartedAt = new Date();
  const parentBeforeStatus = gitStatusMap(cwd);
  assertProviderWorktreeReady({
    cwd,
    runners: Object.values(runnerByRole),
    options,
    statusMap: parentBeforeStatus,
    context: `${CLI_NAME} run --roster ${roster}`
  });
  const parentBeforeRepo = gitSnapshot(cwd, parentBeforeStatus);
  const parentId = createRunId(parentStartedAt);
  const parentReplayCommand = buildRunCommand({
    task,
    runner: runnerByRole.primary,
    roster,
    options,
    model: metadata.model,
    effort: metadata.effort
  });
  const children = [];

  if (roster === "pair") {
    children.push(await captureRunAttempt({
      runner: runnerByRole.implementer,
      roster,
      task: roleTask(task, "implementer"),
      cwd,
      options,
      checkCommand: options.check ? String(options.check) : null,
      parentId,
      role: "implementer",
      purpose,
      skipDirtyGuard: true,
      metadata,
      policy,
      replay: childReplayMetadata(parentId, parentReplayCommand)
    }));
    children.push(await captureRunAttempt({
      runner: runnerByRole.reviewer,
      roster,
      task: roleTask(task, "reviewer"),
      cwd,
      options,
      checkCommand: null,
      parentId,
      role: "reviewer",
      purpose,
      skipDirtyGuard: true,
      metadata,
      policy,
      replay: childReplayMetadata(parentId, parentReplayCommand)
    }));
  } else if (roster === "repair") {
    const attempt = await captureRunAttempt({
      runner: runnerByRole.implementer,
      roster,
      task: roleTask(task, "attempt"),
      cwd,
      options,
      checkCommand: options.check ? String(options.check) : null,
      parentId,
      role: "attempt",
      purpose,
      skipDirtyGuard: true,
      metadata,
      policy,
      replay: childReplayMetadata(parentId, parentReplayCommand)
    });
    children.push(attempt);

    if (attempt.status === "failed") {
      children.push(await captureRunAttempt({
        runner: runnerByRole.repairer,
        roster,
        task: roleTask(task, "repairer"),
        cwd,
        options,
        checkCommand: options.check ? String(options.check) : null,
        parentId,
        role: "repairer",
        purpose,
        skipDirtyGuard: true,
        metadata,
        policy,
        replay: childReplayMetadata(parentId, parentReplayCommand)
      }));
    }
  } else if (roster === "plan-code-review") {
    children.push(await captureRunAttempt({
      runner: runnerByRole.planner,
      roster,
      task: roleTask(task, "planner"),
      cwd,
      options,
      checkCommand: null,
      parentId,
      role: "planner",
      purpose,
      skipDirtyGuard: true,
      metadata,
      policy,
      replay: childReplayMetadata(parentId, parentReplayCommand)
    }));
    children.push(await captureRunAttempt({
      runner: runnerByRole.coder,
      roster,
      task: roleTask(task, "coder"),
      cwd,
      options,
      checkCommand: options.check ? String(options.check) : null,
      parentId,
      role: "coder",
      purpose,
      skipDirtyGuard: true,
      metadata,
      policy,
      replay: childReplayMetadata(parentId, parentReplayCommand)
    }));
    children.push(await captureRunAttempt({
      runner: runnerByRole.reviewer,
      roster,
      task: roleTask(task, "reviewer"),
      cwd,
      options,
      checkCommand: null,
      parentId,
      role: "reviewer",
      purpose,
      skipDirtyGuard: true,
      metadata,
      policy,
      replay: childReplayMetadata(parentId, parentReplayCommand)
    }));
  } else {
    throw new Error(`Unsupported roster: ${roster}`);
  }

  const parentAfterStatus = gitStatusMap(cwd);
  const parentAfterRepo = gitSnapshot(cwd, parentAfterStatus);
  const parentEndedAt = new Date();
  const parentStatus = aggregateRosterStatus(roster, children);
  const parentChangedFiles = unique(children.flatMap((child) => child.changed_files));
  const taskKind = taskKindMetadata(task, options, parentChangedFiles);
  maybeWarnUnspecifiedTaskKind(options);
  const transcriptPath = await writeTranscript(cwd, parentId, formatRosterTranscript({
    roster,
    task,
    cwd,
    startedAt: parentStartedAt,
    endedAt: parentEndedAt,
    status: parentStatus,
    children
  }));

  const run = {
    schema_version: SCHEMA_VERSION,
    type: "run",
    id: parentId,
    purpose: purpose === "probe" ? "probe" : "roster_run",
    source: "live",
    confidence: "high",
    task,
    task_kind: taskKind.task_kind,
    task_kind_source: taskKind.task_kind_source,
    task_kind_suggestion: taskKind.task_kind_suggestion,
    runner: runnerByRole.primary,
    model: metadata.model ?? null,
    effort: metadata.effort ?? null,
    roster,
    parent_id: null,
    role: "roster",
    cwd,
    status: parentStatus,
    status_reason: classifyRosterStatus(children),
    provider_mode: "internal",
    started_at: parentStartedAt.toISOString(),
    ended_at: parentEndedAt.toISOString(),
    duration_ms: parentEndedAt.getTime() - parentStartedAt.getTime(),
    repo: {
      before: parentBeforeRepo,
      after: parentAfterRepo
    },
    transcript_path: relative(cwd, transcriptPath),
    changed_files: parentChangedFiles,
    checks: children.flatMap((child) => child.checks),
    cost_hint: metadata.cost_hint ?? null,
    adapter: {
      runner: runnerByRole.primary,
      command: null,
      argv: [],
      exit_code: null,
      timed_out: false,
      stdout_bytes: null,
      stderr_bytes: null,
      stderr_signal: null,
      error: null,
      metadata_sources: metadataSources(metadata),
      notes: ["Roster parent. See child runs for adapter invocations."]
    },
    replay: recordedReplayMetadata(parentReplayCommand, {
      runner: runnerByRole.primary,
      humanReviewRequired: true,
      reason: "Recorded from the original roster run command."
    }),
    child_run_ids: children.map((child) => child.id),
    notes: rosterNotes(roster, children)
  };

  await appendLedger(cwd, run);
  writeRuxProgress(`recorded roster ${run.id} status=${run.status} reason=${run.status_reason ?? "unknown"}`);
  return run;
}

async function executeRunner({ runner, task, cwd, options, role, purpose, policy = defaultPolicy() }) {
  if (runner === "fake") {
    return {
      status: "ok",
      stdout: "",
      stderr: "",
      adapter: buildAdapterInvocation({
        runner: "fake",
        command: "(built-in)",
        args: [],
        exitCode: 0,
        timedOut: false,
        stdout: "",
        stderr: "",
        error: null
      }),
      text: [
        `runner: fake`,
        `cwd: ${cwd}`,
        `task: ${task}`,
        "",
        "This is a fake run. It records the ledger path without changing files."
      ].join("\n")
    };
  }

  if (runner === "claude") {
    return executeClaudeRunner({ task, cwd, options, role, purpose, policy });
  }

  if (runner === "codex") {
    return executeCodexRunner({ task, cwd, options, role, purpose, policy });
  }

  if (runner === "gemini") {
    return executeGeminiRunner({ task, cwd, options, role, purpose, policy });
  }

  throw new Error(`${runner} runner is detected but not implemented yet. Run "rux runners" to see supported local runners.`);
}

function runProviderProcess({ command, args, cwd, timeoutMs, providerMode, stream = false, tokenGovernor = defaultTokenGovernorPolicy() }) {
  const startedAt = new Date();
  const maxBufferBytes = 20 * 1024 * 1024;
  const maxRenderedChars = tokenGovernor?.mode === "off"
    ? null
    : positiveIntegerOrDefault(tokenGovernor?.max_tool_output_chars, defaultTokenGovernorPolicy().max_tool_output_chars);
  let stdout = "";
  let stderr = "";
  let renderBuffer = "";
  let renderedChars = 0;
  let renderTruncated = false;
  let timedOut = false;
  let spawnError = null;
  let settled = false;
  let killedForBuffer = false;

  writeRuxProgress(`starting ${command} mode=${providerMode ?? "unknown"} timeout=${formatDuration(timeoutMs)}`);

  return new Promise((resolveProcess) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const progressTimer = setInterval(() => {
      const dirty = gitDoctor(cwd).dirty_entries;
      const dirtySuffix = Number.isInteger(dirty) ? ` dirty=${dirty}` : "";
      writeRuxProgress(`${command} still running elapsed=${formatDuration(Date.now() - startedAt.getTime())}${dirtySuffix}`);
    }, 30 * 1000);
    progressTimer.unref?.();

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(progressTimer);
      if (stream && renderBuffer.trim()) {
        renderStreamLine(command, renderBuffer);
        renderBuffer = "";
      }
      const endedAt = new Date();
      writeRuxProgress(`${command} finished exit=${exitCode ?? "unknown"} timed_out=${timedOut} elapsed=${formatDuration(endedAt.getTime() - startedAt.getTime())}`);
      resolveProcess({
        startedAt,
        endedAt,
        exitCode,
        timedOut,
        stdout,
        stderr,
        output_policy: {
          mode: tokenGovernor?.mode ?? "advisory",
          max_tool_output_chars: maxRenderedChars,
          rendered_chars: renderedChars,
          rendering_truncated: renderTruncated,
          full_output_captured: true
        },
        error: spawnError
          ? `${spawnError.name}: ${spawnError.message}`
          : killedForBuffer
            ? "Error: provider output exceeded 20 MiB buffer"
            : null
      });
    };

    const appendOutput = (streamName, chunk) => {
      const text = chunk.toString("utf8");
      if (streamName === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }

      if (stream && streamName === "stdout") {
        // Stream-json emits newline-delimited JSON events. Render each complete
        // line as a concise human-readable progress line instead of dumping raw JSON.
        renderBuffer += text;
        let newlineIndex;
        while ((newlineIndex = renderBuffer.indexOf("\n")) >= 0) {
          const line = renderBuffer.slice(0, newlineIndex);
          renderBuffer = renderBuffer.slice(newlineIndex + 1);
          renderStreamLine(command, line);
        }
      } else {
        writeProviderOutput(text);
      }

      if (byteLength(stdout) + byteLength(stderr) > maxBufferBytes && !killedForBuffer) {
        killedForBuffer = true;
        child.kill("SIGTERM");
      }
    };

    child.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => appendOutput("stderr", chunk));
    child.on("error", (error) => {
      spawnError = error;
      finish(null);
    });
    child.on("close", (code) => {
      finish(typeof code === "number" ? code : null);
    });

    function writeProviderOutput(text) {
      if (!text) return;
      if (!maxRenderedChars) {
        process.stderr.write(text);
        renderedChars += text.length;
        return;
      }
      if (renderedChars >= maxRenderedChars) {
        writeTruncationNotice();
        return;
      }
      const remaining = maxRenderedChars - renderedChars;
      const visible = text.length > remaining ? text.slice(0, remaining) : text;
      process.stderr.write(visible);
      renderedChars += visible.length;
      if (visible.length < text.length) {
        writeTruncationNotice();
      }
    }

    function writeTruncationNotice() {
      if (renderTruncated) return;
      renderTruncated = true;
      writeRuxProgress(`provider output rendering capped at ${maxRenderedChars} chars by token_governor; full output remains in the transcript`);
    }
  });
}

function renderStreamLine(command, line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    writeRuxProgress(`${command} > ${truncateStreamText(trimmed)}`);
    return;
  }
  const rendered = renderClaudeStreamEvent(event);
  if (rendered) {
    writeRuxProgress(`${command} ${rendered}`);
  }
}

function renderClaudeStreamEvent(event) {
  if (!event || typeof event !== "object") return null;
  const type = String(event.type ?? "");
  if (type === "system") {
    const subtype = event.subtype ? String(event.subtype) : "init";
    return `session ${subtype}${event.model ? ` model=${event.model}` : ""}`;
  }
  if (type === "assistant") {
    const content = event.message?.content;
    const parts = [];
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
          parts.push(`> ${truncateStreamText(block.text)}`);
        } else if (block?.type === "tool_use" && block.name) {
          parts.push(`tool:${block.name}`);
        }
      }
    }
    return parts.length ? parts.join(" ") : null;
  }
  if (type === "result") {
    const bits = ["done"];
    if (typeof event.duration_ms === "number") bits.push(`elapsed=${formatDuration(event.duration_ms)}`);
    if (event.total_cost_usd !== undefined && event.total_cost_usd !== null) {
      bits.push(`cost=$${event.total_cost_usd}`);
    }
    return bits.join(" ");
  }
  return null;
}

function truncateStreamText(value) {
  const collapsed = String(value).replace(/\s+/g, " ").trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}...` : collapsed;
}

function providerExecutionMode(options, { role, purpose } = {}) {
  if (purpose === "provider_smoke" || role === "reviewer" || role === "planner") {
    return "plan";
  }

  const raw = options["provider-mode"] ?? options.mode ?? "plan";
  if (raw === true) {
    throw new Error("--provider-mode requires plan or write");
  }

  const mode = String(raw).trim();
  if (mode !== "plan" && mode !== "write") {
    throw new Error("--provider-mode must be plan or write");
  }

  return mode;
}

async function executeClaudeRunner({ task, cwd, options, role, purpose, policy = defaultPolicy() }) {
  const timeoutMs = Number(options["timeout-ms"] ?? 10 * 60 * 1000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }

  const providerMode = providerExecutionMode(options, { role, purpose });
  const permissionMode = providerMode === "write" ? "acceptEdits" : "plan";
  const stream = options.stream === true;
  const args = stream
    ? [
        "--permission-mode",
        permissionMode,
        "--verbose",
        "--output-format",
        "stream-json",
        "-p",
        task
      ]
    : [
        "--permission-mode",
        permissionMode,
        "--output-format",
        "json",
        "-p",
        task
      ];

  const result = await runProviderProcess({ command: "claude", args, cwd, timeoutMs, providerMode, stream, tokenGovernor: policy.token_governor });
  const timedOut = result.timedOut;
  const exitCode = result.exitCode;
  const status = timedOut ? "timeout" : exitCode === 0 ? "ok" : "failed";
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const error = result.error ?? "";
  const output = stream ? parseClaudeStreamOutput(stdout) : parseClaudeOutput(stdout);

  return {
    status,
    stdout: output.assistant_text || stdout,
    stderr,
    observed_metadata: output.observed_metadata,
    adapter: buildAdapterInvocation({
      runner: "claude",
      command: "claude",
      args,
      exitCode,
      timedOut,
      stdout,
      stderr,
      error,
      output,
      outputPolicy: result.output_policy
    }),
    text: [
      `runner: claude`,
      `cwd: ${cwd}`,
      `command: claude ${args.map(shellQuote).join(" ")}`,
      `started_at: ${result.startedAt.toISOString()}`,
      `ended_at: ${result.endedAt.toISOString()}`,
      `exit_code: ${exitCode ?? ""}`,
      `status: ${status}`,
      "",
      "## assistant text",
      (output.assistant_text || "").trimEnd(),
      "",
      "## parsed output",
      JSON.stringify(output.extract, null, 2),
      "",
      "## stdout",
      stdout.trimEnd(),
      "",
      "## stderr",
      stderr.trimEnd(),
      "",
      error ? `## error\n${error}` : ""
    ].join("\n")
  };
}

async function executeCodexRunner({ task, cwd, options, role, purpose, policy = defaultPolicy() }) {
  const timeoutMs = Number(options["timeout-ms"] ?? 10 * 60 * 1000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }

  const providerMode = providerExecutionMode(options, { role, purpose });
  const sandboxMode = providerMode === "write" ? "workspace-write" : "read-only";
  const args = [
    "exec",
    "--sandbox",
    sandboxMode,
    "--json",
    "--color",
    "never",
    "-C",
    cwd,
    task
  ];

  const result = await runProviderProcess({ command: "codex", args, cwd, timeoutMs, providerMode, tokenGovernor: policy.token_governor });
  const timedOut = result.timedOut;
  const exitCode = result.exitCode;
  const status = timedOut ? "timeout" : exitCode === 0 ? "ok" : "failed";
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const error = result.error ?? "";
  const output = parseCodexOutput(stdout);

  return {
    status,
    stdout: output.assistant_text || stdout,
    stderr,
    observed_metadata: output.observed_metadata,
    adapter: buildAdapterInvocation({
      runner: "codex",
      command: "codex",
      args,
      exitCode,
      timedOut,
      stdout,
      stderr,
      error,
      output,
      outputPolicy: result.output_policy
    }),
    text: [
      `runner: codex`,
      `cwd: ${cwd}`,
      `command: codex ${args.map(shellQuote).join(" ")}`,
      `started_at: ${result.startedAt.toISOString()}`,
      `ended_at: ${result.endedAt.toISOString()}`,
      `exit_code: ${exitCode ?? ""}`,
      `status: ${status}`,
      "",
      "## assistant text",
      (output.assistant_text || "").trimEnd(),
      "",
      "## parsed output",
      JSON.stringify(output.extract, null, 2),
      "",
      "## stdout",
      stdout.trimEnd(),
      "",
      "## stderr",
      stderr.trimEnd(),
      "",
      error ? `## error\n${error}` : ""
    ].join("\n")
  };
}

async function executeGeminiRunner({ task, cwd, options, role, purpose, policy = defaultPolicy() }) {
  const timeoutMs = Number(options["timeout-ms"] ?? 10 * 60 * 1000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }

  const providerMode = providerExecutionMode(options, { role, purpose });
  const approvalMode = providerMode === "write" ? "auto_edit" : "plan";
  const args = [
    "--approval-mode",
    approvalMode,
    "--output-format",
    "json",
    "--skip-trust",
    "-p",
    task
  ];

  const result = await runProviderProcess({ command: "gemini", args, cwd, timeoutMs, providerMode, tokenGovernor: policy.token_governor });
  const timedOut = result.timedOut;
  const exitCode = result.exitCode;
  const status = timedOut ? "timeout" : exitCode === 0 ? "ok" : "failed";
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const error = result.error ?? "";
  const output = parseGeminiOutput(stdout);

  return {
    status,
    stdout: output.assistant_text || stdout,
    stderr,
    observed_metadata: output.observed_metadata,
    adapter: buildAdapterInvocation({
      runner: "gemini",
      command: "gemini",
      args,
      exitCode,
      timedOut,
      stdout,
      stderr,
      error,
      output,
      outputPolicy: result.output_policy
    }),
    text: [
      `runner: gemini`,
      `cwd: ${cwd}`,
      `command: gemini ${args.map(shellQuote).join(" ")}`,
      `started_at: ${result.startedAt.toISOString()}`,
      `ended_at: ${result.endedAt.toISOString()}`,
      `exit_code: ${exitCode ?? ""}`,
      `status: ${status}`,
      "",
      "## assistant text",
      (output.assistant_text || "").trimEnd(),
      "",
      "## parsed output",
      JSON.stringify(output.extract, null, 2),
      "",
      "## stdout",
      stdout.trimEnd(),
      "",
      "## stderr",
      stderr.trimEnd(),
      "",
      error ? `## error\n${error}` : ""
    ].join("\n")
  };
}

function classifyProviderOutputSignal({ runner, purpose, role, task, transcript, changedFiles, check }) {
  const emptySignal = {
    kind: "none",
    status: null,
    reason: null,
    note: null
  };

  if (runner === "fake" || purpose !== "task_run" || transcript.status !== "ok") {
    return emptySignal;
  }

  if (check && check.exit_code !== 0) {
    return emptySignal;
  }

  const output = `${transcript.stdout ?? ""}\n${transcript.stderr ?? ""}`;
  if (providerAskedForInput(output)) {
    return {
      kind: "needs_input",
      status: "blocked",
      reason: "provider_needs_input",
      note: "Provider output asked for confirmation or more input. Rux recorded the run but did not treat it as completed."
    };
  }

  const roleNeedsFiles = ["runner", "implementer", "attempt", "coder"].includes(role ?? "runner");
  if (roleNeedsFiles && changedFiles.length === 0 && isChangeLikeTask(task) && providerLooksPlanOnly(output)) {
    return {
      kind: "plan_only",
      status: "blocked",
      reason: "provider_plan_only",
      note: "Provider output looked like a plan/proposal for a change task and no files changed. Rux recorded the run but did not treat it as completed."
    };
  }

  return emptySignal;
}

function providerAskedForInput(output) {
  return /\b(do you (agree|approve|confirm|want)|does this .* align|would you like me to|should i proceed|let me know( if (you|you'd) (like|want)| and i will)|please confirm|awaiting (your )?(approval|confirmation)|needs approval|requires approval|if so, i will|if you approve|once you confirm|reply with)\b/i.test(output);
}

function providerLooksPlanOnly(output) {
  return /\b(plan|proposal|strategy|approach|recommendation|i will|i would|next steps|implementation plan)\b/i.test(output);
}

function isChangeLikeTask(task) {
  return /\b(add|adjust|align|build|change|clean up|cleanup|create|delete|edit|fix|implement|make|migrate|modify|refactor|remove|rename|repair|replace|standardize|update|wire|write)\b/i.test(task);
}

function classifyRunStatus({ transcript, check, failOnChangedFiles, changedFiles }) {
  if (failOnChangedFiles && changedFiles.length > 0) return "provider_smoke_changed_files";
  if (check && check.exit_code !== 0) return "check_failed";
  if (transcript.status === "timeout") return "provider_timeout";
  if (transcript.status === "failed") return "provider_failed";
  if (transcript.status === "ok") return "completed";
  return "unknown";
}

function classifyRosterStatus(children) {
  if (children.some((child) => child.status_reason === "check_failed")) return "child_check_failed";
  if (children.some((child) => child.status_reason === "write_scope_violation")) return "child_write_scope_violation";
  if (children.some((child) => child.status_reason === "provider_plan_changed_files")) return "child_provider_plan_changed_files";
  if (children.some((child) => child.status_reason === "provider_timeout")) return "child_provider_timeout";
  if (children.some((child) => child.status_reason === "provider_failed")) return "child_provider_failed";
  if (children.some((child) => child.status_reason === "provider_needs_input")) return "child_provider_needs_input";
  if (children.some((child) => child.status_reason === "provider_plan_only")) return "child_provider_plan_only";
  if (children.some((child) => child.status === "blocked")) return "child_blocked";
  if (children.some((child) => child.status !== "ok")) return "child_failed";
  return "completed";
}

function importedStatusReason(status) {
  if (status === "ok") return "imported_reported_ok";
  if (status === "failed") return "imported_reported_failed";
  return "imported_unverified";
}

function buildAdapterInvocation({ runner, command, args, exitCode, timedOut, stdout, stderr, error, output = null, outputPolicy = null }) {
  return {
    runner,
    command,
    argv: Array.isArray(args) ? [command, ...args].filter(Boolean) : command ? [command] : [],
    exit_code: exitCode,
    timed_out: Boolean(timedOut),
    stdout_bytes: byteLength(stdout),
    stderr_bytes: byteLength(stderr),
    output_policy: outputPolicy,
    parsed_output: output?.extract ?? null,
    observed_metadata: output?.observed_metadata ?? {},
    stderr_signal: classifyAdapterStderr({ exitCode, timedOut, stderr, error }),
    error: error || null
  };
}

function buildAdapterRecord(adapter, metadata, observedMetadata = {}) {
  return {
    ...(adapter ?? {
      runner: null,
      command: null,
      argv: [],
      exit_code: null,
      timed_out: false,
      stdout_bytes: null,
      stderr_bytes: null,
      stderr_signal: null,
      error: null
    }),
    metadata_sources: metadataSources(metadata, observedMetadata)
  };
}

function buildManualAdapterRecord(runner, metadata) {
  return {
    runner,
    command: null,
    argv: [],
    exit_code: null,
    timed_out: false,
    stdout_bytes: null,
    stderr_bytes: null,
    stderr_signal: {
      level: "none",
      reason: "Rux did not launch a provider adapter for this manual/current-session record."
    },
    error: null,
    notes: [
      "Manual/current-session record. Adapter invocation was not observed by Rux."
    ],
    metadata_sources: metadataSources(metadata)
  };
}

function classifyAdapterStderr({ exitCode, timedOut, stderr, stderrBytes, error }) {
  const parsedBytes = Number(stderrBytes);
  const bytes = Number.isFinite(parsedBytes) ? parsedBytes : byteLength(stderr);
  if (error) {
    return {
      level: "error",
      reason: "Adapter reported an execution error."
    };
  }
  if (timedOut) {
    return {
      level: "error",
      reason: "Adapter timed out; stderr may contain failure details."
    };
  }
  if (exitCode !== null && exitCode !== undefined && exitCode !== 0) {
    return {
      level: "error",
      reason: "Adapter exited non-zero; stderr may contain failure details."
    };
  }
  if (bytes > 0) {
    return {
      level: "diagnostic",
      reason: "Adapter wrote to stderr while exiting successfully; treat as diagnostic output unless provider-specific parsing says otherwise."
    };
  }
  return {
    level: "none",
    reason: "Adapter produced no stderr output."
  };
}

function adapterStderrSignal(adapter) {
  if (!adapter) return null;
  if (adapter.stderr_signal) return adapter.stderr_signal;
  return classifyAdapterStderr({
    exitCode: adapter.exit_code,
    timedOut: adapter.timed_out,
    stderrBytes: adapter.stderr_bytes,
    error: adapter.error
  });
}

function metadataSources(metadata, observedMetadata = {}) {
  return {
    model: metadata.model ? "user_option" : observedMetadata.model ? "observed" : "not_observed",
    effort: metadata.effort ? "user_option" : observedMetadata.effort ? "observed" : "not_observed",
    cost_hint: metadata.cost_hint ? "user_option" : observedMetadata.cost_hint ? "observed" : "not_observed"
  };
}

function parseClaudeOutput(stdout) {
  return parseJsonProviderOutput(stdout, "claude-json");
}

function parseClaudeStreamOutput(stdout) {
  const format = "claude-stream-json";
  const lines = String(stdout ?? "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return textFallbackExtract(stdout, format, "empty structured output");
  }

  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      return textFallbackExtract(stdout, format, `unparseable JSONL line: ${line.slice(0, 80)}`);
    }
  }

  // The terminal `result` event carries the full assistant text; prefer it over
  // re-joining the incremental assistant chunks to avoid duplicated content.
  const resultEvent = events.find(
    (event) => event && event.type === "result" && typeof event.result === "string" && event.result.trim()
  );
  const assistantText = resultEvent
    ? resultEvent.result.trim()
    : unique(events.flatMap(extractAssistantTexts)).join("\n\n").trim();
  const observedMetadata = extractObservedMetadata(events);
  return {
    assistant_text: assistantText,
    observed_metadata: observedMetadata,
    extract: {
      format,
      parsed: true,
      event_count: events.length,
      event_types: unique(events.map((event) => String(event?.type ?? event?.event ?? "unknown"))),
      assistant_text: trimOutput(assistantText),
      metadata: observedMetadata
    }
  };
}

function parseGeminiOutput(stdout) {
  return parseJsonProviderOutput(stdout, "gemini-json");
}

function parseCodexOutput(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/).filter((line) => line.trim());
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      return textFallbackExtract(stdout, "codex-jsonl", `unparseable JSONL line: ${line.slice(0, 80)}`);
    }
  }

  if (events.length === 0) {
    return textFallbackExtract(stdout, "codex-jsonl", "empty structured output");
  }

  const assistantText = unique(events.flatMap(extractAssistantTexts)).join("\n\n").trim();
  const observedMetadata = extractObservedMetadata(events);
  return {
    assistant_text: assistantText,
    observed_metadata: observedMetadata,
    extract: {
      format: "codex-jsonl",
      parsed: true,
      event_count: events.length,
      event_types: unique(events.map((event) => String(event.type ?? event.event ?? "unknown"))),
      assistant_text: trimOutput(assistantText),
      metadata: observedMetadata
    }
  };
}

function parseJsonProviderOutput(stdout, format) {
  const raw = String(stdout ?? "").trim();
  if (!raw) {
    return textFallbackExtract(stdout, format, "empty structured output");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return textFallbackExtract(stdout, format, "unparseable JSON output");
  }

  const values = Array.isArray(parsed) ? parsed : [parsed];
  const assistantText = unique(values.flatMap(extractAssistantTexts)).join("\n\n").trim();
  const observedMetadata = extractObservedMetadata(values);
  return {
    assistant_text: assistantText,
    observed_metadata: observedMetadata,
    extract: {
      format,
      parsed: true,
      event_count: values.length,
      assistant_text: trimOutput(assistantText),
      metadata: observedMetadata
    }
  };
}

function textFallbackExtract(stdout, format, reason) {
  return {
    assistant_text: String(stdout ?? "").trim(),
    observed_metadata: {},
    extract: {
      format,
      parsed: false,
      fallback: "raw_text",
      reason,
      assistant_text: trimOutput(String(stdout ?? "").trim()),
      metadata: {}
    }
  };
}

function extractAssistantTexts(value) {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(extractAssistantTexts);
  if (typeof value !== "object") return [];

  const direct = [];
  for (const key of ["result", "response", "text", "message", "content", "output", "final", "summary"]) {
    if (value[key] !== undefined) {
      direct.push(...extractTextValue(value[key]));
    }
  }
  for (const key of ["messages", "items", "events", "outputs", "choices"]) {
    if (Array.isArray(value[key])) {
      direct.push(...value[key].flatMap(extractAssistantTexts));
    }
  }
  // Codex `exec --json` wraps assistant output in a singular `item` object
  // (e.g. {type:"item.completed", item:{type:"agent_message", text:"..."}}).
  if (value.item && typeof value.item === "object" && isMessageItem(value.item)) {
    direct.push(...extractTextValue(value.item));
  }
  if (value.delta !== undefined && looksAssistantEvent(value)) {
    direct.push(...extractTextValue(value.delta));
  }
  return direct.filter((text) => text.trim());
}

function extractTextValue(value) {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(extractTextValue);
  if (typeof value !== "object") return [];
  if (typeof value.text === "string") return [value.text];
  if (typeof value.content === "string") return [value.content];
  if (Array.isArray(value.content)) return value.content.flatMap(extractTextValue);
  if (typeof value.message === "string") return [value.message];
  if (value.message) return extractTextValue(value.message);
  return [];
}

function isMessageItem(item) {
  const type = String(item.type ?? item.role ?? item.kind ?? "").toLowerCase();
  return /\b(agent_message|assistant|message|response|output_text|completion)\b/.test(type);
}

function looksAssistantEvent(value) {
  const marker = String(value.type ?? value.event ?? value.role ?? value.kind ?? "").toLowerCase();
  return /\b(assistant|message|response|completion|result|output)\b/.test(marker);
}

function extractObservedMetadata(values) {
  const flat = Array.isArray(values) ? values : [values];
  // Installed provider CLIs do not expose the active model as a plain `model`
  // field. Claude (`--output-format json`) and Gemini (`--output-format json`)
  // both report it as a KEY inside a usage map (`modelUsage` / `stats.models`),
  // so the direct key search misses it and we fall back to the usage map.
  const model =
    firstMetadataValue(flat, ["model", "model_name", "modelName"]) ??
    modelFromUsageMaps(flat);
  const effort = firstMetadataValue(flat, ["effort", "reasoning_effort", "reasoningEffort"]);
  const cost = firstMetadataValue(flat, ["total_cost_usd", "cost_usd", "costUsd", "totalCostUsd"]);
  return {
    model: model ? cleanModelId(String(model)) : null,
    effort: effort ? String(effort) : null,
    cost_hint: normalizeObservedCost(cost)
  };
}

// Property names whose value is a map of model id -> per-model usage stats.
const MODEL_USAGE_MAP_KEYS = ["modelUsage", "models"];

function modelFromUsageMaps(values) {
  for (const value of values) {
    const map = findModelUsageMap(value);
    if (map) {
      const primary = pickPrimaryModel(map);
      if (primary) return primary;
    }
  }
  return null;
}

function findModelUsageMap(value, seen = new Set()) {
  if (value === null || value === undefined || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  for (const key of MODEL_USAGE_MAP_KEYS) {
    if (isModelUsageMap(value[key])) return value[key];
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findModelUsageMap(child, seen);
      if (found) return found;
    }
  }
  return null;
}

function isModelUsageMap(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const entries = Object.entries(candidate);
  if (entries.length === 0) return false;
  // Every value must be a per-model stats object, and at least one key must
  // look like a model id (guards against generic maps named "models").
  return (
    entries.every(([, stats]) => stats && typeof stats === "object" && !Array.isArray(stats)) &&
    entries.some(([key]) => looksLikeModelId(key))
  );
}

function looksLikeModelId(key) {
  if (typeof key !== "string" || !key.trim()) return false;
  if (/^(claude|gemini|gpt|o\d|codex|llama|mistral|deepseek|qwen|grok|gemma|sonnet|opus|haiku)/i.test(key)) {
    return true;
  }
  // Generic versioned id: contains a letter, a hyphen, and a digit (e.g. "foo-3.1-pro").
  return /[a-z]/i.test(key) && key.includes("-") && /\d/.test(key);
}

function pickPrimaryModel(map) {
  const entries = Object.entries(map).filter(([key]) => looksLikeModelId(key));
  if (entries.length === 0) return null;
  // Score every entry on a single dimension so we never compare dollars
  // against token counts: prefer cost when any entry carries a positive cost,
  // otherwise fall back to token totals for all entries.
  const useCost = entries.some(([, stats]) => modelEntryCost(stats) > 0);
  const scoreOf = (stats) => (useCost ? modelEntryCost(stats) : sumTokenUsage(stats));
  let best = null;
  let bestScore = -Infinity;
  for (const [key, stats] of entries) {
    const value = scoreOf(stats);
    if (best === null || value > bestScore) {
      best = key;
      bestScore = value;
    }
  }
  return best ? cleanModelId(best) : null;
}

function modelEntryCost(stats) {
  if (!stats || typeof stats !== "object") return 0;
  const cost = Number(stats.costUSD ?? stats.cost_usd ?? stats.totalCostUsd ?? stats.costUsd);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

function sumTokenUsage(stats) {
  const tokens = stats.tokens && typeof stats.tokens === "object" ? stats.tokens : stats;
  const total = Number(tokens.total ?? tokens.totalTokens);
  if (Number.isFinite(total) && total > 0) return total;
  const input = Number(tokens.input ?? tokens.inputTokens ?? tokens.prompt ?? 0);
  const output = Number(tokens.output ?? tokens.outputTokens ?? tokens.candidates ?? 0);
  return (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0);
}

function cleanModelId(id) {
  // Strip a trailing context-window tag such as the "[1m]" in
  // "claude-opus-4-8[1m]" so the recorded id matches the canonical model name.
  return String(id).replace(/\s*\[[^\]]*\]\s*$/, "").trim();
}

function firstMetadataValue(values, keys) {
  for (const value of values) {
    const found = findMetadataValue(value, keys);
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return null;
}

function findMetadataValue(value, keys, seen = new Set()) {
  if (value === null || value === undefined || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
      return value[key];
    }
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findMetadataValue(child, keys, seen);
      if (found !== undefined && found !== null && found !== "") return found;
    }
  }
  return null;
}

function normalizeObservedCost(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return {
    amount,
    currency: "USD",
    source: "observed"
  };
}

function byteLength(value) {
  return Buffer.byteLength(value ?? "", "utf8");
}

async function listRuns(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const runs = topLevelRuns(runsWithAppendedChecks(events));
  const verdicts = events.filter((event) => event.type === "verdict");
  const verdictByRun = new Map(verdicts.map((event) => [event.run_id, event.verdict]));
  const marks = lifecycleMarksByRun(events);

  const rows = runs.map((run) => {
    const verdict = verdictByRun.get(run.id) ?? "-";
    const mark = latestLifecycleMark(marks.get(run.id) ?? [])?.mark ?? "-";
    const source = `${run.source ?? "live"}:${run.confidence ?? "unknown"}`;
    const classification = readClassification(run);
    const statusText = classification.changed ? `${run.status}->${classification.status}` : run.status;
    return {
      id: run.id,
      status: statusText,
      runner: run.runner,
      source,
      verdict,
      mark,
      task: formatListTask(run.task)
    };
  });

  if (options.json === true) {
    emitResult(options, rows, formatListRunsHuman);
    return;
  }
  console.log(formatListRunsHuman(rows));
}

function formatListTask(task) {
  const singleLine = String(task ?? "").replace(/\s+/g, " ").trim();
  if (singleLine.length <= 96) return singleLine;
  return `${singleLine.slice(0, 93)}...`;
}

function formatListRunsHuman(rows) {
  return rows.map((run) => `${run.id}  ${run.status.padEnd(12)}  ${run.runner.padEnd(7)}  ${run.source.padEnd(13)}  verdict=${run.verdict}  mark=${run.mark}  ${run.task}`).join("\n");
}

async function importRun(args) {
  const { options } = parseOptions(args);
  const from = options.from ? resolve(String(options.from)) : null;
  if (!from) {
    throw new Error(`Missing import source. Example: ${CLI_NAME} import --from ./old-session.txt --runner claude`);
  }

  const sourceStat = await stat(from).catch(() => null);
  if (!sourceStat || !sourceStat.isFile()) {
    throw new Error(`Import source must be a file: ${from}`);
  }

  const cwd = resolveCwd(options);
  await ensureStore(cwd);

  const importedText = await readFile(from, "utf8");
  const runner = normalizeImportedRunner(options.runner ? String(options.runner) : inferRunnerFromImport(from, importedText));
  const metadata = metadataFromOptions(options);
  const task = options.task ? String(options.task).trim() : `Imported session: ${basename(from)}`;
  if (!task) {
    throw new Error("--task cannot be empty");
  }

  const startedAt = parseDateOption(options["started-at"], new Date());
  const endedAt = parseDateOption(options["ended-at"], startedAt);
  const status = normalizeImportedStatus(options.status ? String(options.status) : "unknown");
  const id = createRunId(startedAt);
  const transcriptPath = await writeTranscript(cwd, id, formatImportedTranscript({
    from,
    runner,
    task,
    status,
    startedAt,
    endedAt,
    importedText
  }));

  const run = {
    schema_version: SCHEMA_VERSION,
    type: "run",
    id,
    purpose: "imported_session",
    source: "imported",
    confidence: "low",
    task,
    task_kind: classifyTask(task),
    runner,
    model: metadata.model ?? null,
    effort: metadata.effort ?? null,
    roster: "solo",
    cwd,
    status,
    status_reason: importedStatusReason(status),
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    repo: {
      imported_at: gitSnapshot(cwd)
    },
    transcript_path: relative(cwd, transcriptPath),
    changed_files: [],
    checks: [],
    cost_hint: metadata.cost_hint ?? null,
    adapter: {
      runner,
      command: null,
      argv: [],
      exit_code: null,
      timed_out: false,
      stdout_bytes: byteLength(importedText),
      stderr_bytes: null,
      stderr_signal: null,
      error: null,
      metadata_sources: metadataSources(metadata),
      notes: ["Imported session. Original provider invocation was not observed."]
    },
    imported_from: from,
    replay: unavailableReplayMetadata("Imported sessions are continuity records; Rux did not execute the original provider command."),
    notes: [
      "Imported from a user-selected local file. Treat as low confidence until a check or human verdict is attached."
    ]
  };

  await appendLedger(cwd, run);
  emitResult(options, summarizeRun(run));
}

async function showRun(args) {
  const { positionals, options } = parseOptions(args);
  const id = positionals[0];
  if (!id) {
    throw new Error("Missing run id. Example: rux show 20260607-abc123");
  }

  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const runs = runsWithAppendedChecks(events);
  const run = runs.find((event) => event.type === "run" && event.id === id);
  if (!run) {
    throw new Error(`Run not found: ${id}`);
  }

  const verdicts = events.filter((event) => event.type === "verdict" && event.run_id === id);
  const marks = events.filter((event) => event.type === "mark" && event.run_id === id);
  const reports = reportsForRun(events, id);
  const children = runs.filter((event) => event.type === "run" && event.parent_id === id);
  const latestVerdicts = latestVerdictByRun(events);
  const lifecycleMarks = lifecycleMarksByRun(events);
  const reportsByRun = reportsByRunId(events);
  emitResult(options, {
    run: withReplayMetadata(run),
    children: children.map(withReplayMetadata),
    verdicts,
    marks,
    reports,
    evaluation: evaluateRunRecord(run, children, latestVerdicts, lifecycleMarks, reportsByRun)
  });
}

async function planRun(args) {
  const { positionals, options } = parseOptions(args);
  const task = positionals.join(" ").trim();
  if (!task) {
    throw new Error(`Missing task. Example: ${CLI_NAME} plan "fix the failing auth test"`);
  }

  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const policy = await loadPolicy(cwd);
  const recommendation = buildRecommendation(task, events, {
    queryTaskKind: resolveQueryTaskKind(task, options)
  });
  const metadata = metadataFromOptions(options);
  const taskKind = recommendation.task_kind;
  const explicitRunner = options.runner ? normalizeRunner(String(options.runner)) : null;
  const runnerChoice = choosePlanRunner({ explicitRunner, recommendation, events, policy: policy.policy });
  const selectedRunner = runnerChoice.runner;
  const selectedModel = metadata.model ?? recommendation.recommendation.model ?? null;
  const selectedEffort = metadata.effort ?? recommendation.recommendation.effort ?? null;
  const explicitRoster = options.roster ? normalizeRoster(String(options.roster)) : null;
  const rosterChoice = choosePlanRoster({
    explicitRoster,
    suggestedRoster: recommendation.recommendation.roster,
    suggestedConfidence: recommendation.recommendation.confidence,
    task,
    taskKind,
    hasCheck: Boolean(options.check),
    policy: policy.policy
  });
  const runnerByRole = resolveRosterRunners(rosterChoice.roster, selectedRunner, options);
  const rolePlan = buildRolePlan(rosterChoice.roster, runnerByRole, Boolean(options.check));
  const availability = runnerAvailability(Object.values(runnerByRole));
  const runCommand = buildRunCommand({
    task,
    runner: selectedRunner,
    roster: rosterChoice.roster,
    options,
    model: selectedModel,
    effort: selectedEffort
  });
  const repo = gitDoctor(cwd);

  emitResult(options, {
    product: PRODUCT_NAME,
    dry_run: true,
    would_execute: false,
    task,
    task_kind: taskKind,
    cwd,
    recommendation: {
      runner: selectedRunner,
      model: selectedModel,
      effort: selectedEffort,
      roster: rosterChoice.roster,
      agents: rolePlan.length,
      execution: "sequential",
      confidence: recommendation.recommendation.confidence,
      maturity: recommendation.recommendation.maturity,
      reason: rosterChoice.reason,
      one_agent_not_enough: rosterChoice.one_agent_not_enough,
      roles: rolePlan
    },
    runner_by_role: runnerByRole,
    runner_source: runnerChoice.source,
    policy: {
      source: policy.source,
      preferred_runner_order: policy.policy.preferred_runner_order,
      default_roster: policy.policy.default_roster,
      parallel_provider_cli_runs: policy.policy.parallel_provider_cli_runs,
      token_governor: policy.policy.token_governor
    },
    evidence: recommendation.evidence,
    repo: {
      inside_work_tree: repo.inside_work_tree,
      dirty_entries: repo.dirty_entries
    },
    availability,
    command: runCommand,
    next_actions: [
      `Run: ${runCommand}`,
      "Attach a human verdict after review so future planning can use the result."
    ],
    safety_notes: [
      "plan is dry-run only; it does not call providers and does not write the ledger.",
      "Generated rosters are sequential. Parallel provider fanout is not enabled in v0."
    ]
  }, formatPlanHuman);
}

async function evaluateRunCommand(args) {
  const { positionals, options } = parseOptions(args);
  const id = positionals[0];
  if (!id) {
    throw new Error("Missing run id. Example: rux eval 20260607-abc123");
  }

  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const runs = runsWithAppendedChecks(events);
  const run = runs.find((event) => event.type === "run" && event.id === id);
  if (!run) {
    throw new Error(`Run not found: ${id}`);
  }

  const children = runs.filter((event) => event.type === "run" && event.parent_id === id);
  const latestVerdicts = latestVerdictByRun(events);
  const lifecycleMarks = lifecycleMarksByRun(events);
  const reportsByRun = reportsByRunId(events);
  emitResult(options, evaluateRunRecord(run, children, latestVerdicts, lifecycleMarks, reportsByRun));
}

async function outcomeRun(args) {
  const { positionals, options } = parseOptions(args);
  const id = positionals[0];
  if (!id) {
    throw new Error("Missing run id. Example: rux outcome 20260607-abc123");
  }

  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const runs = runsWithAppendedChecks(events);
  const run = runs.find((event) => event.type === "run" && event.id === id);
  if (!run) {
    throw new Error(`Run not found: ${id}`);
  }

  const children = runs.filter((event) => event.type === "run" && event.parent_id === id);
  const latestVerdicts = latestVerdictByRun(events);
  const lifecycleMarks = lifecycleMarksByRun(events);
  const classification = readClassification(run);
  emitResult(options, {
    run_id: run.id,
    task_kind: run.task_kind ?? classifyTask(run.task ?? ""),
    runner: run.runner,
    model: run.model ?? null,
    effort: run.effort ?? null,
    roster: run.roster,
    purpose: run.purpose ?? "task_run",
    provider_mode: run.provider_mode ?? inferProviderMode(run),
    task_kind_source: run.task_kind_source ?? "legacy_inferred",
    task_kind_suggestion: run.task_kind_suggestion ?? null,
    status: run.status,
    status_reason: run.status_reason ?? null,
    effective_status: classification.status,
    effective_status_reason: classification.status_reason,
    classifier_version: classification.classifier_version,
    marks: (lifecycleMarks.get(run.id) ?? []).map(formatLifecycleMark),
    outcome: summarizeOutcome(run, children, latestVerdicts.get(run.id) ?? null, lifecycleMarks.get(run.id) ?? [])
  });
}

async function suggestRun(args) {
  const { positionals, options } = parseOptions(args);
  const task = positionals.join(" ").trim();
  if (!task) {
    throw new Error(`Missing task. Example: ${CLI_NAME} suggest "fix the failing auth test"`);
  }

  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  emitResult(options, buildRecommendation(task, events, {
    includeProbes: options["include-probes"] === true,
    inSession: resolveInSessionRunner(options["in-session"]),
    queryTaskKind: resolveQueryTaskKind(task, options)
  }), formatSuggestHuman);
}

// --in-session names the runner already doing the work, so suggest can weigh
// handoff cost: the asking agent already holds the local context. Reject "fake"
// (a smoke stand-in, never a real session) and unknown runners with a clear hint.
function resolveInSessionRunner(value) {
  if (value === undefined) return null;
  if (value === true || typeof value !== "string" || value.trim() === "") {
    throw new Error(`--in-session needs a runner name, e.g. ${CLI_NAME} suggest "<task>" --in-session codex`);
  }
  const runner = value.trim();
  if (!runnerDefinitions[runner] || runner === "fake") {
    const real = Object.keys(runnerDefinitions).filter((name) => name !== "fake").join("|");
    throw new Error(`Unknown --in-session runner "${runner}". Use one of: ${real}.`);
  }
  return runner;
}

function buildRecommendation(task, events, { includeProbes = false, inSession = null, queryTaskKind = null } = {}) {
  const runs = topLevelRuns(runsWithAppendedChecks(events));
  const verdicts = latestVerdictByRun(events);
  const marks = lifecycleMarksByRun(events);
  // Query-side kind: an explicit --task-kind is authoritative; otherwise stay
  // unspecified rather than trusting a naive keyword guess (which once labeled
  // code tasks "docs" and matched them against the wrong evidence).
  const resolvedQueryKind = queryTaskKind ?? resolveQueryTaskKind(task);
  const taskKind = resolvedQueryKind.task_kind;
  const taskKindSpecified = resolvedQueryKind.task_kind_source === "user";
  const eligibility = partitionRecommendationEvidence(runs, verdicts, marks, { includeProbes });
  // Evidence-side kind: match on each run's effective/corrected kind, so a run
  // mislabeled "docs" at write time but corrected from its changed files matches
  // its true kind. With no specified query kind, match nothing and use all history.
  const sameKind = taskKindSpecified
    ? eligibility.eligible.filter((run) => effectiveTaskKind(run) === taskKind)
    : [];
  const evidencePool = sameKind.length > 0 ? sameKind : eligibility.eligible;
  const groups = summarizeEvidenceGroups(evidencePool, verdicts, marks);
  const best = groups.find((group) => group.score > 0) ?? null;

  const suggestion = best
    ? {
        runner: best.runner,
        roster: best.roster,
        model: best.model,
      effort: best.effort,
      confidence: best.total >= 3 ? "local_evidence" : "thin_local_evidence",
      maturity: evidenceMaturityForGroup(best),
      reason: !taskKindSpecified
        ? "Task kind unspecified; using all eligible local history. Pass --task-kind to match by kind."
        : sameKind.length > 0
          ? `Best labeled live history for ${taskKind} tasks.`
          : `No labeled live history for ${taskKind} tasks yet; using all eligible local history.`,
        evidence_runs: best.evidence_runs,
        stats: {
          labeled_runs: best.total,
          manual_runs: best.manual,
          adapter_observed_runs: best.adapter_observed,
          accepted_runs: best.accepted,
          partial_runs: best.partial,
          rejected_runs: best.rejected,
          score: best.score
        }
      }
    : {
        runner: null,
        roster: "solo",
        confidence: "cold_start",
        maturity: evidenceMaturityForGroup(null),
        reason: eligibility.eligible.length > 0
          ? "Eligible local runs exist, but none have a positive outcome yet."
          : "No recommendation-eligible live runs yet. Run a task, capture checks, then attach a human verdict.",
        evidence_runs: [],
        stats: {
          labeled_runs: 0,
          manual_runs: 0,
          adapter_observed_runs: 0,
          accepted_runs: 0,
          partial_runs: 0,
          rejected_runs: 0,
          score: null
        }
      };

  const recommendation = inSession
    ? applyInSessionDecision({ suggestion, best, inSession })
    : suggestion;

  return {
    task,
    task_kind: taskKind,
    task_kind_source: resolvedQueryKind.task_kind_source,
    recommendation,
    evidence: {
      eligible_runs: eligibility.eligible.length,
      same_kind_runs: sameKind.length,
      include_probes: includeProbes,
      ignored_runs: eligibility.ignored.length,
      ignored_reasons: countBy(eligibility.ignored.map((item) => item.reason)),
      maturity: summarizeEvidenceMaturity(eligibility.eligible, verdicts, marks)
    }
  };
}

// Real routing decisions are made mid-session by an agent that already holds the
// local context, so a handoff to another runner has real cost. Treat "continue
// in the current session" as a first-class candidate and only recommend a handoff
// when the evidence advantage clearly outweighs that cost. The bar is deliberately
// set at directional maturity (3+ labeled runs): one or two labeled runs are never
// a clear enough advantage to justify dropping the context the asker already has.
function applyInSessionDecision({ suggestion, best, inSession }) {
  const evidenceRunner = best ? best.runner : null;
  const maturity = suggestion.maturity ?? evidenceMaturityForGroup(null);
  const level = maturity.level ?? "none";
  const runs = maturity.runs ?? 0;

  // Evidence already favors the in-session runner: staying matches the evidence
  // AND skips the handoff. Strictly dominant, regardless of maturity.
  const evidenceMatchesSession = Boolean(best) && evidenceRunner === inSession;
  // A different runner only wins if its advantage clears the directional bar.
  const advantageClearsBar =
    Boolean(best) && evidenceRunner !== inSession && maturityRank(level) >= maturityRank("directional");

  if (advantageClearsBar) {
    return {
      ...suggestion,
      in_session: inSession,
      continue_in_session: false,
      handoff: "recommended",
      evidence_runner: evidenceRunner,
      reason: `${suggestion.reason} Evidence for ${evidenceRunner} is ${level} (${runs} run(s)) — a clear enough advantage to justify handing off from the current ${inSession} session.`
    };
  }

  const reason = evidenceMatchesSession
    ? `Local evidence also favors ${inSession} (maturity ${level}, ${runs} run(s)); staying in the current ${inSession} session matches the evidence and avoids handoff cost.`
    : evidenceRunner
      ? `Evidence for ${evidenceRunner} is only ${level} (${runs} run(s)) — not a clear enough advantage to justify a handoff. Continue in the current ${inSession} session; you already have the local context.`
      : `No eligible local evidence yet — staying in the current ${inSession} session avoids handoff risk while you capture a checked run.`;

  return {
    runner: inSession,
    roster: "solo",
    model: null,
    effort: null,
    in_session: inSession,
    continue_in_session: true,
    handoff: "skip",
    confidence: "in_session_no_handoff",
    // Honest: this maturity describes evidence_runner's history, not confidence in
    // staying. evidence_runner attributes it so the surface never overclaims.
    maturity,
    evidence_runner: evidenceRunner,
    reason,
    evidence_runs: suggestion.evidence_runs ?? [],
    stats: suggestion.stats
  };
}

function choosePlanRunner({ explicitRunner, recommendation, events, policy }) {
  if (explicitRunner) {
    return { runner: explicitRunner, source: "explicit" };
  }
  if (recommendation.recommendation.runner) {
    return { runner: recommendation.recommendation.runner, source: "evidence" };
  }

  const smokeRunner = preferredProviderSmokeRunner(events, policy.preferred_runner_order);
  if (smokeRunner) {
    return { runner: smokeRunner, source: "provider_smoke_fallback" };
  }

  for (const runner of policy.preferred_runner_order) {
    if (commandExists(runnerDefinitions[runner].command)) {
      return { runner, source: "availability_fallback" };
    }
  }

  return { runner: "fake", source: "availability_fallback" };
}

function preferredProviderSmokeRunner(events, preferredRunnerOrder) {
  const candidates = events
    .filter((event) => (
      event.type === "run" &&
      event.purpose === "provider_smoke" &&
      event.source === "live" &&
      event.confidence === "high" &&
      event.status === "ok" &&
      event.runner !== "fake" &&
      Array.isArray(event.changed_files) &&
      event.changed_files.length === 0
    ))
    .sort((left, right) => String(right.ended_at ?? "").localeCompare(String(left.ended_at ?? "")));

  for (const runner of preferredRunnerOrder) {
    if (candidates.some((candidate) => candidate.runner === runner)) {
      return runner;
    }
  }

  return candidates[0]?.runner ?? null;
}

function statusNextActions({ topRuns, liveProviderTaskRuns, eligibility, release, proposals }) {
  const actions = [];
  if (topRuns.length === 0) {
    actions.push("Run the first live provider task with a check command.");
  }
  if (topRuns.length > 0 && liveProviderTaskRuns.length === 0) {
    actions.push("Run the first routing-eligible real provider task with --check, then review it with a verdict.");
  }
  if (eligibility.eligible.length === 0 && liveProviderTaskRuns.length > 0) {
    actions.push(`Attach a human verdict or run ${CLI_NAME} check on a live provider task run.`);
  }
  if (proposals.length === 0 && topRuns.length > 0) {
    actions.push(`Run ${CLI_NAME} propose to generate the first evidence-cited improvement note.`);
  }
  for (const action of release.next_actions) {
    if (!actions.includes(action)) actions.push(action);
  }
  return actions.slice(0, 6);
}

async function summarizeRecordedRun({ cwd, run, verdict = null }) {
  const summary = summarizeRun(run);
  if (verdict) {
    summary.verdict_recorded = formatVerdictEvent(verdict);
  }
  const events = await readLedger(cwd);
  const runs = topLevelRuns(runsWithAppendedChecks(events));
  const marks = lifecycleMarksByRun(events);
  const nudges = markNudgesForRun(run, runs, marks);
  if (nudges.length > 0) {
    summary.mark_nudges = nudges;
  }
  return summary;
}

function markNudgesForStatus(topRuns, marks) {
  const nudges = [];
  const seen = new Set();
  for (const run of newestRuns(topRuns).slice(0, 10)) {
    for (const nudge of markNudgesForRun(run, topRuns, marks)) {
      const key = `${nudge.run_id}:${nudge.current_run_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nudges.push(nudge);
      if (nudges.length >= 5) return nudges;
    }
  }
  return nudges;
}

function markNudgesForRun(run, topRuns, marks) {
  if (!isMarkNudgeRun(run)) return [];
  const changed = changedFilesForMarkNudge(run);
  if (changed.length === 0) return [];
  const changedSet = new Set(changed);
  const currentTime = runTimestamp(run);
  return newestRuns(topRuns)
    .filter((candidate) => candidate.id !== run.id)
    .filter(isMarkNudgeRun)
    .filter((candidate) => runTimestamp(candidate) <= currentTime)
    .filter((candidate) => (marks.get(candidate.id) ?? []).length === 0)
    .map((candidate) => {
      const overlapFiles = changedFilesForMarkNudge(candidate).filter((file) => changedSet.has(file));
      return { candidate, overlapFiles };
    })
    .filter((item) => item.overlapFiles.length > 0)
    .slice(0, 3)
    .map(({ candidate, overlapFiles }) => ({
      run_id: candidate.id,
      current_run_id: run.id,
      overlap_count: overlapFiles.length,
      overlap_files: overlapFiles.slice(0, 10),
      action: `Review overlap with ${candidate.id}; if this run replaced, replayed, or validated that work, run ${CLI_NAME} mark ${candidate.id} reverted|replayed|accepted-downstream --note "..."`
    }));
}

function isMarkNudgeRun(run) {
  return (
    run?.type === "run" &&
    !run.parent_id &&
    !["provider_smoke", "probe"].includes(run.purpose) &&
    (run.source === "live" || run.source === "manual")
  );
}

function changedFilesForMarkNudge(run) {
  return unique((Array.isArray(run.changed_files) ? run.changed_files : [])
    .map((file) => String(file).replace(/\\/g, "/"))
    .filter(Boolean))
    .sort();
}

function isLiveProviderTaskRun(run) {
  return run.source === "live" && run.runner !== "fake" && !["provider_smoke", "probe"].includes(run.purpose);
}

function isManualTaskRun(run) {
  return run.source === "manual" && run.runner !== "fake" && !["provider_smoke", "probe"].includes(run.purpose);
}

function isRecommendationSourceRun(run) {
  return run.source === "live" || run.source === "manual";
}

function buildNextCapture({ events, liveProviderTaskRuns, eligibility, policy, packageJson }) {
  if (eligibility.eligible.length > 0) {
    return {
      needed: false,
      reason: "Recommendation-eligible provider task evidence exists.",
      provider_call_required: false,
      writes_ledger: false,
      human_review_required: false,
      command: null
    };
  }

  const runnerChoice = chooseNextCaptureRunner({ events, policy });
  const checkCommand = packageJson?.scripts?.check ? "npm run check" : "<check command>";
  const command = runnerChoice.runner
    ? buildRunCommand({
        task: "<task>",
        runner: runnerChoice.runner,
        roster: policy.default_roster,
        options: { check: checkCommand }
      })
    : null;

  return {
    needed: true,
    reason: liveProviderTaskRuns.length === 0
      ? "Provider adapters are ready; the missing proof is one routing-eligible real provider task with a check."
      : "Live provider task runs exist, but none have a verdict or captured check evidence yet.",
    runner: runnerChoice.runner,
    runner_source: runnerChoice.source,
    check_command: checkCommand,
    provider_call_required: Boolean(runnerChoice.runner && runnerChoice.runner !== "fake"),
    writes_ledger: Boolean(runnerChoice.runner),
    human_review_required: true,
    note: "Rux status is read-only; this command is a suggested next capture and will call the selected provider CLI if you run it.",
    command,
    after_run: [
      `${CLI_NAME} verdict <run-id> accepted --note "reviewed"`
    ]
  };
}

function chooseNextCaptureRunner({ events, policy }) {
  const smokeRunner = preferredProviderSmokeRunner(events, policy.preferred_runner_order);
  if (smokeRunner) {
    return { runner: smokeRunner, source: "provider_smoke_fallback" };
  }

  for (const runner of policy.preferred_runner_order) {
    if (commandExists(runnerDefinitions[runner].command)) {
      return { runner, source: "availability_fallback" };
    }
  }

  return { runner: null, source: "no_provider_runner_available" };
}

function choosePlanRoster({ explicitRoster, suggestedRoster, suggestedConfidence, task, taskKind, hasCheck, policy }) {
  if (explicitRoster) {
    return {
      roster: explicitRoster,
      reason: `Using explicitly requested ${explicitRoster} roster.`,
      one_agent_not_enough: oneAgentNotEnoughReason(explicitRoster, { taskKind, hasCheck, explicit: true })
    };
  }

  if (hasCheck && suggestedConfidence !== "local_evidence") {
    return {
      roster: "repair",
      reason: "A check command was supplied, so the safest default is one attempt plus one bounded repair if the check fails.",
      one_agent_not_enough: oneAgentNotEnoughReason("repair", { taskKind, hasCheck })
    };
  }

  if (suggestedConfidence === "local_evidence" || suggestedConfidence === "thin_local_evidence") {
    return {
      roster: suggestedRoster,
      reason: `Using ${suggestedConfidence.replaceAll("_", " ")} for the selected roster.`,
      one_agent_not_enough: oneAgentNotEnoughReason(suggestedRoster, { taskKind, hasCheck })
    };
  }

  if (taskKind === "bugfix" || taskKind === "test") {
    const roster = hasCheck ? "repair" : "pair";
    return {
      roster,
      reason: hasCheck
        ? "Bug/test work with a check gets a bounded repair roster."
        : "Bug/test work without a check gets an implementer plus reviewer by default.",
      one_agent_not_enough: oneAgentNotEnoughReason(roster, { taskKind, hasCheck })
    };
  }

  if (taskKind === "feature" && isComplexTask(task)) {
    return {
      roster: "plan-code-review",
      reason: "Feature work that looks broad gets planner, coder, and reviewer roles.",
      one_agent_not_enough: oneAgentNotEnoughReason("plan-code-review", { taskKind, hasCheck })
    };
  }

  if (taskKind === "feature" || taskKind === "refactor") {
    return {
      roster: "pair",
      reason: `${taskKind} work gets an implementer plus reviewer until stronger local evidence exists.`,
      one_agent_not_enough: oneAgentNotEnoughReason("pair", { taskKind, hasCheck })
    };
  }

  return {
    roster: policy.default_roster,
    reason: `Cold-start default from policy: ${policy.default_roster}. Keep the roster small until the ledger has better evidence.`,
    one_agent_not_enough: oneAgentNotEnoughReason(policy.default_roster, { taskKind, hasCheck })
  };
}

function isComplexTask(task) {
  const words = task.trim().split(/\s+/).filter(Boolean).length;
  return words >= 14 || /\b(architecture|orchestrator|workflow|migration|database|auth|billing|release|cross-file|system|integration)\b/i.test(task);
}

function oneAgentNotEnoughReason(roster, { taskKind, hasCheck, explicit = false } = {}) {
  switch (roster) {
    case "solo":
      return null;
    case "pair":
      return taskKind === "bugfix" || taskKind === "test"
        ? "A reviewer is added because there is no captured check yet; one agent would both change and judge the fix."
        : "A reviewer is added because this work can affect design or multiple files; one agent would both implement and judge the change.";
    case "repair":
      return hasCheck
        ? "A repair step is added because the check can verify the first attempt and guide one bounded retry."
        : "A repair roster was selected explicitly; Rux keeps the retry bounded and sequential.";
    case "plan-code-review":
      return explicit
        ? "Separate planner, coder, and reviewer roles were requested, so Rux keeps scoping, implementation, and review distinct."
        : "Separate planner, coder, and reviewer roles are used because the task looks broad enough that one agent would mix scoping, implementation, and review.";
    default:
      return null;
  }
}

function buildRolePlan(roster, runnerByRole, hasCheck) {
  if (roster === "solo") {
    return [{
      role: "runner",
      runner: runnerByRole.implementer ?? runnerByRole.primary,
      purpose: "Do the task directly."
    }];
  }

  if (roster === "pair") {
    return [
      {
        role: "implementer",
        runner: runnerByRole.implementer,
        purpose: hasCheck ? "Implement the change and run the requested check." : "Implement the change."
      },
      {
        role: "reviewer",
        runner: runnerByRole.reviewer,
        purpose: "Review correctness, missing checks, and risks."
      }
    ];
  }

  if (roster === "repair") {
    return [
      {
        role: "attempt",
        runner: runnerByRole.implementer,
        purpose: hasCheck ? "Make the first attempt and run the requested check." : "Make the first attempt."
      },
      {
        role: "repairer",
        runner: runnerByRole.repairer,
        purpose: "Run only if the first attempt fails."
      }
    ];
  }

  return [
    {
      role: "planner",
      runner: runnerByRole.planner,
      purpose: "Scope the work and risks before code changes."
    },
    {
      role: "coder",
      runner: runnerByRole.coder,
      purpose: hasCheck ? "Implement the planned change and run the requested check." : "Implement the planned change."
    },
    {
      role: "reviewer",
      runner: runnerByRole.reviewer,
      purpose: "Review the final state and call out remaining risk."
    }
  ];
}

function runnerAvailability(runners) {
  return unique(runners).map((runner) => {
    const definition = runnerDefinitions[runner];
    return {
      runner,
      command: definition.command ?? "(built-in)",
      available: definition.available === true || commandExists(definition.command)
    };
  });
}

function buildRunCommand({ task, runner, roster, options, model = null, effort = null }) {
  const parts = [
    CLI_NAME,
    "run",
    task,
    "--runner",
    runner,
    "--roster",
    roster,
    "--cwd",
    resolveCwd(options)
  ];

  if (model) {
    parts.push("--model", model);
  }
  if (effort) {
    parts.push("--effort", effort);
  }

  for (const key of ["cost-hint", "check", "provider-mode", "planner-runner", "coder-runner", "implementer-runner", "reviewer-runner", "repair-runner", "timeout-ms", "write-scope"]) {
    const value = options[key];
    if (value !== undefined && value !== true) {
      parts.push(`--${key}`, String(value));
    }
  }
  if (options.purpose !== undefined && options.purpose !== true) {
    parts.push("--purpose", String(options.purpose));
  }
  if (options["task-kind"] !== undefined && options["task-kind"] !== true) {
    parts.push("--task-kind", String(options["task-kind"]));
  }
  if (options.stream === true) {
    parts.push("--stream");
  }
  if (options["allow-dirty"] === true) {
    parts.push("--allow-dirty");
  }

  return parts.map(shellQuote).join(" ");
}

function buildRecordCommand({ task, runner, options, model = null, effort = null }) {
  const parts = [
    CLI_NAME,
    "record",
    task,
    "--runner",
    runner,
    "--cwd",
    resolveCwd(options)
  ];

  if (model) {
    parts.push("--model", model);
  }
  if (effort) {
    parts.push("--effort", effort);
  }

  for (const key of ["cost-hint", "check", "note", "task-kind", "write-scope"]) {
    const value = options[key];
    if (value !== undefined && value !== true) {
      parts.push(`--${key}`, String(value));
    }
  }

  return parts.map(shellQuote).join(" ");
}

function buildRecordStartCommand({ task, runner, options, model = null, effort = null }) {
  const parts = [
    CLI_NAME,
    "record",
    "--start",
    task,
    "--runner",
    runner,
    "--cwd",
    resolveCwd(options)
  ];

  if (model) {
    parts.push("--model", model);
  }
  if (effort) {
    parts.push("--effort", effort);
  }

  for (const key of ["cost-hint", "note", "task-kind"]) {
    const value = options[key];
    if (value !== undefined && value !== true) {
      parts.push(`--${key}`, String(value));
    }
  }

  return parts.map(shellQuote).join(" ");
}

function buildProviderSmokeCommand({ runner, options, model = null, effort = null }) {
  const parts = [
    CLI_NAME,
    "provider-smoke",
    "--runner",
    runner,
    "--cwd",
    resolveCwd(options)
  ];

  if (model) {
    parts.push("--model", model);
  }
  if (effort) {
    parts.push("--effort", effort);
  }
  if (options["timeout-ms"] !== undefined && options["timeout-ms"] !== true) {
    parts.push("--timeout-ms", String(options["timeout-ms"]));
  }
  if (options["allow-dirty"] === true) {
    parts.push("--allow-dirty");
  }

  return parts.map(shellQuote).join(" ");
}

function recordedReplayMetadata(command, { runner, humanReviewRequired, reason }) {
  return {
    available: true,
    source: "recorded",
    command,
    provider_call_required: runner !== "fake",
    writes_ledger: true,
    human_review_required: humanReviewRequired,
    reason
  };
}

function manualReplayMetadata(command) {
  return {
    available: false,
    source: "recorded",
    command,
    provider_call_required: false,
    writes_ledger: true,
    human_review_required: true,
    reason: "This records current-session work after the fact. Re-running it would only duplicate the record, not replay the original agent work."
  };
}

function recordBaselineReplayMetadata(command) {
  return {
    available: true,
    source: "recorded",
    command,
    provider_call_required: false,
    writes_ledger: true,
    human_review_required: false,
    reason: "This records a manual session baseline only; it does not call a provider CLI."
  };
}

function childReplayMetadata(parentId, parentCommand) {
  return {
    available: false,
    source: "recorded",
    command: null,
    parent_run_id: parentId,
    parent_command: parentCommand,
    provider_call_required: true,
    writes_ledger: true,
    human_review_required: true,
    reason: "This is a child run produced by a sequential roster. Replay the parent roster command instead."
  };
}

function unavailableReplayMetadata(reason) {
  return {
    available: false,
    source: "unavailable",
    command: null,
    provider_call_required: false,
    writes_ledger: false,
    human_review_required: true,
    reason
  };
}

function withReplayMetadata(run) {
  const classification = readClassification(run);
  return {
    ...run,
    provider_mode: run.provider_mode ?? inferProviderMode(run),
    task_kind_source: run.task_kind_source ?? "legacy_inferred",
    task_kind_suggestion: run.task_kind_suggestion ?? null,
    effective_status: classification.status,
    effective_status_reason: classification.status_reason,
    classifier_version: classification.classifier_version,
    replay: replayMetadataForRun(run)
  };
}

function inferProviderMode(run) {
  if (run?.provider_mode) return run.provider_mode;
  if (run?.source === "manual" || run?.runner === "fake") return "internal";
  if (run?.purpose === "provider_smoke" || run?.role === "reviewer" || run?.role === "planner") return "plan";
  const argv = Array.isArray(run?.adapter?.argv) ? run.adapter.argv : [];
  if (argv.includes("workspace-write") || argv.includes("acceptEdits") || argv.includes("auto_edit")) return "write";
  if (argv.includes("read-only") || argv.includes("plan")) return "plan";
  return null;
}

function replayMetadataForRun(run) {
  if (run?.replay && typeof run.replay === "object") {
    return run.replay;
  }

  if (!run || run.source === "imported") {
    return unavailableReplayMetadata("Imported sessions are continuity records; Rux did not execute the original provider command.");
  }

  if (run.source === "manual") {
    return manualReplayMetadata(buildRecordCommand({
      task: run.task,
      runner: run.runner,
      options: replayOptionsFromRun(run),
      model: run.model,
      effort: run.effort
    }));
  }

  if (run.parent_id) {
    return {
      available: false,
      source: "derived",
      command: null,
      parent_run_id: run.parent_id,
      provider_call_required: true,
      writes_ledger: true,
      human_review_required: true,
      reason: "This is a child run produced by a sequential roster. Show or export the parent run to replay the roster."
    };
  }

  if (run.purpose === "provider_smoke") {
    return {
      available: true,
      source: "derived",
      command: buildProviderSmokeCommand({
        runner: run.runner,
        options: { cwd: run.cwd },
        model: run.model,
        effort: run.effort
      }),
      provider_call_required: run.runner !== "fake",
      writes_ledger: true,
      human_review_required: false,
      reason: "Derived from run metadata; newer records store this directly."
    };
  }

  if (run.source === "live") {
    const options = replayOptionsFromRun(run);
    return {
      available: true,
      source: "derived",
      command: buildRunCommand({
        task: run.task,
        runner: run.runner,
        roster: run.roster,
        options,
        model: run.model,
        effort: run.effort
      }),
      provider_call_required: run.runner !== "fake",
      writes_ledger: true,
      human_review_required: true,
      reason: "Derived from run metadata; newer records store the original replay command directly."
    };
  }

  return unavailableReplayMetadata("Replay is unavailable for this run source.");
}

function replayOptionsFromRun(run) {
  const options = { cwd: run.cwd };
  const firstCheck = Array.isArray(run.checks)
    ? run.checks.find((check) => check.command && check.source !== "post_run_check")
    : null;
  if (firstCheck) {
    options.check = firstCheck.command;
  }
  if (run.cost_hint?.amount !== undefined) {
    options["cost-hint"] = String(run.cost_hint.amount);
  } else if (run.cost_hint?.raw) {
    options["cost-hint"] = String(run.cost_hint.raw);
  }
  return options;
}

async function rankRuns(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const taskKindFilter = options["task-kind"] ? String(options["task-kind"]) : null;
  const events = await readLedger(cwd);
  const runs = topLevelRuns(runsWithAppendedChecks(events));
  const verdicts = latestVerdictByRun(events);
  const marks = lifecycleMarksByRun(events);
  const includeProbes = options["include-probes"] === true;
  const eligibility = partitionRecommendationEvidence(runs, verdicts, marks, { includeProbes });
  const eligible = taskKindFilter
    ? eligibility.eligible.filter((run) => effectiveTaskKind(run) === taskKindFilter)
    : eligibility.eligible;
  const taskKinds = unique(eligible.map((run) => effectiveTaskKind(run))).sort();
  const rankings = taskKinds.map((taskKind) => ({
    task_kind: taskKind,
    candidates: summarizeEvidenceGroups(
      eligible.filter((run) => effectiveTaskKind(run) === taskKind),
      verdicts,
      marks
    )
  }));

  emitResult(options, {
    generated_at: new Date().toISOString(),
    task_kind: taskKindFilter,
    evidence: {
      eligible_runs: eligible.length,
      include_probes: includeProbes,
      ignored_runs: eligibility.ignored.length,
      ignored_reasons: countBy(eligibility.ignored.map((item) => item.reason)),
      maturity: summarizeEvidenceMaturity(eligible, verdicts, marks)
    },
    rankings,
    notes: eligible.length === 0
      ? ["No recommendation-eligible live runs for this scope yet."]
      : []
  }, formatRankHuman);
}

async function proposeImprovements(args) {
  const { options } = parseOptions(args);
  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const runs = topLevelRuns(runsWithAppendedChecks(events));
  const verdicts = latestVerdictByRun(events);
  const marks = lifecycleMarksByRun(events);
  const release = await buildReleaseCheck(cwd);
  const findings = buildProposalFindings(runs, verdicts, marks, release);
  const createdAt = new Date();
  const id = `proposal-${createRunId(createdAt)}`;
  const proposalPath = await writeProposal(cwd, id, formatProposal({
    id,
    cwd,
    createdAt,
    runs,
    verdicts,
    release,
    findings
  }));
  const citedRunIds = unique(findings.flatMap((finding) => finding.run_ids));

  const event = {
    schema_version: SCHEMA_VERSION,
    type: "proposal",
    id,
    created_at: createdAt.toISOString(),
    proposal_path: relative(cwd, proposalPath),
    cited_run_ids: citedRunIds,
    categories: findings.map((finding) => finding.category)
  };

  await appendLedger(cwd, event);
  emitResult(options, {
    id,
    proposal_path: relative(cwd, proposalPath),
    release: {
      ready: release.ready,
      blockers: release.gates.filter((gate) => !gate.ok).map((gate) => gate.name),
      blocker_summary: release.blocker_summary
    },
    findings: findings.map((finding) => ({
      category: finding.category,
      title: finding.title,
      run_ids: finding.run_ids
    })),
    cited_run_ids: citedRunIds
  });
}

async function recordReport(args) {
  const { positionals, options } = parseOptions(args);
  const summary = positionals.join(" ").trim();
  if (!summary) {
    throw new Error(`Usage: ${CLI_NAME} report "<summary>" [--kind bug|ux|adapter|docs|routing|orchestration|install|idea|success|other] [--run-id ID | --record --runner claude|codex|gemini | --no-run "REASON"] [--command "COMMAND"] [--note "TEXT"]`);
  }

  const cwd = resolveCwd(options);
  const kind = normalizeReportKind(String(options.kind ?? "bug"));
  const runIdOption = normalizeOptionalString(options["run-id"]);
  const noRunReason = normalizeOptionalString(options["no-run"]);
  const wantsRecord = options.record === true;
  if (options["no-run"] === true) {
    throw new Error(`report --no-run requires a reason, for example: ${CLI_NAME} report "${summary}" --kind ${kind} --no-run "external/manual outcome"`);
  }
  const linkCount = [Boolean(runIdOption), wantsRecord, Boolean(noRunReason)].filter(Boolean).length;
  if (linkCount > 1) {
    throw new Error("Use only one report linkage option: --run-id, --record, or --no-run.");
  }
  if (wantsRecord && !options.runner) {
    throw new Error("report --record requires --runner claude, --runner codex, or --runner gemini.");
  }
  if (kind === "success" && linkCount === 0) {
    throw new Error(`report --kind success requires --run-id ID, --record --runner claude|codex|gemini, or --no-run "REASON".`);
  }

  const command = normalizeOptionalString(options.command);
  const note = normalizeOptionalString(options.note);
  const sourceRepo = resolve(String(options["source-repo"] ?? cwd));
  let runId = runIdOption;
  let run = null;
  if (wantsRecord) {
    run = await createManualRun({
      task: summary,
      options,
      extraNotes: ["Created inline by rux report --record."]
    });
    runId = run.id;
  } else if (runId) {
    const events = await readLedger(cwd);
    run = events.find((event) => event.type === "run" && event.id === runId) ?? null;
  } else if (!noRunReason) {
    writeRuxProgress("nudge: this report is unlinked. Use --run-id, --record, or --no-run \"REASON\" when it describes shipped work.");
  }
  if (kind === "success" && runId && !run) {
    throw new Error(`report --kind success requires an existing run. Run not found: ${runId}. Use --no-run "REASON" for externally verified success.`);
  }
  if (kind === "success" && run && readClassification(run).status !== "ok") {
    const classification = readClassification(run);
    throw new Error(`report --kind success requires a successful run. Linked run ${run.id} has effective status ${classification.status}/${classification.status_reason ?? "unknown"}.`);
  }
  const createdAt = new Date();
  const id = `report-${createRunId(createdAt)}`;
  const reportPath = await writeReport(cwd, id, formatReport({
    id,
    kind,
    summary,
    note,
    command,
    runId,
    runFound: runId ? Boolean(run) : null,
    noRunReason,
    sourceRepo,
    cwd,
    createdAt
  }));
  const event = {
    schema_version: SCHEMA_VERSION,
    type: "report",
    id,
    kind,
    summary,
    note: note ?? "",
    command: command ?? "",
    run_id: runId,
    run_found: runId ? Boolean(run) : null,
    no_run_reason: noRunReason ?? "",
    source_repo: sourceRepo,
    cwd,
    created_at: createdAt.toISOString(),
    report_path: relative(cwd, reportPath),
    repo: {
      reported_at: gitSnapshot(cwd)
    }
  };

  await appendLedger(cwd, event);
  emitResult(options, event);
}

async function addCheck(args) {
  const { positionals, options } = parseOptions(args);
  const runId = positionals[0];
  const command = options.command && options.command !== true
    ? String(options.command).trim()
    : positionals.slice(1).join(" ").trim();
  if (!runId || !command) {
    throw new Error(`Usage: ${CLI_NAME} check <run-id> --command "COMMAND" [--note TEXT]`);
  }
  const verdict = normalizeVerdictOption(options.verdict);

  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const run = events.find((event) => event.type === "run" && event.id === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  if (run.purpose === "provider_smoke") {
    throw new Error("Provider-smoke runs prove adapter readiness only; do not attach check results to them.");
  }

  const beforeStatus = gitStatusMap(cwd);
  const beforeFingerprints = fingerprintStatusMap(cwd, beforeStatus);
  const beforeRepo = gitSnapshot(cwd, beforeStatus);
  const check = runCheckWithProgress(command, cwd);
  const afterStatus = gitStatusMap(cwd);
  const afterFingerprints = fingerprintStatusMap(cwd, afterStatus);
  const afterRepo = gitSnapshot(cwd, afterStatus);
  const changedFiles = gitChangedFilesBetween(beforeStatus, afterStatus, cwd, beforeFingerprints, afterFingerprints);
  const event = {
    schema_version: SCHEMA_VERSION,
    type: "check",
    id: randomUUID(),
    run_id: runId,
    source: "post_run_check",
    note: options.note ? String(options.note) : "",
    created_at: new Date().toISOString(),
    repo: {
      before: beforeRepo,
      after: afterRepo
    },
    changed_files: changedFiles,
    ...check
  };
  event.vacuous = isVacuousCheckForRun({
    ...run,
    checks: [...(Array.isArray(run.checks) ? run.checks : []), event]
  }, event);

  await appendLedger(cwd, event);
  let verdictEvent = null;
  if (verdict) {
    verdictEvent = await createVerdictEvent({
      cwd,
      runId,
      verdict,
      note: options.note ? String(options.note) : ""
    });
  }
  emitResult(options, verdictEvent ? { ...event, verdict_recorded: formatVerdictEvent(verdictEvent) } : event);
}

async function addVerdict(args) {
  const { positionals, options } = parseOptions(args);
  const [runId, verdict] = positionals;
  if (!runId || !verdictDefinitions.has(verdict)) {
    throw new Error("Usage: rux verdict <run-id> accepted|rejected|partial|unknown [--note TEXT]");
  }

  const cwd = resolveCwd(options);
  const event = await createVerdictEvent({
    cwd,
    runId,
    verdict,
    note: options.note ? String(options.note) : ""
  });
  emitResult(options, event);
}

async function addLifecycleMark(args) {
  const { positionals, options } = parseOptions(args);
  const [runId, mark] = positionals;
  if (!runId || !lifecycleMarkDefinitions.has(mark)) {
    throw new Error("Usage: rux mark <run-id> reverted|replayed|accepted-downstream [--note TEXT]");
  }

  const cwd = resolveCwd(options);
  const events = await readLedger(cwd);
  const run = events.find((event) => event.type === "run" && event.id === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  if (run.purpose === "provider_smoke") {
    throw new Error("Provider-smoke runs prove adapter readiness only; do not attach lifecycle marks to them.");
  }

  const event = {
    schema_version: SCHEMA_VERSION,
    type: "mark",
    id: randomUUID(),
    run_id: runId,
    mark,
    note: options.note ? String(options.note) : "",
    created_at: new Date().toISOString()
  };

  await appendLedger(cwd, event);
  emitResult(options, event);
}

async function ensureStore(cwd) {
  await mkdir(join(cwd, STORE_DIR, LEDGER_DIR), { recursive: true });
  await mkdir(join(cwd, STORE_DIR, TRANSCRIPT_DIR), { recursive: true });
}

async function appendLedger(cwd, event) {
  await ensureStore(cwd);
  const date = new Date().toISOString().slice(0, 10);
  const path = join(cwd, STORE_DIR, LEDGER_DIR, `${date}.jsonl`);
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

async function readLedger(cwd) {
  const ledgerPath = join(cwd, STORE_DIR, LEDGER_DIR);
  if (!existsSync(ledgerPath)) {
    return [];
  }

  const files = (await readdir(ledgerPath)).filter((file) => file.endsWith(".jsonl")).sort();
  const events = [];
  for (const file of files) {
    const content = await readFile(join(ledgerPath, file), "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line));
    }
  }
  return events;
}

async function writeTranscript(cwd, runId, text) {
  const path = join(cwd, STORE_DIR, TRANSCRIPT_DIR, `${runId}.txt`);
  await writeFile(path, text, "utf8");
  return path;
}

async function writeProposal(cwd, proposalId, text) {
  const path = join(cwd, STORE_DIR, PROPOSAL_DIR, `${proposalId}.md`);
  await mkdir(join(cwd, STORE_DIR, PROPOSAL_DIR), { recursive: true });
  await writeFile(path, text, "utf8");
  return path;
}

async function writeReport(cwd, reportId, text) {
  const path = join(cwd, STORE_DIR, REPORT_DIR, `${reportId}.md`);
  await mkdir(join(cwd, STORE_DIR, REPORT_DIR), { recursive: true });
  await writeFile(path, text, "utf8");
  return path;
}

function createRunId(date) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function commandExists(command) {
  if (!command) return false;
  const result = spawnSync("command", ["-v", command], {
    shell: true,
    stdio: "ignore"
  });
  return result.status === 0;
}

function gitDoctor(cwd) {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8"
  });
  const status = spawnSync("git", ["status", "--short"], {
    cwd,
    encoding: "utf8"
  });

  return {
    available: commandExists("git"),
    inside_work_tree: inside.status === 0 && inside.stdout.trim() === "true",
    dirty_entries: status.status === 0
      ? status.stdout.split("\n").filter((line) => line.trim() && !line.slice(3).startsWith(`${STORE_DIR}/`)).length
      : null
  };
}

function gitSnapshot(cwd, statusMap = gitStatusMap(cwd)) {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8"
  });
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd,
    encoding: "utf8"
  });
  const branch = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8"
  });

  const insideWorkTree = inside.status === 0 && inside.stdout.trim() === "true";
  return {
    available: commandExists("git"),
    inside_work_tree: insideWorkTree,
    branch: insideWorkTree && branch.status === 0 ? branch.stdout.trim() || null : null,
    head: insideWorkTree && head.status === 0 ? head.stdout.trim() : null,
    dirty_entries: statusMap.size,
    dirty_files: [...statusMap.keys()].sort()
  };
}

function releaseGate(name, ok, action, metadata = {}) {
  return {
    name,
    ok: Boolean(ok),
    lifecycle: metadata.lifecycle ?? "release",
    category: metadata.category ?? "general",
    action
  };
}

function summarizeReleaseBlockers(blockers) {
  return {
    total: blockers.length,
    by_lifecycle: countBy(blockers.map((gate) => gate.lifecycle)),
    by_category: countBy(blockers.map((gate) => gate.category)),
    one_time: blockers.filter((gate) => gate.lifecycle === "one_time").map((gate) => gate.name),
    release: blockers.filter((gate) => gate.lifecycle === "release").map((gate) => gate.name),
    permanent: blockers.filter((gate) => gate.lifecycle === "permanent").map((gate) => gate.name)
  };
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readTextIfExists(path) {
  if (!existsSync(path)) return "";
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function hasProviderSmoke(runs, runner) {
  return runs.some((run) => (
    run.purpose === "provider_smoke" &&
    run.source === "live" &&
    run.confidence === "high" &&
    run.runner === runner &&
    run.status === "ok" &&
    Array.isArray(run.changed_files) &&
    run.changed_files.length === 0
  ));
}

function providerSmokeAttempts(runs, runner) {
  return newestRuns(runs.filter((run) => (
    run.purpose === "provider_smoke" &&
    run.source === "live" &&
    run.confidence === "high" &&
    run.runner === runner
  )));
}

function providerSmokeStatus(runs, runner) {
  const attempts = providerSmokeAttempts(runs, runner);
  const passing = attempts.find(isProviderSmokeEvidence) ?? null;
  const latest = attempts[0] ?? null;
  const chain = latest ? providerSmokeAttemptChain(attempts, latest.id) : [];
  return {
    runner,
    ok: Boolean(passing),
    latest_attempt_run_id: latest?.id ?? null,
    latest_attempt_status: latest ? readClassification(latest).status : null,
    latest_attempt_status_reason: latest ? readClassification(latest).status_reason : null,
    passing_run_id: passing?.id ?? null,
    attempt_chain: chain.map((run) => run.id),
    attempt_history: attempts.map((run) => run.id)
  };
}

function providerSmokeAttemptChain(attempts, latestId) {
  const byId = new Map(attempts.map((run) => [run.id, run]));
  const chain = [];
  let current = byId.get(latestId) ?? null;
  while (current) {
    chain.push(current);
    const previousId = current.attempt?.previous_run_id ?? null;
    if (!previousId || chain.some((run) => run.id === previousId)) break;
    current = byId.get(previousId) ?? null;
  }
  return chain;
}

async function hasLocalOnlyLanguage(cwd) {
  const text = await releaseDocText(cwd);
  return /(?:is|as|for|name for)\s+(?:a\s+)?local-only|local-only\s+(?:tool|run ledger|product|project)/i.test(text);
}

async function hasWorkingNameLanguage(cwd) {
  const text = await releaseDocText(cwd);
  return /working name|name is not locked|may change before public release|release name is not locked/i.test(text);
}

async function releaseDocText(cwd) {
  const paths = [
    join(cwd, "README.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, "docs", "STATE.md"),
    join(cwd, "docs", "V0_PLAN.md")
  ];
  const parts = [];
  for (const path of paths) {
    parts.push(await readTextIfExists(path));
  }
  return parts.join("\n");
}

function gitStatusMap(cwd) {
  const result = spawnSync("git", ["status", "--short"], {
    cwd,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return new Map();
  }

  const entries = new Map();
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3).trim();
    for (const expandedFile of expandGitStatusFile(cwd, file, status)) {
      entries.set(expandedFile, status);
    }
  }
  return entries;
}

function expandGitStatusFile(cwd, file, status) {
  const normalized = normalizeGitStatusPath(file.includes(" -> ") ? file.split(" -> ").at(-1) : file);
  if (!normalized || normalized === STORE_DIR || normalized.startsWith(`${STORE_DIR}/`) || normalized === ".git" || normalized.startsWith(".git/")) {
    return [];
  }

  if (status === "??") {
    return expandStatusPath(cwd, normalized);
  }

  return [normalized];
}

function normalizeGitStatusPath(file) {
  return normalizeWriteScopeEntry(file).replace(/\/+$/, "");
}

function expandStatusPath(cwd, file) {
  const fullPath = join(cwd, file);
  try {
    const info = lstatSync(fullPath);
    if (info.isDirectory()) {
      return listFilesRecursive(cwd, file);
    }
  } catch {
    return [file];
  }
  return [file];
}

function listFilesRecursive(cwd, root) {
  const results = [];
  const walk = (relativePath) => {
    const fullPath = join(cwd, relativePath);
    const info = lstatSync(fullPath);
    if (info.isDirectory() && !info.isSymbolicLink()) {
      const entries = readdirSync(fullPath, { withFileTypes: true })
        .filter((entry) => entry.name !== STORE_DIR && entry.name !== ".git")
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        walk(`${relativePath}/${entry.name}`);
      }
      return;
    }
    results.push(normalizeGitStatusPath(relativePath));
  };

  walk(root);
  return results.filter(Boolean).sort();
}

function assertProviderWorktreeReady({ cwd, runners, options, statusMap, context }) {
  const realRunners = unique(runners).filter((runner) => runner !== "fake");
  if (realRunners.length === 0 || options["allow-dirty"] === true || statusMap.size === 0) {
    return;
  }

  const files = [...statusMap.keys()].sort();
  const shownFiles = files.slice(0, 12).join(", ");
  const hiddenCount = files.length - 12;
  const hiddenText = hiddenCount > 0 ? `, and ${hiddenCount} more` : "";
  const runnerText = realRunners.join(", ");
  throw new Error([
    `Refusing to run real provider runner(s) ${runnerText} in a dirty worktree.`,
    `Context: ${context}.`,
    `Repo: ${cwd}.`,
    `Dirty files: ${shownFiles}${hiddenText}.`,
    "Commit, stash, or revert existing changes first, or rerun with --allow-dirty only when those changes are intentionally part of the provider context."
  ].join(" "));
}

function gitChangedFilesBetween(beforeStatus, afterStatus, cwd = null, beforeFingerprints = null, afterFingerprints = null) {
  const files = unique([...beforeStatus.keys(), ...afterStatus.keys()]);
  if (!cwd) {
    return files.filter((file) => beforeStatus.get(file) !== afterStatus.get(file));
  }

  const beforeHashes = beforeFingerprints ?? fingerprintStatusMap(cwd, beforeStatus);
  const afterHashes = afterFingerprints ?? fingerprintStatusMap(cwd, afterStatus);
  return files.filter((file) => (
    beforeStatus.get(file) !== afterStatus.get(file) ||
    beforeHashes[file] !== afterHashes[file]
  ));
}

async function resolveSessionBaseline(cwd) {
  const events = await readLedger(cwd);
  const usedBaselineIds = new Set(events
    .filter((event) => event.type === "run" && event.session_baseline)
    .flatMap((event) => [
      event.session_baseline.id,
      ...(Array.isArray(event.session_baseline.closed_baseline_ids) ? event.session_baseline.closed_baseline_ids : [])
    ])
    .filter(Boolean));
  const openBaselines = events.filter((event) => (
    event.type === "session_baseline" &&
    event.id &&
    !usedBaselineIds.has(event.id)
  ));

  if (openBaselines.length === 0) {
    return {
      baseline: null,
      open_count: 0,
      open_ids: [],
      warning: null
    };
  }

  const baseline = openBaselines.at(-1);
  return {
    baseline,
    open_count: openBaselines.length,
    open_ids: openBaselines.map((event) => event.id),
    warning: openBaselines.length > 1
      ? `warning: multiple open record baselines found; using newest ${baseline.id}.`
      : null
  };
}

function diffStatusAgainstBaseline(cwd, baseline, currentStatus) {
  const baselineStatus = new Map(Object.entries(baseline.dirty_status ?? {}));
  const baselineFingerprints = baseline.dirty_fingerprints ?? {};
  const currentFingerprints = fingerprintStatusMap(
    cwd,
    new Map([...baselineStatus.keys()].map((file) => [file, currentStatus.get(file) ?? ""]))
  );
  const files = unique([...baselineStatus.keys(), ...currentStatus.keys()]);
  const changedFiles = [];
  const contaminatedFiles = [];

  for (const file of files) {
    const baselineState = baselineStatus.get(file);
    const currentState = currentStatus.get(file);
    const baselineFingerprint = baselineFingerprints[file] ?? null;
    const currentFingerprint = currentFingerprints[file] ?? (currentState ? pathFingerprint(cwd, file) : null);
    const changed = baselineState !== currentState || baselineFingerprint !== currentFingerprint;
    if (!changed) continue;
    changedFiles.push(file);
    if (baselineState !== undefined) {
      contaminatedFiles.push(file);
    }
  }

  return {
    changed_files: changedFiles.sort(),
    contaminated_files: contaminatedFiles.sort()
  };
}

function fingerprintStatusMap(cwd, statusMap) {
  return Object.fromEntries([...statusMap.keys()]
    .sort()
    .map((file) => [file, pathFingerprint(cwd, file)]));
}

function pathFingerprint(cwd, file) {
  const fullPath = join(cwd, file);
  try {
    return hashPath(fullPath, file);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "missing";
    }
    return `unreadable:${error?.code ?? "unknown"}`;
  }
}

function hashPath(fullPath, label) {
  const info = lstatSync(fullPath);
  if (info.isSymbolicLink()) {
    return digestParts(["symlink", label, readlinkSync(fullPath)]);
  }
  if (info.isDirectory()) {
    const entries = readdirSync(fullPath, { withFileTypes: true })
      .filter((entry) => entry.name !== STORE_DIR)
      .sort((left, right) => left.name.localeCompare(right.name));
    return digestParts([
      "directory",
      label,
      ...entries.map((entry) => hashPath(join(fullPath, entry.name), `${label}/${entry.name}`))
    ]);
  }
  if (info.isFile()) {
    return digestParts(["file", label, readFileSync(fullPath)]);
  }
  return digestParts(["other", label, String(info.mode), String(info.size)]);
}

function digestParts(parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function evaluateWriteScope(options, changedFiles) {
  const scope = parseWriteScope(options["write-scope"]);
  if (!scope.declared) {
    return {
      declared: false,
      allowed: [],
      violations: []
    };
  }

  const violations = changedFiles
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => !writeScopeAllowsFile(scope.entries, file))
    .sort();
  return {
    declared: true,
    allowed: scope.entries,
    violations
  };
}

function writeScopeAllowsFile(entries, file) {
  return entries.some((entry) => {
    if (entry.endsWith("/")) {
      return file.startsWith(entry);
    }
    return file === entry || file.startsWith(`${entry}/`);
  });
}

function runCheck(command, cwd) {
  const startedAt = new Date();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8"
  });
  const endedAt = new Date();

  return {
    command,
    exit_code: result.status ?? 1,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: endedAt.getTime() - startedAt.getTime(),
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr)
  };
}

function runCheckWithProgress(command, cwd) {
  writeRuxProgress(`running check: ${command}`);
  const result = runCheck(command, cwd);
  const outcome = result.exit_code === 0 ? "passed" : "failed";
  writeRuxProgress(`check ${outcome} exit=${result.exit_code} duration=${formatDuration(result.duration_ms)}`);
  return result;
}

function writeRuxProgress(message) {
  process.stderr.write(`rux: ${message}\n`);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function trimOutput(value) {
  if (!value) return "";
  return value.length > 4000 ? `${value.slice(0, 4000)}\n[truncated]` : value;
}

function summarizeRun(run) {
  const classification = readClassification(run);
  return {
    id: run.id,
    purpose: run.purpose,
    status: run.status,
    status_reason: run.status_reason ?? null,
    effective_status: classification.status,
    effective_status_reason: classification.status_reason,
    classifier_version: classification.classifier_version,
    source: run.source,
    confidence: run.confidence,
    task_kind: run.task_kind,
    task_kind_source: run.task_kind_source ?? "legacy_inferred",
    task_kind_suggestion: run.task_kind_suggestion ?? null,
    runner: run.runner,
    model: run.model ?? null,
    effort: run.effort ?? null,
    roster: run.roster,
    role: run.role,
    provider_mode: run.provider_mode ?? inferProviderMode(run),
    parent_id: run.parent_id,
    child_run_ids: run.child_run_ids ?? [],
    transcript_path: run.transcript_path,
    replay: replayMetadataForRun(run),
    attempt: run.attempt ?? null,
    output_signal: run.output_signal ?? null,
    adapter: run.adapter ?? null,
    repo: run.repo ?? null,
    changed_files: run.changed_files,
    session_baseline: run.session_baseline ?? null,
    contaminated_files: Array.isArray(run.contaminated_files) ? run.contaminated_files : [],
    write_scope: run.write_scope ?? null,
    checks: run.checks.map((check) => ({
      source: check.source ?? "run_check",
      command: check.command,
      exit_code: check.exit_code,
      duration_ms: check.duration_ms ?? null,
      repo: check.repo ?? null,
      changed_files: Array.isArray(check.changed_files) ? check.changed_files : [],
      vacuous: check.vacuous === true || isVacuousCheckForRun(run, check)
    })),
    cost_hint: run.cost_hint ?? null
  };
}

function summarizeSessionBaseline(event) {
  return {
    id: event.id,
    type: event.type,
    source: event.source,
    confidence: event.confidence,
    task_kind: event.task_kind,
    task_kind_source: event.task_kind_source ?? "legacy_inferred",
    task_kind_suggestion: event.task_kind_suggestion ?? null,
    runner: event.runner,
    model: event.model ?? null,
    effort: event.effort ?? null,
    cwd: event.cwd,
    created_at: event.created_at,
    repo: event.repo,
    dirty_files: event.dirty_files,
    replay: event.replay,
    notes: event.notes
  };
}

function unique(values) {
  return [...new Set(values)];
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function topLevelRuns(runs) {
  return runs.filter((run) => !run.parent_id);
}

function newestRuns(runs) {
  return [...runs].sort((a, b) => runTimestamp(b) - runTimestamp(a));
}

function runTimestamp(run) {
  const parsed = Date.parse(run.ended_at ?? run.started_at ?? run.created_at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function runsWithAppendedChecks(events) {
  const checks = checksByRun(events);
  return events
    .filter((event) => event.type === "run")
    .map((run) => {
      const appendedChecks = checks.get(run.id) ?? [];
      if (appendedChecks.length === 0) return run;
      return {
        ...run,
        checks: [...(Array.isArray(run.checks) ? run.checks : []), ...appendedChecks]
      };
    });
}

function checksByRun(events) {
  const checks = new Map();
  for (const event of events) {
    if (event.type !== "check") continue;
    const current = checks.get(event.run_id) ?? [];
    current.push(formatCheckEvent(event));
    checks.set(event.run_id, current);
  }
  return checks;
}

function formatCheckEvent(event) {
  return {
    id: event.id,
    source: event.source ?? "post_run_check",
    command: event.command,
    exit_code: event.exit_code,
    started_at: event.started_at,
    ended_at: event.ended_at,
    duration_ms: event.duration_ms ?? null,
    stdout: event.stdout ?? "",
    stderr: event.stderr ?? "",
    repo: event.repo ?? null,
    changed_files: Array.isArray(event.changed_files) ? event.changed_files : [],
    vacuous: event.vacuous === true,
    note: event.note ?? ""
  };
}

function roleTask(task, role) {
  const instructions = {
    implementer: "Role: implementer. Do the task directly. Keep the change scoped and record any caveats in the final response.",
    reviewer: "Role: reviewer. Review the current repo state and prior attempt. Do not make broad changes. Focus on correctness, missing checks, and risks.",
    attempt: "Role: first attempt. Do the task directly. Keep the change scoped and let checks decide whether repair is needed.",
    repairer: "Role: repairer. Inspect the failed attempt and make the smallest correction needed to pass the requested check.",
    planner: "Role: planner. Produce a concise implementation plan and risks. Do not edit files unless the wrapped runner's normal mode requires it.",
    coder: "Role: coder. Implement the planned task. Keep changes scoped and prepare the work for review."
  };

  return [task, "", instructions[role] ?? `Role: ${role}.`].join("\n");
}

function providerSmokeTask(runner) {
  return [
    `Rux provider smoke for ${runner}.`,
    "Do not edit files.",
    "Reply with a short confirmation that the runner can execute non-interactively in this repository."
  ].join("\n");
}

function aggregateRosterStatus(roster, children) {
  if (children.some((child) => child.status === "timeout")) return "timeout";
  if (roster === "repair") {
    return children[children.length - 1]?.status ?? "failed";
  }
  if (children.some((child) => child.status === "failed")) return "failed";
  if (children.some((child) => child.status === "blocked")) return "blocked";
  return children.every((child) => child.status === "ok") ? "ok" : "failed";
}

function rosterNotes(roster, children) {
  const notes = [
    `Executed ${roster} roster sequentially. No parallel provider calls were made.`
  ];

  if (roster === "repair" && children.length === 1 && children[0]?.status !== "failed") {
    notes.push("Repair step skipped because the first attempt did not fail.");
  }

  if (roster === "repair" && children.length === 1 && children[0]?.status === "failed") {
    notes.push("Repair step was not run because the roster could not create a repair child.");
  }

  return notes;
}

function formatRosterTranscript({ roster, task, cwd, startedAt, endedAt, status, children }) {
  return [
    `runner: ${children[0]?.runner ?? "unknown"}`,
    `roster: ${roster}`,
    `role: roster`,
    `cwd: ${cwd}`,
    `task: ${task}`,
    `started_at: ${startedAt.toISOString()}`,
    `ended_at: ${endedAt.toISOString()}`,
    `status: ${status}`,
    "",
    "## child runs",
    ...children.flatMap((child) => [
      `- ${child.role}: ${child.id} (${child.runner}, ${child.status})`,
      `  transcript: ${child.transcript_path}`
    ])
  ].join("\n");
}

function classifyTask(task) {
  const lower = task.toLowerCase();
  if (/\b(readme|docs?|documentation|mdx?|copy|text)\b/.test(lower)) return "docs";
  if (/\b(test|spec|failing|failure|ci|smoke|regression)\b/.test(lower)) return "test";
  if (/\b(bug|fix|repair|broken|error|exception|crash)\b/.test(lower)) return "bugfix";
  if (/\b(refactor|cleanup|simplify|rename|restructure)\b/.test(lower)) return "refactor";
  if (/\b(review|audit|critique|inspect)\b/.test(lower)) return "review";
  if (/\b(add|build|implement|create|feature|support)\b/.test(lower)) return "feature";
  return "general";
}

function taskKindMetadata(task, options, changedFiles = []) {
  if (options["task-kind"] !== undefined && options["task-kind"] !== true) {
    const taskKind = normalizeTaskKind(options["task-kind"]);
    return {
      task_kind: taskKind,
      task_kind_source: "user",
      task_kind_suggestion: null
    };
  }

  return {
    task_kind: "unspecified",
    task_kind_source: "unspecified",
    task_kind_suggestion: suggestTaskKind(task, changedFiles)
  };
}

function maybeWarnUnspecifiedTaskKind(options) {
  if (options["task-kind"] === undefined) {
    writeRuxProgress("nudge: no --task-kind supplied; recording task_kind=unspecified with a non-authoritative suggestion.");
  }
}

function suggestTaskKind(task, changedFiles = []) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  if (files.length === 0) {
    return classifyTask(task ?? "");
  }

  const docs = files.filter((file) => /\.(md|mdx|txt)$/i.test(file) || file.startsWith("docs/")).length;
  const tests = files.filter((file) => /(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i.test(file)).length;
  const code = files.filter((file) => /\.(mjs|cjs|js|jsx|ts|tsx|go|rs|py|rb|java|kt|swift|css|scss)$/i.test(file)).length;
  if (tests > 0 && tests >= code) return "test";
  if (docs === files.length) return "docs";
  if (code > 0) return classifyTask(task ?? "") === "bugfix" ? "bugfix" : "feature";
  return classifyTask(task ?? "");
}

// The most trustworthy task-kind for an evidence run, in order:
//   1. an explicit user label is authoritative;
//   2. else a kind corrected from what the run actually changed (changed-file
//      extensions, per the Wave 2 work) — this overrides a write-time mislabel
//      such as "docs" on a code run;
//   3. else the stored kind as written.
// We correct only from a real file signal, never from a keyword guess, so a
// genuinely unspecified run stays unspecified rather than being fabricated a kind.
function effectiveTaskKind(run) {
  if (!run || typeof run !== "object") return "unspecified";
  const source = run.task_kind_source ?? "legacy_inferred";
  const stored = run.task_kind;
  if (source === "user" && stored && stored !== "unspecified") {
    return stored;
  }
  const changedFiles = Array.isArray(run.changed_files) ? run.changed_files : [];
  if (changedFiles.length > 0) {
    const corrected = suggestTaskKind(run.task ?? "", changedFiles);
    if (corrected && corrected !== "unspecified") {
      return corrected;
    }
  }
  if (stored && stored !== "unspecified") return stored;
  return "unspecified";
}

// Resolve the task-kind to use for a pre-run query (suggest/plan). There are no
// changed files yet, so the only trustworthy signal is an explicit --task-kind;
// absent that, stay honestly unspecified rather than assuming a keyword guess.
function resolveQueryTaskKind(task, options = {}) {
  if (options["task-kind"] !== undefined && options["task-kind"] !== true) {
    return { task_kind: normalizeTaskKind(options["task-kind"]), task_kind_source: "user" };
  }
  return { task_kind: "unspecified", task_kind_source: "unspecified" };
}

function latestVerdictByRun(events) {
  const verdicts = new Map();
  for (const event of events) {
    if (event.type === "verdict") {
      verdicts.set(event.run_id, event);
    }
  }
  return verdicts;
}

function lifecycleMarksByRun(events) {
  const marks = new Map();
  for (const event of events) {
    if (event.type === "mark") {
      const current = marks.get(event.run_id) ?? [];
      current.push(event);
      marks.set(event.run_id, current);
    }
  }
  return marks;
}

function reportsByRunId(events) {
  const reports = new Map();
  for (const event of events) {
    if (event.type === "report" && event.run_id) {
      const current = reports.get(event.run_id) ?? [];
      current.push(event);
      reports.set(event.run_id, current);
    }
  }
  return reports;
}

function reportsForRun(events, runId) {
  return (reportsByRunId(events).get(runId) ?? []).map(formatLinkedReport);
}

function readClassification(run) {
  const storedStatus = run.status ?? "unknown";
  const storedStatusReason = run.status_reason ?? null;
  const changedFiles = Array.isArray(run.changed_files) ? run.changed_files : [];
  const checks = Array.isArray(run.checks) ? run.checks : [];
  const checksPassed = checks.length > 0 && checks.every((check) => check.exit_code === 0);
  const checksFailed = checks.some((check) => check.exit_code !== 0);
  const hasCheckMutations = checkChangedFiles(run).length > 0;
  const hasScopeViolations = writeScopeViolations(run).length > 0;
  if (hasScopeViolations) {
    return {
      classifier_version: CLASSIFIER_VERSION,
      status: "failed",
      status_reason: "write_scope_violation",
      changed: storedStatus !== "failed" || storedStatusReason !== "write_scope_violation",
      notes: [
        "Write-scope violations outrank provider output classification at read time."
      ]
    };
  }

  if (storedStatus === "blocked" && storedStatusReason === "provider_needs_input" && checksFailed) {
    return {
      classifier_version: CLASSIFIER_VERSION,
      status: "failed",
      status_reason: "check_failed",
      changed: true,
      notes: [
        "Failed checks outrank provider_needs_input at read time."
      ]
    };
  }

  const reclassifyCompleted = (
    storedStatus === "blocked" &&
    storedStatusReason === "provider_needs_input" &&
    changedFiles.length > 0 &&
    checksPassed &&
    !hasCheckMutations &&
    !hasScopeViolations
  );

  if (reclassifyCompleted) {
    return {
      classifier_version: CLASSIFIER_VERSION,
      status: "ok",
      status_reason: "completed",
      changed: true,
      notes: [
        "Stored provider_needs_input was reclassified because the run changed files and all captured checks passed."
      ]
    };
  }

  return {
    classifier_version: CLASSIFIER_VERSION,
    status: storedStatus,
    status_reason: storedStatusReason,
    changed: false,
    notes: []
  };
}

function partitionRecommendationEvidence(runs, verdicts, marks, { includeProbes = false } = {}) {
  const eligible = [];
  const ignored = [];

  for (const run of runs) {
    const verdict = verdicts.get(run.id);
    const reason = recommendationBlocker(run, verdict, marks.get(run.id) ?? [], { includeProbes });
    if (reason) {
      ignored.push({ id: run.id, reason });
    } else {
      eligible.push(run);
    }
  }

  return { eligible, ignored };
}

function recommendationBlocker(run, verdict, marks = [], options = {}) {
  return recommendationBlockers(run, verdict, marks, options)[0] ?? null;
}

function recommendationBlockers(run, verdict, marks = [], { includeProbes = false } = {}) {
  const blockers = [];
  const classification = readClassification(run);
  if (run.parent_id) blockers.push("child_run");
  if (run.purpose === "provider_smoke") blockers.push("provider_smoke");
  if (run.purpose === "probe" && !includeProbes) blockers.push("probe_run");
  if (!isRecommendationSourceRun(run)) blockers.push("not_live");
  if (run.confidence !== "high") blockers.push("not_high_confidence");
  if (run.runner === "fake") blockers.push("fake_runner");
  if (classification.status !== "ok") blockers.push("run_not_ok");
  if (hasLifecycleMark(marks, "reverted")) blockers.push("reverted_downstream");
  if (checkChangedFiles(run).length > 0) blockers.push("check_modified_files");
  if (vacuousChecks(run).length > 0) blockers.push("vacuous_check");
  if (writeScopeViolations(run).length > 0) blockers.push("write_scope_violation");
  if (run.purpose !== "provider_smoke" && !verdict && (!Array.isArray(run.checks) || run.checks.length === 0)) blockers.push("unlabeled");
  return blockers;
}

function checkChangedFiles(run) {
  const checks = Array.isArray(run.checks) ? run.checks : [];
  return unique(checks.flatMap((check) => Array.isArray(check.changed_files) ? check.changed_files : []));
}

function vacuousChecks(run) {
  const checks = Array.isArray(run.checks) ? run.checks : [];
  return checks.filter((check) => check.vacuous === true || isVacuousCheckForRun(run, check));
}

function stampVacuousChecks(run) {
  if (!Array.isArray(run.checks)) return run;
  for (const check of run.checks) {
    check.vacuous = isVacuousCheckForRun(run, check);
  }
  return run;
}

function isVacuousCheckForRun(run, check) {
  if (!check || check.exit_code !== 0) return false;
  const classification = readClassification(run);
  if (classification.status !== "ok") return true;
  const changedFiles = Array.isArray(run.changed_files) ? run.changed_files : [];
  const taskKind = run.task_kind ?? classifyTask(run.task ?? "");
  return changedFiles.length === 0 && isChangeLikeTaskKind(taskKind, run.task ?? "");
}

function isChangeLikeTaskKind(taskKind, task = "") {
  if (["feature", "bugfix", "refactor", "test"].includes(taskKind)) return true;
  if (["review", "docs", "general"].includes(taskKind)) return false;
  return isChangeLikeTask(task);
}

function writeScopeViolations(run) {
  return Array.isArray(run.write_scope?.violations) ? run.write_scope.violations : [];
}

function summarizeEvidenceGroups(runs, verdicts, marks) {
  const groups = new Map();
  for (const run of runs) {
    const key = JSON.stringify({
      runner: run.runner,
      roster: run.roster,
      model: run.model ?? null,
      effort: run.effort ?? null
    });
    const group = groups.get(key) ?? {
      runner: run.runner,
      roster: run.roster,
      model: run.model ?? null,
      effort: run.effort ?? null,
      total: 0,
      accepted: 0,
      partial: 0,
      rejected: 0,
      manual: 0,
      adapter_observed: 0,
      score_total: 0,
      evidence_runs: []
    };
    const verdict = verdicts.get(run.id);
    const runMarks = marks.get(run.id) ?? [];
    const weight = outcomeWeight(run, verdict, runMarks);
    group.total += 1;
    if (run.source === "manual") {
      group.manual += 1;
    } else {
      group.adapter_observed += 1;
    }
    group.score_total += weight;
    if (verdict?.verdict === "accepted" || hasLifecycleMark(runMarks, "accepted-downstream")) group.accepted += 1;
    if (verdict?.verdict === "partial") group.partial += 1;
    if (verdict?.verdict === "rejected" || hasLifecycleMark(runMarks, "reverted")) group.rejected += 1;
    group.evidence_runs.push(run.id);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      score: Number((group.score_total / group.total).toFixed(3)),
      evidence_runs: group.evidence_runs.slice(-5).reverse()
    }))
    .map((group) => ({
      ...group,
      maturity: evidenceMaturityForGroup(group)
    }))
    .sort((left, right) => right.score - left.score || right.total - left.total || left.runner.localeCompare(right.runner));
}

function summarizeEvidenceMaturity(runs, verdicts, marks) {
  const groups = summarizeEvidenceGroups(runs, verdicts, marks);
  const byLevel = countBy(groups.map((group) => group.maturity.level));
  const strongest = groups
    .map((group) => group.maturity)
    .sort((left, right) => maturityRank(right.level) - maturityRank(left.level))[0] ?? evidenceMaturityForGroup(null);

  return {
    eligible_runs: runs.length,
    groups: groups.length,
    strongest_level: strongest.level,
    by_level: byLevel,
    guidance: strongest.guidance
  };
}

function evidenceMaturityForGroup(group) {
  if (!group || group.total === 0) {
    return {
      level: "none",
      runs: 0,
      guidance: "No eligible local task evidence yet. Capture a checked or reviewed provider run before trusting recommendations.",
      next: "Capture one live provider task with a check or human verdict."
    };
  }

  if (group.total < 3) {
    return {
      level: "thin",
      runs: group.total,
      guidance: "One or two labeled runs can guide the next attempt, but should not become a team standard.",
      next: `Capture ${3 - group.total} more labeled run(s) for this runner/model/effort/roster before treating it as directional evidence.`
    };
  }

  if (group.total < 6) {
    return {
      level: "directional",
      runs: group.total,
      guidance: "Several labeled runs support a preference, but keep human review on important work.",
      next: `Capture ${6 - group.total} more labeled run(s) before treating this setup as strong local evidence.`
    };
  }

  if (group.score >= 0.75 && group.rejected === 0) {
    return {
      level: "strong",
      runs: group.total,
      guidance: "Repeated positive local evidence is strong enough to standardize cautiously.",
      next: "Keep recording checks, verdicts, and downstream marks so the recommendation can decay if outcomes change."
    };
  }

  return {
    level: "mixed",
    runs: group.total,
    guidance: "There is enough history, but outcomes are mixed. Prefer review or repair rosters until the failure pattern is understood.",
    next: "Inspect rejected, failed, or reverted runs before increasing automation."
  };
}

function maturityRank(level) {
  return {
    none: 0,
    thin: 1,
    mixed: 2,
    directional: 3,
    strong: 4
  }[level] ?? 0;
}

function outcomeWeight(run, verdict, marks = []) {
  const sourceMultiplier = run.source === "manual" ? 0.5 : 1;
  const classification = readClassification(run);
  let weight = 0;
  if (hasLifecycleMark(marks, "reverted")) return 0;
  if (hasLifecycleMark(marks, "accepted-downstream")) weight = 1;
  else if (verdict?.verdict === "accepted") weight = 1;
  else if (verdict?.verdict === "partial") weight = 0.5;
  else if (verdict?.verdict === "rejected") weight = 0;
  else if (Array.isArray(run.checks) && run.checks.length > 0 && run.checks.every((check) => check.exit_code === 0) && classification.status === "ok") {
    weight = 0.75;
  }
  return weight * sourceMultiplier;
}

function summarizeOutcome(run, children, verdict, marks = []) {
  const classification = readClassification(run);
  const checks = decorateChecksForRun(run);
  const failedChecks = checks.filter((check) => check.exit_code !== 0);
  const childChecks = children.flatMap((child) => Array.isArray(child.checks) ? child.checks : []);
  const failedChildChecks = childChecks.filter((check) => check.exit_code !== 0);
  const childFailures = children.filter((child) => child.status !== "ok");
  const providerSmokeEvidence = isProviderSmokeEvidence(run);
  const changedFiles = Array.isArray(run.changed_files) ? run.changed_files : [];
  const checkLabel = checks.length > 0 && (classification.status === "ok" || failedChecks.length > 0)
    ? failedChecks.length === 0 ? "checks_passed" : "checks_failed"
    : null;

  if (hasLifecycleMark(marks, "reverted")) {
    return {
      label: "reverted_downstream",
      confidence: "high",
      source: "lifecycle_mark",
      score: 0,
      reason: "This run was later marked as reverted.",
      verdict: verdict ? {
        verdict: verdict.verdict,
        note: verdict.note,
        created_at: verdict.created_at
      } : null,
      marks: marks.map(formatLifecycleMark),
      checks: outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks),
      release: { provider_smoke_evidence: providerSmokeEvidence },
      risks: outcomeRisks(run, children, verdict, marks)
    };
  }

  if (hasLifecycleMark(marks, "accepted-downstream")) {
    return {
      label: "accepted_downstream",
      confidence: isRecommendationSourceRun(run) && run.confidence === "high" ? "high" : "medium",
      source: "lifecycle_mark",
      score: 1,
      reason: "This run was later marked as accepted downstream.",
      verdict: verdict ? {
        verdict: verdict.verdict,
        note: verdict.note,
        created_at: verdict.created_at
      } : null,
      marks: marks.map(formatLifecycleMark),
      checks: outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks),
      release: { provider_smoke_evidence: providerSmokeEvidence },
      risks: outcomeRisks(run, children, verdict, marks)
    };
  }

  if (verdict?.verdict) {
    return {
      label: `human_${verdict.verdict}`,
      confidence: isRecommendationSourceRun(run) && run.confidence === "high" ? "high" : "medium",
      source: "human_verdict",
      score: outcomeWeight(run, verdict, marks),
      reason: `Latest human verdict is ${verdict.verdict}.`,
      verdict: {
        verdict: verdict.verdict,
        note: verdict.note,
        created_at: verdict.created_at
      },
      marks: marks.map(formatLifecycleMark),
      checks: outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks),
      release: { provider_smoke_evidence: providerSmokeEvidence },
      risks: outcomeRisks(run, children, verdict, marks)
    };
  }

  if (checkLabel) {
    const passed = checkLabel === "checks_passed";
    return {
      label: checkLabel,
      confidence: passed ? "medium" : "high",
      source: "check_result",
      score: passed ? 0.75 : 0,
      reason: passed ? "All captured checks passed." : "At least one captured check failed.",
      verdict: null,
      marks: marks.map(formatLifecycleMark),
      checks: outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks),
      release: { provider_smoke_evidence: providerSmokeEvidence },
      risks: outcomeRisks(run, children, verdict, marks)
    };
  }

  if (providerSmokeEvidence) {
    return {
      label: "provider_smoke_passed",
      confidence: "release_only",
      source: "provider_smoke",
      score: 0,
      reason: "Provider smoke succeeded with no file changes. This proves adapter readiness, not task quality.",
      verdict: null,
      marks: marks.map(formatLifecycleMark),
      checks: outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks),
      release: { provider_smoke_evidence: true },
      risks: outcomeRisks(run, children, verdict, marks)
    };
  }

  if (run.source === "imported" || run.confidence === "low") {
    return {
      label: "imported_unverified",
      confidence: "low",
      source: "imported_session",
      score: 0,
      reason: "Imported history is preserved for continuity, but it has no captured checks or live execution proof.",
      verdict: null,
      marks: marks.map(formatLifecycleMark),
      checks: outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks),
      release: { provider_smoke_evidence: false },
      risks: outcomeRisks(run, children, verdict, marks)
    };
  }

  if (classification.status === "blocked") {
    return {
      label: "blocked_for_input",
      confidence: "high",
      source: "run_status",
      score: 0,
      reason: classification.status_reason === "provider_needs_input"
        ? "Provider asked for confirmation or more input before completing the task."
        : "Provider produced a plan/proposal instead of completing the task.",
      verdict: null,
      marks: marks.map(formatLifecycleMark),
      checks: outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks),
      release: { provider_smoke_evidence: false },
      risks: outcomeRisks(run, children, verdict, marks)
    };
  }

  if (classification.status !== "ok") {
    return {
      label: "run_failed",
      confidence: "high",
      source: "run_status",
      score: 0,
      reason: `Effective run status is ${classification.status}.`,
      verdict: null,
      marks: marks.map(formatLifecycleMark),
      checks: outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks),
      release: { provider_smoke_evidence: false },
      risks: outcomeRisks(run, children, verdict, marks)
    };
  }

  return {
    label: "unlabeled",
    confidence: "none",
    source: "missing_label",
    score: 0,
    reason: "No human verdict or check result has been captured for this run.",
    verdict: null,
    marks: marks.map(formatLifecycleMark),
    checks: outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks),
    release: { provider_smoke_evidence: false },
    risks: outcomeRisks(run, children, verdict, marks)
  };
}

function decorateChecksForRun(run) {
  const checks = Array.isArray(run.checks) ? run.checks : [];
  return checks.map((check) => ({
    ...check,
    vacuous: check.vacuous === true || isVacuousCheckForRun(run, check)
  }));
}

function outcomeCheckSummary(checks, failedChecks, childChecks, failedChildChecks) {
  return {
    total: checks.length,
    failed: failedChecks.length,
    child_total: childChecks.length,
    child_failed: failedChildChecks.length,
    commands: checks.map((check) => ({
      command: check.command,
      exit_code: check.exit_code,
      vacuous: check.vacuous === true
    }))
  };
}

function outcomeRisks(run, children, verdict, marks = []) {
  const risks = [];
  const classification = readClassification(run);
  if (!verdict && (!Array.isArray(run.checks) || run.checks.length === 0) && run.purpose !== "provider_smoke") {
    risks.push("missing_verdict_or_check");
  }
  if (hasLifecycleMark(marks, "reverted")) risks.push("reverted_downstream");
  if (hasLifecycleMark(marks, "replayed")) risks.push("replayed_downstream");
  if (!isRecommendationSourceRun(run)) risks.push("not_live");
  if (run.source === "manual") risks.push("manual_capture");
  if (run.confidence !== "high") risks.push("not_high_confidence");
  if (run.runner === "fake") risks.push("fake_runner");
  if (classification.status === "blocked") risks.push("blocked_run");
  if (classification.status_reason === "provider_needs_input") risks.push("provider_needs_input");
  if (classification.status_reason === "provider_plan_only") risks.push("provider_plan_only");
  if (classification.status_reason === "provider_plan_changed_files") risks.push("provider_plan_changed_files");
  if (classification.status_reason === "write_scope_violation" || writeScopeViolations(run).length > 0) risks.push("write_scope_violation");
  if (Array.isArray(run.contaminated_files) && run.contaminated_files.length > 0) risks.push("baseline_contaminated_files");
  if (checkChangedFiles(run).length > 0) risks.push("check_modified_files");
  if (vacuousChecks(run).length > 0) risks.push("vacuous_check");
  if (Array.isArray(run.changed_files) && run.changed_files.length > 10) risks.push("large_change_surface");
  if (children.some((child) => child.status !== "ok")) risks.push("child_run_failed");
  return risks;
}

function hasLifecycleMark(marks, mark) {
  return marks.some((event) => event.mark === mark);
}

function latestLifecycleMark(marks) {
  return marks.at(-1) ?? null;
}

function formatLifecycleMark(mark) {
  return {
    mark: mark.mark,
    note: mark.note,
    created_at: mark.created_at
  };
}

function formatLinkedReport(report) {
  return {
    id: report.id,
    kind: report.kind,
    summary: report.summary,
    note: report.note ?? "",
    command: report.command ?? "",
    no_run_reason: report.no_run_reason ?? "",
    source_repo: report.source_repo ?? null,
    report_path: report.report_path ?? null,
    created_at: report.created_at
  };
}

function isProviderSmokeEvidence(run) {
  return (
    run.purpose === "provider_smoke" &&
    run.source === "live" &&
    run.confidence === "high" &&
    run.status === "ok" &&
    Array.isArray(run.changed_files) &&
    run.changed_files.length === 0
  );
}

function evaluateRunRecord(run, children, verdicts, marksByRun = new Map(), reportsByRun = new Map()) {
  const verdict = verdicts.get(run.id) ?? null;
  const marks = marksByRun.get(run.id) ?? [];
  const reports = reportsByRun.get(run.id) ?? [];
  const classification = readClassification(run);
  const latestMark = latestLifecycleMark(marks);
  const blockers = recommendationBlockers(run, verdict, marks);
  const checks = decorateChecksForRun(run);
  const failedChecks = checks.filter((check) => check.exit_code !== 0);
  const changedByChecks = checkChangedFiles(run);
  const vacuous = vacuousChecks(run);
  const childChecks = children.flatMap((child) => Array.isArray(child.checks) ? child.checks : []);
  const childFailures = children.filter((child) => child.status !== "ok");
  const score = blockers.length === 0 ? outcomeWeight(run, verdict, marks) : 0;
  const providerSmokeReleaseEvidence = isProviderSmokeEvidence(run);
  const stderrSignal = adapterStderrSignal(run.adapter);

  return {
    run_id: run.id,
    purpose: run.purpose ?? "task_run",
    runner: run.runner,
    model: run.model ?? null,
    effort: run.effort ?? null,
    roster: run.roster,
    role: run.role ?? null,
    task_kind: run.task_kind ?? classifyTask(run.task ?? ""),
    task_kind_source: run.task_kind_source ?? "legacy_inferred",
    task_kind_suggestion: run.task_kind_suggestion ?? null,
    provider_mode: run.provider_mode ?? inferProviderMode(run),
    status: run.status,
    status_reason: run.status_reason ?? null,
    effective_status: classification.status,
    effective_status_reason: classification.status_reason,
    classifier_version: classification.classifier_version,
    latest_verdict: verdict ? {
      verdict: verdict.verdict,
      note: verdict.note,
      created_at: verdict.created_at
    } : null,
    latest_mark: latestMark ? formatLifecycleMark(latestMark) : null,
    signals: {
      source: run.source ?? "live",
      confidence: run.confidence ?? "unknown",
      classifier_changed: classification.changed,
      classifier_notes: classification.notes,
      adapter_exit_code: run.adapter?.exit_code ?? null,
      adapter_timed_out: run.adapter?.timed_out ?? false,
      adapter_stdout_bytes: run.adapter?.stdout_bytes ?? null,
      adapter_stderr_bytes: run.adapter?.stderr_bytes ?? null,
      adapter_stderr_signal: stderrSignal?.level ?? null,
      adapter_stderr_reason: stderrSignal?.reason ?? null,
      repo_snapshot: Boolean(run.repo),
      output_signal: run.output_signal?.kind ?? null,
      repo_dirty_before: run.repo?.before?.dirty_entries ?? run.repo?.recorded_at?.dirty_entries ?? run.repo?.imported_at?.dirty_entries ?? null,
      repo_dirty_after: run.repo?.after?.dirty_entries ?? run.repo?.after_check?.dirty_entries ?? null,
      checks_total: checks.length,
      checks_failed: failedChecks.length,
      check_changed_files: changedByChecks.length,
      vacuous_checks: vacuous.length,
      changed_files: Array.isArray(run.changed_files) ? run.changed_files.length : 0,
      baseline_contaminated_files: Array.isArray(run.contaminated_files) ? run.contaminated_files.length : 0,
      write_scope_violations: writeScopeViolations(run).length,
      child_runs: children.length,
      child_failures: childFailures.length,
      child_checks_total: childChecks.length,
      marks_total: marks.length,
      linked_reports_total: reports.length,
      linked_success_reports: reports.filter((report) => report.kind === "success").length,
      reverted: hasLifecycleMark(marks, "reverted"),
      replayed: hasLifecycleMark(marks, "replayed"),
      accepted_downstream: hasLifecycleMark(marks, "accepted-downstream")
    },
    outcome: summarizeOutcome(run, children, verdict, marks),
    cost_hint: run.cost_hint ?? null,
    routing: {
      eligible: blockers.length === 0,
      blockers,
      score,
      score_basis: scoreBasis(run, verdict, blockers, marks)
    },
    release: {
      provider_smoke_evidence: providerSmokeReleaseEvidence
    },
    children: children.map((child) => ({
      id: child.id,
      role: child.role,
      runner: child.runner,
      status: child.status,
      checks_total: Array.isArray(child.checks) ? child.checks.length : 0,
      changed_files: Array.isArray(child.changed_files) ? child.changed_files.length : 0
    }))
  };
}

function scoreBasis(run, verdict, blockers, marks = []) {
  const prefix = run.source === "manual" ? "manual:" : "";
  const classification = readClassification(run);
  if (blockers.length > 0) {
    return `blocked:${blockers.join(",")}`;
  }
  if (hasLifecycleMark(marks, "accepted-downstream")) {
    return `${prefix}lifecycle_mark:accepted_downstream`;
  }
  if (verdict?.verdict) {
    return `${prefix}human_verdict:${verdict.verdict}`;
  }
  if (Array.isArray(run.checks) && run.checks.length > 0 && run.checks.every((check) => check.exit_code === 0) && classification.status === "ok") {
    return `${prefix}checks_passed`;
  }
  if (Array.isArray(run.checks) && run.checks.length > 0 && run.checks.some((check) => check.exit_code !== 0)) {
    return `${prefix}checks_failed`;
  }
  return "no_positive_signal";
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function buildProposalFindings(runs, verdicts, marks, release = null) {
  const findings = [];
  const providerSmokeRuns = runs.filter((run) => run.source === "live" && run.runner !== "fake" && run.purpose === "provider_smoke");
  const liveProviderRuns = runs.filter((run) => run.source === "live" && run.runner !== "fake" && run.purpose !== "provider_smoke");
  const importedRuns = runs.filter((run) => run.source === "imported");
  const unlabeledRuns = liveProviderRuns.filter((run) => !verdicts.has(run.id) && (!Array.isArray(run.checks) || run.checks.length === 0));
  const failedRuns = runs.filter((run) => readClassification(run).status === "failed" || (Array.isArray(run.checks) && run.checks.some((check) => check.exit_code !== 0)) || hasLifecycleMark(marks.get(run.id) ?? [], "reverted"));
  const positiveProviderRuns = liveProviderRuns.filter((run) => outcomeWeight(run, verdicts.get(run.id), marks.get(run.id) ?? []) > 0);
  const releaseBlockers = release?.gates?.filter((gate) => !gate.ok) ?? [];

  if (runs.length === 0) {
    findings.push({
      category: "capture",
      title: "Capture the first run",
      body: "No run records exist yet. The next useful step is one live provider run with a check command and a human verdict.",
      run_ids: []
    });
    return findings;
  }

  if (release && releaseBlockers.length > 0) {
    const evidenceBlockers = new Set([
      "claude_smoke_evidence",
      "codex_smoke_evidence",
      "gemini_smoke_evidence",
      "real_provider_task_evidence"
    ]);
    const citedRuns = releaseBlockers.some((gate) => evidenceBlockers.has(gate.name))
      ? (liveProviderRuns.length > 0 ? liveProviderRuns : providerSmokeRuns)
      : runs;
    findings.push({
      category: "release",
      title: "Keep release blocked until evidence gates pass",
      body: `Release-check is not ready. Current blockers: ${releaseBlockers.map(formatReleaseBlocker).join("; ")}. Do not remove package privacy or publish until these are deliberately cleared.`,
      run_ids: lastRunIds(citedRuns)
    });
  }

  if (unlabeledRuns.length > 0) {
    findings.push({
      category: "labels",
      title: "Attach verdicts to live provider runs",
      body: `${unlabeledRuns.length} live provider run(s) have no check result or human verdict. They are useful history, but they cannot guide routing yet.`,
      run_ids: lastRunIds(unlabeledRuns)
    });
  }

  if (failedRuns.length > 0) {
    findings.push({
      category: "checks",
      title: "Review failed runs before adding automation",
      body: `${failedRuns.length} run(s) failed, had failing checks, or were later reverted. Use these to define the first repair roster instead of guessing at retry behavior.`,
      run_ids: lastRunIds(failedRuns)
    });
  }

  if (importedRuns.length > 0) {
    findings.push({
      category: "imports",
      title: "Keep imported history as continuity, not proof",
      body: `${importedRuns.length} imported run(s) are present. They should stay out of recommendations unless a human adds labels that make their limitations clear.`,
      run_ids: lastRunIds(importedRuns)
    });
  }

  if (positiveProviderRuns.length === 0) {
    const citedRuns = liveProviderRuns.length > 0
      ? liveProviderRuns
      : providerSmokeRuns.length > 0
        ? providerSmokeRuns
        : runs;
    findings.push({
      category: liveProviderRuns.length === 0 && providerSmokeRuns.length > 0 ? "capture" : "routing",
      title: liveProviderRuns.length === 0 && providerSmokeRuns.length > 0
        ? "Capture a labeled provider task before routing"
        : "Do not claim routing intelligence yet",
      body: liveProviderRuns.length === 0 && providerSmokeRuns.length > 0
        ? "Provider smoke evidence proves adapter readiness, not task quality. Capture one routing-eligible real provider task with a check command or human verdict before trusting routing recommendations."
        : "No live provider run has a positive outcome label. Keep using explicit runner choice until at least one real provider run is accepted or passes checks.",
      run_ids: lastRunIds(citedRuns)
    });
  }

  if (findings.length === 0) {
    findings.push({
      category: "steady_state",
      title: "Keep collecting labeled runs",
      body: "The ledger has positive live provider evidence and no obvious hygiene gaps. The next useful improvement is a fixed roster run so routing can compare solo versus reviewed work.",
      run_ids: lastRunIds(runs)
    });
  }

  return findings;
}

function formatProposal({ id, cwd, createdAt, runs, verdicts, release, findings }) {
  const liveRuns = runs.filter((run) => run.source === "live").length;
  const importedRuns = runs.filter((run) => run.source === "imported").length;
  const labeledRuns = runs.filter((run) => verdicts.has(run.id) || (Array.isArray(run.checks) && run.checks.length > 0)).length;
  const releaseBlockers = release?.gates?.filter((gate) => !gate.ok) ?? [];

  return [
    `# Rux Proposal`,
    "",
    `ID: ${id}`,
    `Created: ${createdAt.toISOString()}`,
    `Repo: ${cwd}`,
    "",
    "## Snapshot",
    "",
    `- Runs: ${runs.length}`,
    `- Live runs: ${liveRuns}`,
    `- Imported runs: ${importedRuns}`,
    `- Labeled runs: ${labeledRuns}`,
    `- Release ready: ${release?.ready === true ? "yes" : "no"}`,
    `- Release blockers: ${releaseBlockers.length > 0 ? releaseBlockers.map((gate) => gate.name).join(", ") : "none"}`,
    `- One-time blockers: ${release?.blocker_summary?.one_time?.length > 0 ? release.blocker_summary.one_time.join(", ") : "none"}`,
    `- Permanent blockers: ${release?.blocker_summary?.permanent?.length > 0 ? release.blocker_summary.permanent.join(", ") : "none"}`,
    "",
    "## Proposed Improvements",
    "",
    ...findings.flatMap((finding, index) => [
      `### ${index + 1}. ${finding.title}`,
      "",
      finding.body,
      "",
      `Cited runs: ${finding.run_ids.length > 0 ? finding.run_ids.join(", ") : "none"}`,
      ""
    ]),
    "## Guardrail",
    "",
    "This proposal is advisory. Rux must not apply source changes, mutate prompts, or change routing policy without a human action."
  ].join("\n");
}

function formatReport({ id, kind, summary, note, command, runId, runFound, noRunReason, sourceRepo, cwd, createdAt }) {
  return [
    "# Rux Feedback Report",
    "",
    `ID: ${id}`,
    `Created: ${createdAt.toISOString()}`,
    `Kind: ${kind}`,
    `Store repo: ${cwd}`,
    `Source repo: ${sourceRepo}`,
    `Run ID: ${runId ?? "none"}`,
    `Run found: ${runFound === null ? "not provided" : runFound ? "yes" : "no"}`,
    `No-run reason: ${noRunReason ?? "none"}`,
    `Command: ${command ?? "not provided"}`,
    "",
    "## Summary",
    "",
    summary,
    "",
    "## Notes",
    "",
    note ?? "none",
    "",
    "## Guardrail",
    "",
    "This is raw feedback. It records a local observation and does not open an external issue, change routing policy, or modify source code."
  ].join("\n");
}

function lastRunIds(runs) {
  return newestRuns(runs).slice(0, 5).map((run) => run.id);
}

function formatReleaseBlocker(gate) {
  return `${gate.name} (${gate.lifecycle}/${gate.category})`;
}

function inferRunnerFromImport(path, text) {
  const haystack = `${path}\n${text.slice(0, 2000)}`.toLowerCase();
  if (haystack.includes("claude")) return "claude";
  if (haystack.includes("codex")) return "codex";
  if (haystack.includes("gemini")) return "gemini";
  return "unknown";
}

function normalizeImportedRunner(value) {
  const normalized = value.toLowerCase();
  const allowed = new Set(["claude", "codex", "gemini", "cursor", "zed", "unknown"]);
  if (!allowed.has(normalized)) {
    throw new Error(`Unsupported imported runner: ${value}. Use claude, codex, gemini, cursor, zed, or unknown.`);
  }
  return normalized;
}

function normalizeImportedStatus(value) {
  const normalized = value.toLowerCase();
  const allowed = new Set(["ok", "failed", "timeout", "cancelled", "unknown"]);
  if (!allowed.has(normalized)) {
    throw new Error(`Unsupported imported status: ${value}. Use ok, failed, timeout, cancelled, or unknown.`);
  }
  return normalized;
}

function parseDateOption(value, fallback) {
  if (!value) return fallback;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function formatImportedTranscript({ from, runner, task, status, startedAt, endedAt, importedText }) {
  return [
    `runner: ${runner}`,
    `source: imported`,
    `confidence: low`,
    `imported_from: ${from}`,
    `task: ${task}`,
    `started_at: ${startedAt.toISOString()}`,
    `ended_at: ${endedAt.toISOString()}`,
    `status: ${status}`,
    "",
    "## imported transcript",
    importedText.trimEnd()
  ].join("\n");
}

function formatManualTranscript({ runner, task, note, check, changedFiles, sessionBaseline, contaminatedFiles, startedAt, endedAt }) {
  const lines = [
    `runner: ${runner}`,
    `source: manual`,
    `confidence: high`,
    `task: ${task}`,
    `started_at: ${startedAt.toISOString()}`,
    `ended_at: ${endedAt.toISOString()}`,
    "",
    "## manual record",
    "Rux recorded current-session work after the fact. It did not launch the provider CLI for this run.",
    "",
    "## changed files",
    ...(changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`) : ["none"])
  ];

  if (sessionBaseline) {
    lines.push(
      "",
      "## session baseline",
      `id: ${sessionBaseline.id}`,
      `created_at: ${sessionBaseline.created_at}`,
      `contaminated_files: ${contaminatedFiles.length > 0 ? contaminatedFiles.join(", ") : "none"}`
    );
  }

  if (check) {
    lines.push(
      "",
      "## check",
      `command: ${check.command}`,
      `exit_code: ${check.exit_code}`
    );
  }

  if (note) {
    lines.push("", "## note", note);
  }

  return lines.join("\n");
}
