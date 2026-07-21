#!/usr/bin/env node

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const cliPath = join(repoRoot, "src", "cli.mjs");
const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const tempRoot = await mkdtemp(join(tmpdir(), "rux-smoke-"));
const tempBin = join(tempRoot, "bin");
const npmEnv = {
  NPM_CONFIG_CACHE: join(tempRoot, "npm-cache"),
  NPM_CONFIG_DRY_RUN: "false",
  npm_config_dry_run: "false"
};

try {
  run("git", ["init"], tempRoot);
  await writeFile(join(tempRoot, "README.md"), "# Smoke\n", "utf8");
  run("git", ["add", "README.md"], tempRoot);
  run("git", ["commit", "-m", "initial"], tempRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await installMockClaude(tempBin);
  await installMockCodex(tempBin);
  await installMockGemini(tempBin);

  const helpRun = run("node", [cliPath, "--help"]);
  assert(helpRun.stdout.includes("Usage:"), "--help should print usage");
  assert(helpRun.stdout.includes("rux init"), "--help should include init command");
  assert(helpRun.stdout.includes("rux run"), "--help should include run command");
  assert(helpRun.stdout.includes("rux record"), "--help should include manual record command");
  assert(helpRun.stdout.includes("record --start"), "--help should include manual record baseline command");
  assert(helpRun.stdout.includes("rux check"), "--help should include post-run check command");
  assert(helpRun.stdout.includes("rux report"), "--help should include feedback report command");
  assert(helpRun.stdout.includes("--allow-dirty"), "--help should include dirty worktree override");
  assert(helpRun.stdout.includes("--write-scope"), "--help should include write-scope guard");
  assert(helpRun.stdout.includes("rux release-check [--cwd PATH] [--strict]"), "--help should include strict release-check flag");
  assert(helpRun.stdout.includes("rux status --scorecard"), "--help should include the routing scorecard view");
  const shortHelpRun = run("node", [cliPath, "-h"]);
  assert(shortHelpRun.stdout.includes("Usage:"), "-h should print usage");
  const versionRun = run("node", [cliPath, "--version"]);
  assert(versionRun.stdout.trim() === `rux ${packageJson.version}`, "--version should print package version");
  const versionCommandRun = run("node", [cliPath, "version"]);
  assert(versionCommandRun.stdout.trim() === `rux ${packageJson.version}`, "version command should print package version");
  const unknownFlagRun = spawnSync("node", [
    cliPath,
    "run",
    "typo guard",
    "--runner",
    "gemini",
    "--privoder-mode",
    "write",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(unknownFlagRun.status !== 0, "unknown flags should fail before running providers");
  assert(unknownFlagRun.stderr.includes("Unknown option --privoder-mode"), "unknown flag error should name the bad flag");
  assert(unknownFlagRun.stderr.includes("Did you mean --provider-mode?"), "unknown flag error should suggest provider-mode");

  const dirtyGuardRoot = join(tempRoot, "dirty-guard");
  await mkdir(dirtyGuardRoot, { recursive: true });
  run("git", ["init"], dirtyGuardRoot);
  await writeFile(join(dirtyGuardRoot, "README.md"), "# Dirty Guard\n", "utf8");
  run("git", ["add", "README.md"], dirtyGuardRoot);
  run("git", ["commit", "-m", "initial"], dirtyGuardRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(dirtyGuardRoot, "dirty.txt"), "uncommitted\n", "utf8");
  const dirtyProviderGuard = spawnSync("node", [
    cliPath,
    "run",
    "dirty provider guard",
    "--runner",
    "codex",
    "--cwd",
    dirtyGuardRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(dirtyProviderGuard.status !== 0, "real provider runs should refuse dirty worktrees by default");
  assert(dirtyProviderGuard.stderr.includes("Refusing to run real provider runner(s) codex in a dirty worktree"), "dirty guard should explain the refusal");
  assert(dirtyProviderGuard.stderr.includes("dirty.txt"), "dirty guard should name dirty files");
  const dirtyFakeRun = spawnSync("node", [
    cliPath,
    "run",
    "dirty fake run",
    "--runner",
    "fake",
    "--cwd",
    dirtyGuardRoot
  ], { encoding: "utf8" });
  assert(dirtyFakeRun.status === 0, "fake runs should still work in dirty worktrees");
  const dirtyOverrideRun = spawnSync("node", [
    cliPath,
    "run",
    "dirty override run",
    "--runner",
    "codex",
    "--allow-dirty",
    "--cwd",
    dirtyGuardRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(dirtyOverrideRun.status === 0, "--allow-dirty should explicitly bypass the provider dirty guard");
  const dirtyOverrideSummary = JSON.parse(dirtyOverrideRun.stdout);
  assert(dirtyOverrideSummary.replay.command.includes("--allow-dirty"), "dirty override should stay visible in replay metadata");
  const repoReleaseCheck = JSON.parse(run("node", [cliPath, "release-check"], repoRoot).stdout);
  assert(repoReleaseCheck.identity.product === "Rux", "release-check should expose current product identity");
  assert(repoReleaseCheck.identity.cli === "rux", "release-check should expose current CLI identity");
  assert(repoReleaseCheck.identity.package_name === packageJson.name, "release-check should expose package identity");
  assert(repoReleaseCheck.identity.package_bin.includes("rux"), "release-check should expose package bin identity");
  assert(repoReleaseCheck.identity.store_dir === ".rux", "release-check should expose store identity");
  assert(repoReleaseCheck.identity.policy_file === "rux.policy.json", "release-check should expose policy file identity");
  assert(repoReleaseCheck.identity.name_status === "release_name_selected", "release-check should expose selected release naming");
  assert(repoReleaseCheck.identity.rename_surfaces.some((surface) => surface.includes("src/identity.mjs")), "release-check should list rename surfaces");
  assert(packageJson.name.startsWith("@moshpits/"), "package should use the moshpits npm org scope");
  assert(packageJson.scripts["prepublishOnly"] === "npm run release:verify", "package should gate npm publish through release verification");
  assert(packageJson.scripts["release:verify"].includes("release-check --strict"), "release verification should use strict release-check");
  const packDryRun = JSON.parse(run("npm", ["pack", "--dry-run", "--json"], repoRoot, npmEnv).stdout)[0];
  const packedPaths = packDryRun.files.map((file) => file.path);
  assert(packDryRun.name === packageJson.name, "pack dry-run should use package.json name");
  assert(packedPaths.includes("src/cli.mjs"), "package should include CLI source");
  assert(packedPaths.includes("src/identity.mjs"), "package should include identity source");
  assert(packedPaths.includes("rux.policy.json"), "package should include default policy");
  assert(!packedPaths.includes("AGENTS.md"), "package should not include agent instructions");
  assert(!packedPaths.some((path) => path.startsWith("tests/")), "package should not include smoke tests");
  assert(!packedPaths.some((path) => path.startsWith("docs/")), "package should not include internal docs");
  const packResult = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", tempRoot], repoRoot, npmEnv).stdout)[0];
  const tarballPath = resolve(tempRoot, packResult.filename);
  assert(existsSync(tarballPath), "npm pack should write a local tarball");
  const packageInstallRoot = join(tempRoot, "package-install");
  run("npm", ["install", "--ignore-scripts", "--prefix", packageInstallRoot, tarballPath], repoRoot, npmEnv);
  const installedBin = join(packageInstallRoot, "node_modules", ".bin", process.platform === "win32" ? "rux.cmd" : "rux");
  assert(existsSync(installedBin), "installed package should expose rux bin");
  const installedVersionRun = run(installedBin, ["--version"]);
  assert(installedVersionRun.stdout.trim() === `rux ${packageJson.version}`, "installed package bin should print version");
  const installedHelpRun = run(installedBin, ["help"]);
  assert(installedHelpRun.stdout.includes("rux init"), "installed package bin should include init command");
  assert(installedHelpRun.stdout.includes("rux run"), "installed package bin should print help");
  assert(!packResult.files.some((file) => file.path === "tests" || file.path.startsWith("tests/")), "local tarball should not include tests");

  const coldPlanRun = spawnSync("node", [
    cliPath,
    "plan",
    "update the docs",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(coldPlanRun.status === 0, "cold-start plan should complete");
  const coldPlan = JSON.parse(coldPlanRun.stdout);
  assert(coldPlan.dry_run === true, "plan should mark itself as a dry run");
  assert(coldPlan.would_execute === false, "plan should not execute providers");
  assert(coldPlan.recommendation.confidence === "cold_start", "cold-start plan should admit missing evidence");
  assert(coldPlan.recommendation.maturity.level === "none", "cold-start plan should expose missing evidence maturity");
  assert(coldPlan.recommendation.runner === "claude", "cold-start plan should prefer an available real runner");
  assert(coldPlan.runner_source === "availability_fallback", "cold-start runner should be labeled as availability fallback");
  assert(coldPlan.policy.source === "default", "cold-start plan without policy file should use default policy");
  assert(coldPlan.recommendation.roster === "solo", "cold-start docs work should stay solo");
  assert(coldPlan.policy.token_governor.mode === "advisory", "cold-start plan should expose token governor mode");
  assert(coldPlan.policy.token_governor.max_tool_output_chars === 20000, "cold-start plan should expose tool output cap");
  assert(coldPlan.policy.token_governor.handoff_after_turns === 120, "cold-start plan should expose handoff threshold");
  assert(coldPlan.recommendation.one_agent_not_enough === null, "solo plans should not invent a multi-agent rationale");
  assert(coldPlan.runner_by_role.implementer === "claude", "solo plan should resolve the implementer runner");
  assert(coldPlan.recommendation.roles.length === 1, "solo plan should preview one role");
  assert(coldPlan.command.includes("rux run"), "plan should include a runnable command");
  assert(!existsSync(join(tempRoot, ".rux")), "plan should not create the ledger store");

  const coldPolicy = JSON.parse(run("node", [cliPath, "policy", "--cwd", tempRoot]).stdout);
  assert(coldPolicy.exists === false, "policy should report missing policy file");
  assert(coldPolicy.source === "default", "policy should fall back to runtime defaults");
  assert(coldPolicy.policy.parallel_provider_cli_runs === false, "default policy should refuse parallel provider CLI runs");
  assert(coldPolicy.policy.token_governor.mode === "advisory", "default policy should include token governor");
  assert(coldPolicy.policy.token_governor.subagents_require_budget === true, "default policy should require subagent budgets");
  assert(!existsSync(join(tempRoot, ".rux")), "policy should remain read-only before the first run");

  const coldStatus = JSON.parse(run("node", [cliPath, "status", "--cwd", tempRoot]).stdout);
  assert(coldStatus.identity.cli === "rux", "status should expose CLI identity");
  assert(coldStatus.identity.package_name === null, "status should tolerate repos without package identity");
  assert(coldStatus.identity.rename_surfaces.some((surface) => surface.includes("package.json")), "status should list rename surfaces");
  assert(coldStatus.ledger.exists === false, "cold status should not create the ledger store");
  assert(coldStatus.policy.exists === false, "cold status should expose missing policy file");
  assert(coldStatus.ledger.runs === 0, "cold status should report zero runs");
  assert(coldStatus.evidence.eligible_runs === 0, "cold status should report no routing evidence");
  assert(coldStatus.evidence.maturity.strongest_level === "none", "cold status should expose missing evidence maturity");
  assert(coldStatus.next_capture.needed === true, "cold status should expose the next capture step");
  assert(coldStatus.next_capture.runner === "claude", "cold status should suggest the first available default runner");
  assert(coldStatus.next_capture.runner_source === "availability_fallback", "cold status should label availability fallback");
  assert(coldStatus.next_capture.provider_call_required === true, "cold status should disclose provider-call boundary");
  assert(coldStatus.next_capture.writes_ledger === true, "cold status should disclose ledger write boundary");
  assert(coldStatus.next_capture.human_review_required === true, "cold status should disclose review boundary");
  assert(coldStatus.next_capture.command.includes("rux run"), "cold status should include a command template");
  assert(coldStatus.next_capture.command.includes("--check"), "cold status command should include a check placeholder");
  assert(coldStatus.release.ready === false, "cold status should include release gate state");
  assert(coldStatus.next_actions.some((action) => action.includes("first live provider task")), "cold status should suggest the first capture step");
  assert(!existsSync(join(tempRoot, ".rux")), "status should remain read-only before the first run");

  const initResult = JSON.parse(run("node", [cliPath, "init", "--cwd", tempRoot]).stdout);
  assert(initResult.policy.created === true, "init should create policy file");
  assert(initResult.gitignore.written === true, "init should update gitignore");
  assert(initResult.gitignore.ignores_store === true, "init should ignore the local store");
  assert(existsSync(join(tempRoot, "rux.policy.json")), "init should write policy file");
  const initializedGitignore = await readFile(join(tempRoot, ".gitignore"), "utf8");
  assert(initializedGitignore.includes(".rux/"), "init should add store ignore rule");
  const initializedPolicy = JSON.parse(run("node", [cliPath, "policy", "--cwd", tempRoot]).stdout);
  assert(initializedPolicy.exists === true, "policy should see initialized policy file");
  assert(initializedPolicy.source === "file", "initialized policy should be file-backed");
  assert(initializedPolicy.policy.token_governor.expensive_routes_require_reason === true, "initialized policy should preserve expensive route guard");
  const secondInitResult = JSON.parse(run("node", [cliPath, "init", "--cwd", tempRoot]).stdout);
  assert(secondInitResult.policy.written === false, "init should not overwrite existing policy by default");
  assert(secondInitResult.gitignore.written === false, "init should not duplicate gitignore rule");
  const forceInitResult = JSON.parse(run("node", [cliPath, "init", "--cwd", tempRoot, "--force"]).stdout);
  assert(forceInitResult.policy.overwritten === true, "init --force should overwrite policy");
  assert(!existsSync(join(tempRoot, ".rux")), "init should not create the ledger store");

  await writeFile(join(tempRoot, "rux.policy.json"), JSON.stringify({
    schema_version: 1,
    preferred_runner_order: ["gemini", "codex", "claude"],
    default_roster: "solo",
    parallel_provider_cli_runs: false,
    provider_auth: "inherit_cli_environment",
    transcript_export_default: "omit",
    self_modification: "proposal_only"
  }, null, 2), "utf8");
  const filePolicy = JSON.parse(run("node", [cliPath, "policy", "--cwd", tempRoot]).stdout);
  assert(filePolicy.exists === true, "policy should load committed policy file");
  assert(filePolicy.policy.preferred_runner_order[0] === "gemini", "policy should preserve preferred runner order");
  const policyPlanRun = spawnSync("node", [
    cliPath,
    "plan",
    "update more docs",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(policyPlanRun.status === 0, "policy-backed cold plan should complete");
  const policyPlan = JSON.parse(policyPlanRun.stdout);
  assert(policyPlan.recommendation.runner === "gemini", "policy-backed cold plan should use preferred runner order");
  assert(policyPlan.policy.source === "file", "policy-backed plan should report file policy source");

  const smokeOnlyRoot = join(tempRoot, "smoke-only");
  await mkdir(smokeOnlyRoot, { recursive: true });
  run("git", ["init"], smokeOnlyRoot);
  await writeFile(join(smokeOnlyRoot, "README.md"), "# Smoke Only\n", "utf8");
  run("git", ["add", "README.md"], smokeOnlyRoot);
  run("git", ["commit", "-m", "initial"], smokeOnlyRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(smokeOnlyRoot, "rux.policy.json"), JSON.stringify({
    schema_version: 1,
    preferred_runner_order: ["codex", "gemini", "claude"],
    default_roster: "solo",
    parallel_provider_cli_runs: false,
    provider_auth: "inherit_cli_environment",
    transcript_export_default: "omit",
    self_modification: "proposal_only"
  }, null, 2), "utf8");
  const smokeOnlyGemini = spawnSync("node", [cliPath, "provider-smoke", "--runner", "gemini", "--allow-dirty", "--cwd", smokeOnlyRoot], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(smokeOnlyGemini.status === 0, "smoke-only gemini provider smoke should complete");
  const smokeOnlyGeminiSummary = JSON.parse(smokeOnlyGemini.stdout);
  const smokeOnlyCodex = spawnSync("node", [cliPath, "provider-smoke", "--runner", "codex", "--allow-dirty", "--cwd", smokeOnlyRoot], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(smokeOnlyCodex.status === 0, "smoke-only codex provider smoke should complete");
  const smokeOnlyCodexSummary = JSON.parse(smokeOnlyCodex.stdout);
  const smokeFallbackPlan = JSON.parse(run("node", [
    cliPath,
    "plan",
    "update docs",
    "--cwd",
    smokeOnlyRoot
  ], repoRoot, {
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  }).stdout);
  assert(smokeFallbackPlan.runner_source === "provider_smoke_fallback", "smoke-only plan should use provider-smoke fallback");
  assert(smokeFallbackPlan.recommendation.runner === "codex", "provider-smoke fallback should respect policy runner order");
  const smokeOnlyProposal = JSON.parse(run("node", [cliPath, "propose", "--cwd", smokeOnlyRoot]).stdout);
  assert(smokeOnlyProposal.findings.some((finding) => finding.title === "Capture a labeled provider task before routing"), "smoke-only proposal should distinguish adapter readiness from task quality");
  assert(smokeOnlyProposal.findings.some((finding) => finding.category === "release"), "smoke-only proposal should surface release blockers");
  assert(smokeOnlyProposal.release.ready === false, "smoke-only proposal should include release readiness");
  assert(smokeOnlyProposal.release.blockers.includes("real_provider_task_evidence"), "smoke-only proposal should include task-evidence release blocker");
  assert(smokeOnlyProposal.release.blocker_summary.one_time.includes("real_provider_task_evidence"), "smoke-only proposal should classify first task evidence as one-time");
  assert(smokeOnlyProposal.cited_run_ids.includes(smokeOnlyGeminiSummary.id), "smoke-only proposal should cite gemini smoke evidence");
  assert(smokeOnlyProposal.cited_run_ids.includes(smokeOnlyCodexSummary.id), "smoke-only proposal should cite codex smoke evidence");
  const smokeOnlyStatus = JSON.parse(run("node", [cliPath, "status", "--cwd", smokeOnlyRoot], repoRoot, {
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  }).stdout);
  assert(smokeOnlyStatus.evidence.live_provider_task_runs === 0, "smoke-only status should not count provider-smoke as task evidence");
  assert(smokeOnlyStatus.evidence.provider_smoke_runs === 2, "smoke-only status should count provider-smoke separately");
  assert(smokeOnlyStatus.next_capture.needed === true, "smoke-only status should still ask for task evidence");
  assert(smokeOnlyStatus.next_capture.runner === "codex", "smoke-only status should respect policy order for provider-smoke fallback");
  assert(smokeOnlyStatus.next_capture.runner_source === "provider_smoke_fallback", "smoke-only status should label smoke-backed runner choice");
  assert(smokeOnlyStatus.next_capture.provider_call_required === true, "smoke-only status should disclose provider-call boundary");
  assert(smokeOnlyStatus.next_capture.writes_ledger === true, "smoke-only status should disclose ledger write boundary");
  assert(smokeOnlyStatus.next_capture.human_review_required === true, "smoke-only status should disclose review boundary");
  assert(smokeOnlyStatus.next_capture.command.includes("--runner codex"), "smoke-only status should include a provider task command template");
  assert(smokeOnlyStatus.next_actions.some((action) => action.includes("first routing-eligible real provider task")), "smoke-only status should ask for real provider task evidence");
  assert(smokeOnlyStatus.latest_runs[0].task_summary && !smokeOnlyStatus.latest_runs[0].task_summary.includes("\n"), "status latest runs should include one-line task summary");
  const smokeOnlyCodexStatus = smokeOnlyStatus.provider_smoke.find((smoke) => smoke.runner === "codex");
  const smokeOnlyGeminiStatus = smokeOnlyStatus.provider_smoke.find((smoke) => smoke.runner === "gemini");
  assert(smokeOnlyCodexStatus.latest_attempt_run_id === smokeOnlyCodexSummary.id, "status should expose the latest codex provider-smoke attempt run id");
  assert(smokeOnlyGeminiStatus.latest_attempt_run_id === smokeOnlyGeminiSummary.id, "status should expose the latest gemini provider-smoke attempt run id");
  assert(smokeOnlyCodexStatus.attempt_chain.includes(smokeOnlyCodexSummary.id), "status should expose the codex provider-smoke attempt chain");
  assert(smokeOnlyGeminiStatus.attempt_chain.includes(smokeOnlyGeminiSummary.id), "status should expose the gemini provider-smoke attempt chain");
  const smokeOnlyReleaseCheck = JSON.parse(run("node", [cliPath, "release-check", "--cwd", smokeOnlyRoot]).stdout);
  assert(smokeOnlyReleaseCheck.gates.find((gate) => gate.name === "real_provider_task_evidence")?.ok === false, "release-check should not treat provider-smoke as task evidence");

  const probeOnlyRoot = join(tempRoot, "probe-only");
  await mkdir(probeOnlyRoot, { recursive: true });
  run("git", ["init"], probeOnlyRoot);
  await writeFile(join(probeOnlyRoot, "README.md"), "# Probe Only\n", "utf8");
  run("git", ["add", "README.md"], probeOnlyRoot);
  run("git", ["commit", "-m", "initial"], probeOnlyRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(probeOnlyRoot, "rux.policy.json"), JSON.stringify({
    schema_version: 1,
    preferred_runner_order: ["codex", "gemini", "claude"],
    default_roster: "solo",
    parallel_provider_cli_runs: false,
    provider_auth: "inherit_cli_environment",
    transcript_export_default: "omit",
    self_modification: "proposal_only"
  }, null, 2), "utf8");
  const probeOnlyRun = spawnSync("node", [
    cliPath,
    "run",
    "probe-only release guard",
    "--runner",
    "codex",
    "--allow-dirty",
    "--purpose",
    "probe",
    "--check",
    "node --version",
    "--cwd",
    probeOnlyRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(probeOnlyRun.status === 0, "probe-only mocked codex run should complete");
  const probeOnlyStatus = JSON.parse(run("node", [cliPath, "status", "--cwd", probeOnlyRoot], repoRoot, {
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  }).stdout);
  assert(probeOnlyStatus.evidence.eligible_runs === 0, "probe-only status should ignore probes as task evidence by default");
  const probeOnlyReleaseCheck = JSON.parse(run("node", [cliPath, "release-check", "--cwd", probeOnlyRoot]).stdout);
  assert(probeOnlyReleaseCheck.gates.find((gate) => gate.name === "real_provider_task_evidence")?.ok === false, "release-check should not treat probes as task evidence by default");

  const mutatingOnlyRoot = join(tempRoot, "mutating-only");
  await mkdir(mutatingOnlyRoot, { recursive: true });
  run("git", ["init"], mutatingOnlyRoot);
  await writeFile(join(mutatingOnlyRoot, "README.md"), "# Mutating Only\n", "utf8");
  run("git", ["add", "README.md"], mutatingOnlyRoot);
  run("git", ["commit", "-m", "initial"], mutatingOnlyRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(mutatingOnlyRoot, "rux.policy.json"), JSON.stringify({
    schema_version: 1,
    preferred_runner_order: ["codex", "gemini", "claude"],
    default_roster: "solo",
    parallel_provider_cli_runs: false,
    provider_auth: "inherit_cli_environment",
    transcript_export_default: "omit",
    self_modification: "proposal_only"
  }, null, 2), "utf8");
  const mutatingOnlyRun = spawnSync("node", [
    cliPath,
    "run",
    "codex release evidence mutation guard",
    "--runner",
    "codex",
    "--allow-dirty",
    "--cwd",
    mutatingOnlyRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(mutatingOnlyRun.status === 0, "mutating-only mocked codex run should complete");
  const mutatingOnlySummary = JSON.parse(mutatingOnlyRun.stdout);
  JSON.parse(run("node", [
    cliPath,
    "check",
    mutatingOnlySummary.id,
    "--command",
    "node -e \"require('node:fs').writeFileSync('release-mutated.txt','changed')\"",
    "--cwd",
    mutatingOnlyRoot
  ]).stdout);
  const mutatingOnlyReleaseCheck = JSON.parse(run("node", [cliPath, "release-check", "--cwd", mutatingOnlyRoot]).stdout);
  assert(mutatingOnlyReleaseCheck.gates.find((gate) => gate.name === "real_provider_task_evidence")?.ok === false, "release-check should not accept mutating checks as task evidence");
  assert(mutatingOnlyReleaseCheck.next_actions.some((action) => action.includes("routing-eligible live provider task")), "release-check should ask for routing-eligible provider task evidence");

  const coldExport = JSON.parse(run("node", [cliPath, "export", "--cwd", tempRoot]).stdout);
  assert(coldExport.runs.length === 0, "cold export should return no runs");
  assert(coldExport.counts.exported_runs === 0, "cold export should report zero exported runs");
  assert(coldExport.include_transcripts === false, "export should omit transcripts by default");
  assert(!existsSync(join(tempRoot, ".rux")), "export should remain read-only before the first run");

  const reclassificationRoot = join(tempRoot, "reclassification-fixtures");
  await mkdir(join(reclassificationRoot, ".rux", "ledger"), { recursive: true });
  const reclassificationCases = (await readFile(join(repoRoot, "tests", "fixtures", "reclassification.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  await writeFile(
    join(reclassificationRoot, ".rux", "ledger", "2026-06-10.jsonl"),
    `${reclassificationCases.map((fixture) => JSON.stringify(fixture.run)).join("\n")}\n`,
    "utf8"
  );
  for (const fixture of reclassificationCases) {
    const evalResult = JSON.parse(run("node", [cliPath, "eval", fixture.run.id, "--cwd", reclassificationRoot]).stdout);
    assert(fixture.run.schema_version === 1, `${fixture.case} should be a v1 compatibility fixture`);
    assert(evalResult.status === fixture.run.status, `${fixture.case} should preserve stored status`);
    assert(evalResult.status_reason === fixture.run.status_reason, `${fixture.case} should preserve stored status reason`);
    assert(evalResult.classifier_version === "read-classifier-2026-06-11", `${fixture.case} should expose classifier version`);
    assert(evalResult.effective_status === fixture.expected.effective_status, `${fixture.case} effective status should match fixture expectation`);
    assert(evalResult.effective_status_reason === fixture.expected.effective_status_reason, `${fixture.case} effective status reason should match fixture expectation`);
    assert(evalResult.routing.eligible === fixture.expected.routing_eligible, `${fixture.case} routing eligibility should use effective status`);
    if (fixture.expected.vacuous_check !== undefined) {
      assert(evalResult.signals.vacuous_checks === (fixture.expected.vacuous_check ? 1 : 0), `${fixture.case} should expose vacuous check count`);
      assert(evalResult.routing.blockers.includes("vacuous_check") === fixture.expected.vacuous_check, `${fixture.case} routing blockers should expose vacuous checks`);
    }
  }
  const reclassifiedShow = JSON.parse(run("node", [cliPath, "show", "20260610T100302Z-c99e1c12", "--cwd", reclassificationRoot]).stdout);
  assert(reclassifiedShow.run.status === "blocked", "show should keep stored status on the run object");
  assert(reclassifiedShow.run.effective_status === "ok", "show should expose effective status next to stored status");
  assert(reclassifiedShow.evaluation.signals.classifier_changed === true, "show evaluation should flag read-time reclassification");
  const reclassifiedExport = JSON.parse(run("node", [cliPath, "export", "--cwd", reclassificationRoot, "--run-id", "20260610T100302Z-c99e1c12"]).stdout);
  assert(reclassifiedExport.runs[0].status === "blocked", "export should preserve stored status");
  assert(reclassifiedExport.runs[0].effective_status === "ok", "export should expose effective status");
  const reclassificationRank = JSON.parse(run("node", [cliPath, "rank", "--cwd", reclassificationRoot]).stdout);
  assert(reclassificationRank.evidence.eligible_runs === 4, "rank should count the four changed-files provider_needs_input fixtures as eligible");
  const reclassificationSuggestion = JSON.parse(run("node", [cliPath, "suggest", "implement a feature", "--cwd", reclassificationRoot]).stdout);
  assert(reclassificationSuggestion.evidence.eligible_runs === 4, "suggest should consume effective labels for recommendation evidence");

  // suggest must match evidence on the effective (changed-file corrected) kind, not
  // the stored "docs" a run was mislabeled with before correction. The genuine
  // feature run is a distractor so same_kind is non-empty even on the old path:
  // pre-fix only the feature run matches (same_kind === 1); post-fix the corrected
  // docs-mislabel matches too (same_kind === 2).
  const effectiveKindRoot = join(tempRoot, "effective-kind-suggest");
  await mkdir(join(effectiveKindRoot, ".rux", "ledger"), { recursive: true });
  const eligibleCheck = [{ source: "run_check", command: "fixture-check", exit_code: 0, changed_files: [] }];
  const mislabeledDocsRun = {
    schema_version: 1, type: "run", id: "20260610T010101Z-codedocs1", purpose: "task_run",
    source: "live", confidence: "high", task: "update the readme docs",
    task_kind: "docs", task_kind_source: "legacy_inferred", task_kind_suggestion: null,
    runner: "codex", roster: "solo", role: "runner", status: "ok", status_reason: "completed",
    changed_files: ["src/feature.mjs"], write_scope: { allowed: [], violations: [] },
    checks: eligibleCheck, adapter: { runner: "codex", exit_code: 0, timed_out: false }
  };
  const genuineFeatureRun = {
    schema_version: 1, type: "run", id: "20260610T020202Z-feature01", purpose: "task_run",
    source: "live", confidence: "high", task: "implement a feature",
    task_kind: "feature", task_kind_source: "user", task_kind_suggestion: null,
    runner: "codex", roster: "solo", role: "runner", status: "ok", status_reason: "completed",
    changed_files: ["src/other.mjs"], write_scope: { allowed: [], violations: [] },
    checks: eligibleCheck, adapter: { runner: "codex", exit_code: 0, timed_out: false }
  };
  await writeFile(
    join(effectiveKindRoot, ".rux", "ledger", "2026-06-10.jsonl"),
    `${JSON.stringify(mislabeledDocsRun)}\n${JSON.stringify(genuineFeatureRun)}\n`,
    "utf8"
  );
  const effectiveKindSuggestion = JSON.parse(run("node", [cliPath, "suggest", "implement a feature", "--task-kind", "feature", "--cwd", effectiveKindRoot]).stdout);
  assert(effectiveKindSuggestion.evidence.same_kind_runs === 2, "suggest should match a mislabeled-docs code run on its effective feature kind, not its stored docs label");
  assert(effectiveKindSuggestion.recommendation.evidence_runs.includes("20260610T010101Z-codedocs1"), "suggest evidence runs should include the corrected mislabeled-docs run");
  assert(effectiveKindSuggestion.task_kind === "feature" && effectiveKindSuggestion.task_kind_source === "user", "explicit --task-kind should drive an authoritative user-sourced query kind");
  // Without --task-kind the query kind stays honestly unspecified rather than a keyword guess.
  const unspecifiedQuery = JSON.parse(run("node", [cliPath, "suggest", "update the readme docs", "--cwd", effectiveKindRoot]).stdout);
  assert(unspecifiedQuery.task_kind === "unspecified" && unspecifiedQuery.task_kind_source === "unspecified", "suggest without --task-kind should report an unspecified, non-fabricated query kind");
  assert(unspecifiedQuery.recommendation.reason.includes("unspecified"), "unspecified suggest should say it is using all eligible history");

  // The routing scorecard reads stamped routing reports plus the checks, verdicts,
  // and marks already on their linked runs. The fixture ledger carries one of each
  // interesting path, because the real ledger does not contain them all.
  const scorecardRoot = join(tempRoot, "routing-scorecard");
  await mkdir(join(scorecardRoot, ".rux", "ledger"), { recursive: true });
  const scorecardLedgerPath = join(scorecardRoot, ".rux", "ledger", "2026-06-20.jsonl");
  const scorecardFixture = await readFile(join(repoRoot, "tests", "fixtures", "routing-scorecard.jsonl"), "utf8");
  await writeFile(scorecardLedgerPath, scorecardFixture, "utf8");
  const scorecard = JSON.parse(run("node", [cliPath, "status", "--scorecard", "--cwd", scorecardRoot]).stdout);

  // A repo with no routing reports at all must still produce a usable, honest view.
  const emptyScorecardRoot = join(tempRoot, "routing-scorecard-empty");
  await mkdir(join(emptyScorecardRoot, ".rux", "ledger"), { recursive: true });
  const emptyScorecard = JSON.parse(run("node", [cliPath, "status", "--scorecard", "--cwd", emptyScorecardRoot]).stdout);
  assert(emptyScorecard.adherence.decisions === 0, "an empty ledger should score zero routing decisions");
  assert(emptyScorecard.adherence.adherence_rate === null, "adherence rate should be null rather than fabricated on an empty ledger");
  assert(emptyScorecard.divergence.test_set.win_rate === null, "divergence win-rate should be null rather than fabricated on an empty ledger");
  assert(emptyScorecard.regret.length === 0, "an empty ledger should report no regret cases");
  assert(emptyScorecard.kill_check.ready_to_judge === false, "an empty ledger should never be judgeable");

  assert(scorecard.view === "routing_scorecard", "status --scorecard should emit the routing scorecard view");
  assert(scorecard.window.start === "2026-06-12" && scorecard.window.end === "2026-09-12", "scorecard should default to the PROOF.md pre-registered window");
  assert(scorecard.coverage.routing_reports_total === 8, "scorecard should count every routing report in the ledger");
  assert(scorecard.coverage.routing_reports_outside_window === 1, "scorecard should keep out-of-window routing reports visible instead of dropping them");
  assert(scorecard.adherence.decisions === 7, "scorecard should score only in-window routing decisions");
  assert(scorecard.adherence.followed === 4 && scorecard.adherence.overridden === 2 && scorecard.adherence.unclear === 1, "scorecard adherence should split followed, overridden, and unparseable notes");
  assert(scorecard.adherence.adherence_rate === 0.6667, "scorecard adherence rate should exclude unparseable notes from the denominator");

  const decisionById = new Map(scorecard.decisions.map((decision) => [decision.run_id ?? decision.report_id, decision]));
  const followedDivergence = decisionById.get("20260620T090000Z-d1000001");
  assert(followedDivergence.decision_class === "divergence_followed", "a recommended handoff away from the in-session runner that was taken is a followed divergence");
  assert(followedDivergence.recommended_runner === "codex" && followedDivergence.in_session_runner === "claude", "note parsing should read the recommended runner nearest the recommendation, not the session runner named later");
  assert(followedDivergence.judgment === "win", "an accepted followed divergence should count as a win");
  const regretDivergence = decisionById.get("20260621T090000Z-d2000002");
  assert(regretDivergence.decision_class === "divergence_followed" && regretDivergence.judgment === "loss", "a followed divergence whose checks failed should count as a loss");
  const restatement = decisionById.get("20260622T090000Z-d3000003");
  assert(restatement.decision_class === "divergence_overridden" && restatement.restatement === true, "a continue-in-session override should be flagged as a restatement");
  const nonRestatement = decisionById.get("20260623T090000Z-d4000004");
  assert(nonRestatement.decision_class === "divergence_overridden" && nonRestatement.restatement === false, "an override with a substantive reason should not be flagged as a restatement");
  assert(nonRestatement.in_session_runner === "claude" && nonRestatement.in_session_source === "linked_run_after_override", "an override should take the in-session runner from the run the operator kept doing");
  const alignedDecision = decisionById.get("20260624T090000Z-d5000005");
  assert(alignedDecision.decision_class === "aligned_followed", "a continue-in-session recommendation that was followed is aligned, not a divergence");
  const unparseable = decisionById.get("20260625T090000Z-d6000006");
  assert(unparseable.decision_class === "unclassified", "a note with no recommendation or adherence wording must stay unclassified");
  assert(unparseable.parse_gaps.includes("recommended_runner_not_parsed") && unparseable.parse_gaps.includes("adherence_not_parsed"), "unclassified decisions should say what could not be parsed");
  const missingRun = decisionById.get("20260626T090000Z-missingrun");
  assert(missingRun.run_found === false && missingRun.judgment === "unjudged", "a routing report pointing at a missing run should be unjudged, not a win");
  assert(missingRun.parse_gaps.includes("linked_run_missing_from_ledger"), "a missing linked run should surface as a parse gap");

  assert(scorecard.divergence.test_set.size === 2, "the divergence test set should hold only followed divergences");
  assert(scorecard.divergence.test_set.win_rate === 0.5, "divergence win-rate should be judged on wins and losses only");
  assert(scorecard.divergence.test_set.run_ids.length === 2, "every divergence figure should cite run IDs");
  assert(scorecard.divergence.overridden.restatements === 1 && scorecard.divergence.overridden.non_restatements === 1, "overridden divergences should separate restatements from substantive overrides");
  assert(scorecard.divergence.overridden.non_restatement_outcomes.win_rate === 0, "the override comparison should use non-restatement overrides only");
  assert(scorecard.divergence.advantage.comparable === true && scorecard.divergence.advantage.delta === 0.5, "the kill-check comparison should report the divergence advantage over non-restatement overrides");
  assert(scorecard.divergence.unclassified.length === 2, "unclassified decisions should be listed, never silently dropped");
  assert(scorecard.divergence.assessment.includes("too thin"), "a two-decision test set should be labeled too thin to judge");

  assert(scorecard.regret.length === 2, "regret should list every decision whose linked run went badly");
  assert(scorecard.regret.every((item) => item.run_id), "every regret case should cite a run ID");
  assert(scorecard.regret.some((item) => item.outcome === "checks_failed") && scorecard.regret.some((item) => item.outcome === "human_rejected"), "regret should cover failed checks and rejected verdicts");

  const zeros = new Map(scorecard.standing_zeros.map((zero) => [zero.name, zero]));
  assert(zeros.get("live_claude_task_runs_ok").value === 1 && zeros.get("live_claude_task_runs_ok").met === false, "standing zeros should count completed live Claude task runs");
  assert(zeros.get("live_claude_task_runs_ok").run_ids.includes("20260620T100000Z-live0001"), "the live Claude standing zero should cite its run IDs");
  assert(zeros.get("lifecycle_marks").value === 1, "standing zeros should count lifecycle marks");
  assert(zeros.get("observed_model_metadata_share").value === 0.3333 && zeros.get("observed_model_metadata_share").met === false, "observed model metadata share should be a minority in the fixture");
  assert(zeros.get("new_run_verdict_coverage").value === 0.6667 && zeros.get("new_run_verdict_coverage").met === true, "verdict coverage at or above 60% should be met");
  assert(zeros.get("new_run_verdict_coverage").missing_run_ids.includes("20260621T090000Z-d2000002"), "verdict coverage should name the runs still missing a verdict");

  assert(scorecard.kill_check.ready_to_judge === false, "the kill check should not claim judgeability from a seven-decision single-repo ledger");
  assert(scorecard.kill_check.note.includes("never declares"), "the kill check should leave the null-result call to a human");

  const narrowedScorecard = JSON.parse(run("node", [
    cliPath,
    "status",
    "--scorecard",
    "--cwd",
    scorecardRoot,
    "--since",
    "2026-06-22",
    "--until",
    "2026-06-24"
  ]).stdout);
  assert(narrowedScorecard.adherence.decisions === 3, "--since/--until should narrow the scored decisions");
  assert(narrowedScorecard.window.source === "option", "an explicit window should say it came from options, not the pre-registration");

  const missingSinceValue = spawnSync("node", [cliPath, "status", "--scorecard", "--cwd", scorecardRoot, "--since"], { encoding: "utf8" });
  assert(missingSinceValue.status !== 0, "--since without a date should fail");
  assert(missingSinceValue.stderr.includes("--since needs a date"), "--since without a date should say what it needs");

  const scorecardTty = spawnSync("node", [cliPath, "status", "--scorecard", "--cwd", scorecardRoot], {
    encoding: "utf8",
    env: { ...process.env, RUX_FORCE_TTY: "1" }
  });
  assert(scorecardTty.status === 0, "forced TTY scorecard should complete");
  assert(!isJsonOutput(scorecardTty.stdout), "forced TTY scorecard should print human-readable output");
  assert(scorecardTty.stdout.includes("Rux routing scorecard"), "human scorecard should name the surface");
  assert(scorecardTty.stdout.includes("20260621T090000Z-d2000002"), "human scorecard should cite run IDs inline");
  assert(scorecardTty.stdout.includes("Regret cases"), "human scorecard should show regret cases");
  assert(scorecardTty.stdout.includes("check or verdict"), "human scorecard should state the instrumented-decision definition from PROOF.md");

  const scorecardLedgerAfter = await readFile(scorecardLedgerPath, "utf8");
  assert(scorecardLedgerAfter === scorecardFixture, "the scorecard path must not write to the ledger");
  assert(!existsSync(join(scorecardRoot, ".rux", "reports")), "the scorecard path must not create report files");

  const runResult = run("node", [
    cliPath,
    "run",
    "record a fake run in a temp repo",
    "--runner",
    "fake",
    "--cwd",
    tempRoot,
    "--check",
    "node --version"
  ]);
  const summary = JSON.parse(runResult.stdout);
  assert(summary.schema_version === undefined, "run summaries should stay compact and not expose raw schema version");
  assert(summary.status === "ok", "fake run should be ok");
  assert(summary.status_reason === "completed", "fake run should classify completed status");
  assert(summary.runner === "fake", "fake run should use fake runner");
  assert(summary.adapter.command === "(built-in)", "fake run should expose built-in adapter metadata");
  assert(summary.adapter.exit_code === 0, "fake adapter metadata should expose exit code");
  assert(summary.adapter.stderr_signal.level === "none", "fake adapter metadata should classify empty stderr");
  assert(summary.adapter.metadata_sources.model === "not_observed", "fake adapter metadata should not invent model source");
  assert(summary.changed_files.length === 0, "fake run in clean repo should not report changed files");
  assert(summary.checks[0]?.source === "run_check", "inline run checks should record their source");
  assert(summary.repo.before.inside_work_tree === true, "run summary should include repo snapshot before the run");
  assert(summary.repo.after.inside_work_tree === true, "run summary should include repo snapshot after the run");
  assert(summary.repo.before.head === summary.repo.after.head, "unchanged fake run should keep the same git head");
  assert(summary.replay.available === true, "run summary should include replay metadata");
  assert(summary.replay.command.includes("rux run"), "run summary should include replay command");
  assert(summary.replay.command.includes("--check 'node --version'"), "run replay command should include captured check command");
  assert(summary.replay.provider_call_required === false, "fake run replay should not imply a provider call");
  assert(existsSync(join(tempRoot, summary.transcript_path)), "transcript should exist");

  const forcedTtyStatus = spawnSync("node", [
    cliPath,
    "status",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, RUX_FORCE_TTY: "1", PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(forcedTtyStatus.status === 0, "forced TTY status should complete");
  assert(!isJsonOutput(forcedTtyStatus.stdout), "forced TTY status should print human-readable output by default");
  assert(forcedTtyStatus.stdout.includes("Rux"), "forced TTY status should identify the Rux status surface");
  const forcedTtyJsonStatus = JSON.parse(run("node", [
    cliPath,
    "status",
    "--cwd",
    tempRoot,
    "--json"
  ], repoRoot, {
    RUX_FORCE_TTY: "1",
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  }).stdout);
  assert(forcedTtyJsonStatus.ledger.runs >= 1, "--json should force JSON output even when the TTY seam is enabled");
  const forcedTtyJsonRun = JSON.parse(run("node", [
    cliPath,
    "run",
    "forced tty json run",
    "--runner",
    "fake",
    "--cwd",
    tempRoot,
    "--json"
  ], repoRoot, {
    RUX_FORCE_TTY: "1"
  }).stdout);
  assert(forcedTtyJsonRun.runner === "fake", "run --json should force JSON output when the TTY seam is enabled");
  const forcedTtyJsonRunners = JSON.parse(run("node", [
    cliPath,
    "runners",
    "--json"
  ], repoRoot, {
    RUX_FORCE_TTY: "1"
  }).stdout);
  assert(forcedTtyJsonRunners.some((item) => item.name === "fake"), "runners --json should force JSON output when the TTY seam is enabled");
  const forcedTtyJsonList = JSON.parse(run("node", [
    cliPath,
    "ls",
    "--cwd",
    tempRoot,
    "--json"
  ], repoRoot, {
    RUX_FORCE_TTY: "1"
  }).stdout);
  assert(forcedTtyJsonList.some((item) => item.id === summary.id), "ls --json should force structured output when the TTY seam is enabled");
  const forcedTtyPlan = run("node", [
    cliPath,
    "plan",
    "fix the failing smoke test",
    "--cwd",
    tempRoot,
    "--check",
    "node --version"
  ], repoRoot, {
    RUX_FORCE_TTY: "1",
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  }).stdout;
  assert(forcedTtyPlan.includes("Rux plan"), "forced TTY plan should identify the plan surface");
  assert(forcedTtyPlan.includes("Runner:"), "forced TTY plan should show the selected runner");
  assert(forcedTtyPlan.includes("Roster:"), "forced TTY plan should show the selected roster");
  assert(forcedTtyPlan.includes("Command"), "forced TTY plan should show the runnable command");
  const forcedTtySuggest = run("node", [
    cliPath,
    "suggest",
    "fix the failing smoke test",
    "--cwd",
    tempRoot
  ], repoRoot, {
    RUX_FORCE_TTY: "1"
  }).stdout;
  assert(forcedTtySuggest.includes("Rux suggest"), "forced TTY suggest should identify the suggest surface");
  assert(forcedTtySuggest.includes("Recommendation:"), "forced TTY suggest should show the recommendation");
  assert(forcedTtySuggest.includes("Evidence runs:") || forcedTtySuggest.includes("Ignored:"), "forced TTY suggest should show evidence context");
  const forcedTtyRank = run("node", [
    cliPath,
    "rank",
    "--cwd",
    tempRoot
  ], repoRoot, {
    RUX_FORCE_TTY: "1"
  }).stdout;
  assert(forcedTtyRank.includes("Rux rank"), "forced TTY rank should identify the rank surface");
  assert(forcedTtyRank.includes("Evidence:"), "forced TTY rank should summarize evidence");
  const forcedTtyDoctor = run("node", [
    cliPath,
    "doctor",
    "--cwd",
    tempRoot
  ], repoRoot, {
    RUX_FORCE_TTY: "1",
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  }).stdout;
  assert(forcedTtyDoctor.includes("Rux doctor"), "forced TTY doctor should identify the doctor surface");
  assert(forcedTtyDoctor.includes("Node:"), "forced TTY doctor should show Node health");
  assert(forcedTtyDoctor.includes("Runners:"), "forced TTY doctor should show runner availability");
  const forcedTtyExport = run("node", [
    cliPath,
    "export",
    "--cwd",
    tempRoot,
    "--limit",
    "1"
  ], repoRoot, {
    RUX_FORCE_TTY: "1"
  }).stdout;
  assert(forcedTtyExport.includes("Rux export"), "forced TTY export should identify the export surface");
  assert(forcedTtyExport.includes("Runs:"), "forced TTY export should summarize exported runs");
  assert(forcedTtyExport.includes("Transcripts:"), "forced TTY export should show transcript inclusion state");

  const inlineMutatingCheckRun = JSON.parse(run("node", [
    cliPath,
    "run",
    "inline mutating check attribution",
    "--runner",
    "fake",
    "--cwd",
    tempRoot,
    "--check",
    "node -e \"require('node:fs').writeFileSync('inline-check-mutated.txt','changed')\""
  ]).stdout);
  assert(inlineMutatingCheckRun.changed_files.length === 0, "inline check mutations should not be attributed to the provider run");
  assert(inlineMutatingCheckRun.checks[0]?.changed_files.includes("inline-check-mutated.txt"), "inline run checks should capture files changed by the check");

  const unlinkedSuccessReport = spawnSync("node", [
    cliPath,
    "report",
    "unlinked success should be rejected",
    "--kind",
    "success",
    "--cwd",
    tempRoot
  ], { encoding: "utf8" });
  assert(unlinkedSuccessReport.status !== 0, "success reports should require run linkage or an explicit no-run reason");
  assert(unlinkedSuccessReport.stderr.includes("report --kind success requires"), "unlinked success report should explain the linkage requirement");

  const missingRunSuccessReport = spawnSync("node", [
    cliPath,
    "report",
    "missing run success should be rejected",
    "--kind",
    "success",
    "--run-id",
    "missing-run-id",
    "--cwd",
    tempRoot
  ], { encoding: "utf8" });
  assert(missingRunSuccessReport.status !== 0, "success reports should reject nonexistent run links");
  assert(missingRunSuccessReport.stderr.includes("requires an existing run"), "missing success run links should explain the existence requirement");

  const failedRunForReport = JSON.parse(run("node", [
    cliPath,
    "run",
    "failed run should not become success report",
    "--runner",
    "fake",
    "--cwd",
    tempRoot,
    "--check",
    "node -e \"process.exit(7)\""
  ]).stdout);
  assert(failedRunForReport.status === "failed", "test setup should create a failed run");
  const failedRunSuccessReport = spawnSync("node", [
    cliPath,
    "report",
    "failed run success should be rejected",
    "--kind",
    "success",
    "--run-id",
    failedRunForReport.id,
    "--cwd",
    tempRoot
  ], { encoding: "utf8" });
  assert(failedRunSuccessReport.status !== 0, "success reports should reject failed run links");
  assert(failedRunSuccessReport.stderr.includes("requires a successful run"), "failed success run links should explain the successful-run requirement");

  const noRunSuccessReport = JSON.parse(run("node", [
    cliPath,
    "report",
    "success was verified outside the local Rux ledger",
    "--kind",
    "success",
    "--no-run",
    "external system verified the shipped outcome",
    "--cwd",
    tempRoot
  ]).stdout);
  assert(noRunSuccessReport.kind === "success", "success reports should allow an explicit no-run reason");
  assert(noRunSuccessReport.run_id === null, "success --no-run should stay unlinked");
  assert(noRunSuccessReport.no_run_reason === "external system verified the shipped outcome", "success --no-run should preserve its reason");

  const unlinkedUxReport = spawnSync("node", [
    cliPath,
    "report",
    "the report flow hint is helpful",
    "--kind",
    "ux",
    "--cwd",
    tempRoot
  ], { encoding: "utf8" });
  assert(unlinkedUxReport.status === 0, "non-success reports should stay low-friction without linkage");
  assert(unlinkedUxReport.stderr.includes("nudge: this report is unlinked"), "unlinked non-success reports should print a stderr nudge");
  const unlinkedUxReportEvent = JSON.parse(unlinkedUxReport.stdout);
  assert(unlinkedUxReportEvent.kind === "ux", "unlinked ux report should be recorded");
  assert(unlinkedUxReportEvent.run_id === null, "unlinked ux report should not invent a run link");

  const reportResult = JSON.parse(run("node", [
    cliPath,
    "report",
    "The fake runner made smoke feedback easy to capture",
    "--kind",
    "success",
    "--run-id",
    summary.id,
    "--command",
    summary.replay.command,
    "--note",
    "General dogfood feedback should not require a failure.",
    "--source-repo",
    tempRoot,
    "--cwd",
    tempRoot
  ]).stdout);
  assert(reportResult.type === "report", "report should append a report event");
  assert(reportResult.kind === "success", "report should support non-failure feedback kinds");
  assert(reportResult.run_id === summary.id, "report should preserve optional run link");
  assert(reportResult.run_found === true, "report should say whether the linked run exists");
  assert(reportResult.report_path.endsWith(".md"), "report should write a markdown report");
  assert(existsSync(join(tempRoot, reportResult.report_path)), "report markdown should exist");
  const reportMarkdown = await readFile(join(tempRoot, reportResult.report_path), "utf8");
  assert(reportMarkdown.includes("# Rux Feedback Report"), "report markdown should have a clear heading");
  assert(reportMarkdown.includes("Kind: success"), "report markdown should include feedback kind");
  assert(reportMarkdown.includes("This is raw feedback."), "report markdown should explain the guardrail");
  const reportLinkedShow = JSON.parse(run("node", [cliPath, "show", summary.id, "--cwd", tempRoot]).stdout);
  assert(reportLinkedShow.reports.some((report) => report.id === reportResult.id), "show should surface reports linked to a run");
  assert(reportLinkedShow.evaluation.signals.linked_success_reports === 1, "eval should count linked success reports without making them routing labels");
  const reportLinkedEval = JSON.parse(run("node", [cliPath, "eval", summary.id, "--cwd", tempRoot]).stdout);
  assert(reportLinkedEval.signals.linked_reports_total === 1, "eval command should surface linked report counts");
  const reportLinkedExport = JSON.parse(run("node", [cliPath, "export", "--cwd", tempRoot, "--run-id", summary.id]).stdout);
  assert(reportLinkedExport.runs[0].reports.some((report) => report.id === reportResult.id), "export should preserve reports linked to a run");

  const reportRecordRoot = join(tempRoot, "report-record-link");
  await mkdir(reportRecordRoot, { recursive: true });
  run("git", ["init"], reportRecordRoot);
  await writeFile(join(reportRecordRoot, "README.md"), "# Report Record Link\n", "utf8");
  run("git", ["add", "README.md"], reportRecordRoot);
  run("git", ["commit", "-m", "initial"], reportRecordRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  const reportRecordBaseline = JSON.parse(run("node", [
    cliPath,
    "record",
    "--start",
    "start report-linked success session",
    "--runner",
    "codex",
    "--cwd",
    reportRecordRoot
  ]).stdout);
  await writeFile(join(reportRecordRoot, "shipped.txt"), "shipped\n", "utf8");
  const inlineRecordReport = JSON.parse(run("node", [
    cliPath,
    "report",
    "report-linked success shipped",
    "--kind",
    "success",
    "--record",
    "--runner",
    "codex",
    "--check",
    "node --version",
    "--write-scope",
    "shipped.txt",
    "--cwd",
    reportRecordRoot
  ]).stdout);
  assert(inlineRecordReport.kind === "success", "success --record should still record a success report");
  assert(inlineRecordReport.run_id, "success --record should link the report to a minted manual run");
  assert(inlineRecordReport.run_found === true, "success --record should mark the minted run as found");
  const inlineRecordShow = JSON.parse(run("node", [cliPath, "show", inlineRecordReport.run_id, "--cwd", reportRecordRoot]).stdout);
  assert(inlineRecordShow.run.source === "manual", "success --record should mint a manual run");
  assert(inlineRecordShow.run.session_baseline.id === reportRecordBaseline.id, "success --record should use the open record baseline");
  assert(inlineRecordShow.run.changed_files.includes("shipped.txt"), "success --record should capture files changed since the baseline");
  assert(inlineRecordShow.run.checks[0]?.source === "record_check", "success --record should preserve manual record checks");
  assert(inlineRecordShow.reports.some((report) => report.id === inlineRecordReport.id), "show should surface success reports created with --record");

  const failedInlineRecordReport = spawnSync("node", [
    cliPath,
    "report",
    "failed report-linked success should be rejected",
    "--kind",
    "success",
    "--record",
    "--runner",
    "codex",
    "--check",
    "node -e \"process.exit(7)\"",
    "--cwd",
    reportRecordRoot
  ], { encoding: "utf8" });
  assert(failedInlineRecordReport.status !== 0, "success --record should reject failed inline manual records");
  assert(failedInlineRecordReport.stderr.includes("requires a successful run"), "failed inline success records should explain the successful-run requirement");

  const reportRecordDirBaseline = JSON.parse(run("node", [
    cliPath,
    "record",
    "--start",
    "start report-linked directory session",
    "--runner",
    "codex",
    "--cwd",
    reportRecordRoot
  ]).stdout);
  await mkdir(join(reportRecordRoot, "release-notes", "nested"), { recursive: true });
  await writeFile(join(reportRecordRoot, "release-notes", "one.md"), "one\n", "utf8");
  await writeFile(join(reportRecordRoot, "release-notes", "nested", "two.md"), "two\n", "utf8");
  const inlineRecordDirectoryReport = JSON.parse(run("node", [
    cliPath,
    "report",
    "report-linked directory shipped",
    "--kind",
    "success",
    "--record",
    "--runner",
    "codex",
    "--write-scope",
    "release-notes",
    "--cwd",
    reportRecordRoot
  ]).stdout);
  const inlineRecordDirectoryShow = JSON.parse(run("node", [cliPath, "show", inlineRecordDirectoryReport.run_id, "--cwd", reportRecordRoot]).stdout);
  assert(inlineRecordDirectoryShow.run.session_baseline.id === reportRecordDirBaseline.id, "success --record should use the directory session baseline");
  assert(inlineRecordDirectoryShow.run.changed_files.includes("release-notes/one.md"), "success --record should expand untracked top-level files");
  assert(inlineRecordDirectoryShow.run.changed_files.includes("release-notes/nested/two.md"), "success --record should expand untracked nested files");
  assert(!inlineRecordDirectoryShow.run.changed_files.includes("release-notes"), "success --record should not report the untracked directory itself");

  run("node", [
    cliPath,
    "verdict",
    summary.id,
    "accepted",
    "--note",
    "smoke passed",
    "--cwd",
    tempRoot
  ]);

  const showResult = run("node", [cliPath, "show", summary.id, "--cwd", tempRoot]);
  const shown = JSON.parse(showResult.stdout);
  assert(shown.run.id === summary.id, "show should return the run");
  assert(shown.run.schema_version === 2, "new run records should use schema version 2");
  assert(!Object.hasOwn(shown.run, "human_verdict"), "new run records should not write dead inline human_verdict fields");
  assert(shown.run.replay.command === summary.replay.command, "show should expose replay metadata");
  assert(shown.run.adapter.command === "(built-in)", "show should expose adapter metadata");
  assert(shown.verdicts[0]?.verdict === "accepted", "show should include verdict");
  assert(shown.evaluation.outcome.label === "human_accepted", "show evaluation should include human outcome label");

  const fakeOutcome = JSON.parse(run("node", [cliPath, "outcome", summary.id, "--cwd", tempRoot]).stdout);
  assert(fakeOutcome.outcome.label === "human_accepted", "outcome should prefer human verdicts");
  assert(fakeOutcome.outcome.risks.includes("fake_runner"), "outcome should surface fake runner risk");
  assert(fakeOutcome.outcome.checks.total === 1, "outcome should include captured check count");
  const fakeEval = JSON.parse(run("node", [cliPath, "eval", summary.id, "--cwd", tempRoot]).stdout);
  assert(fakeEval.signals.repo_snapshot === true, "eval should expose repo snapshot availability");
  assert(Number.isInteger(fakeEval.signals.repo_dirty_before), "eval should include repo dirty count before the run");
  assert(fakeEval.status_reason === "completed", "eval should expose status reason");
  assert(fakeEval.signals.adapter_exit_code === 0, "eval should expose adapter exit code");
  assert(fakeEval.signals.adapter_stderr_signal === "none", "eval should expose adapter stderr signal");

  const manualRecordRoot = join(tempRoot, "manual-record");
  await mkdir(manualRecordRoot, { recursive: true });
  run("git", ["init"], manualRecordRoot);
  await writeFile(join(manualRecordRoot, "README.md"), "# Manual Record\n", "utf8");
  run("git", ["add", "README.md"], manualRecordRoot);
  run("git", ["commit", "-m", "initial"], manualRecordRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(manualRecordRoot, "manual-change.txt"), "manual\n", "utf8");
  const manualRecord = JSON.parse(run("node", [
    cliPath,
    "record",
    "implemented work in the current Codex session",
    "--runner",
    "codex",
    "--cwd",
    manualRecordRoot,
    "--check",
    "node --version",
    "--write-scope",
    "manual-change.txt",
    "--note",
    "current session did the work"
  ]).stdout);
  assert(manualRecord.source === "manual", "manual record should mark source");
  assert(manualRecord.confidence === "high", "manual record should be high confidence when checked/reviewable");
  assert(manualRecord.status === "ok", "checked manual record should be ok when the check passes");
  assert(manualRecord.status_reason === "manual_recorded", "manual record should expose manual status reason");
  assert(manualRecord.runner === "codex", "manual record should preserve the claimed runner");
  assert(manualRecord.adapter.command === null, "manual record should not invent adapter command");
  assert(manualRecord.adapter.notes[0].includes("Manual/current-session"), "manual record should preserve adapter uncertainty");
  assert(manualRecord.changed_files.includes("manual-change.txt"), "manual record should capture current dirty files as changed files");
  assert(manualRecord.write_scope.violations.length === 0, "manual write scope should pass for declared files");
  assert(manualRecord.checks[0]?.source === "record_check", "manual record checks should be source-labeled");
  assert(manualRecord.replay.available === false, "manual record should not pretend to replay original work");
  assert(manualRecord.replay.provider_call_required === false, "manual record replay should not require provider call");
  const manualEval = JSON.parse(run("node", [cliPath, "eval", manualRecord.id, "--cwd", manualRecordRoot]).stdout);
  assert(manualEval.routing.eligible === true, "checked manual records should be recommendation-eligible");
  assert(manualEval.routing.score === 0.375, "manual check-backed records should be down-weighted");
  assert(manualEval.routing.score_basis === "manual:checks_passed", "manual score basis should be explicit");
  assert(manualEval.outcome.risks.includes("manual_capture"), "manual outcome should show manual capture risk");
  assert(!manualEval.outcome.risks.includes("not_live"), "manual records should not be treated like imports");
  const manualSuggestion = JSON.parse(run("node", [cliPath, "suggest", "manual work", "--cwd", manualRecordRoot]).stdout);
  assert(manualSuggestion.recommendation.runner === "codex", "manual evidence should guide local recommendation");
  assert(manualSuggestion.recommendation.stats.manual_runs === 1, "suggest should label manual supporting evidence");
  assert(manualSuggestion.recommendation.stats.adapter_observed_runs === 0, "suggest should label missing adapter-observed support");
  const manualStatus = JSON.parse(run("node", [cliPath, "status", "--cwd", manualRecordRoot]).stdout);
  assert(manualStatus.evidence.manual_task_runs === 1, "status should count manual task runs");
  assert(manualStatus.evidence.live_provider_task_runs === 0, "status should keep manual separate from live provider task runs");
  const manualReleaseCheck = JSON.parse(run("node", [cliPath, "release-check", "--cwd", manualRecordRoot]).stdout);
  assert(manualReleaseCheck.gates.find((gate) => gate.name === "real_provider_task_evidence")?.ok === false, "manual records should not satisfy release provider task evidence");

  const manualVerdictRoot = join(tempRoot, "manual-record-verdict");
  await mkdir(manualVerdictRoot, { recursive: true });
  run("git", ["init"], manualVerdictRoot);
  await writeFile(join(manualVerdictRoot, "README.md"), "# Manual Record Verdict\n", "utf8");
  run("git", ["add", "README.md"], manualVerdictRoot);
  run("git", ["commit", "-m", "initial"], manualVerdictRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(manualVerdictRoot, "verdict-change.txt"), "manual verdict\n", "utf8");
  const manualRecordWithVerdict = JSON.parse(run("node", [
    cliPath,
    "record",
    "manual record with inline verdict",
    "--runner",
    "codex",
    "--cwd",
    manualVerdictRoot,
    "--check",
    "node --version",
    "--verdict",
    "partial"
  ]).stdout);
  assert(manualRecordWithVerdict.source === "manual", "record --verdict should still return the manual record summary");
  const manualVerdictShow = JSON.parse(run("node", [cliPath, "show", manualRecordWithVerdict.id, "--cwd", manualVerdictRoot]).stdout);
  assert(manualVerdictShow.verdicts[0]?.verdict === "partial", "record --verdict should append a verdict event");
  assert(manualVerdictShow.evaluation.latest_verdict.verdict === "partial", "record --verdict should make the verdict visible to eval/show");

  const markNudgeRoot = join(tempRoot, "mark-nudge");
  await mkdir(markNudgeRoot, { recursive: true });
  run("git", ["init"], markNudgeRoot);
  await writeFile(join(markNudgeRoot, "README.md"), "# Mark Nudge\n", "utf8");
  run("git", ["add", "README.md"], markNudgeRoot);
  run("git", ["commit", "-m", "initial"], markNudgeRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(markNudgeRoot, "shared.txt"), "first overlap\n", "utf8");
  const firstOverlapRecord = JSON.parse(run("node", [
    cliPath,
    "record",
    "first overlapping current-session work",
    "--runner",
    "codex",
    "--cwd",
    markNudgeRoot,
    "--check",
    "node --version"
  ]).stdout);
  await writeFile(join(markNudgeRoot, "shared.txt"), "second overlap\n", "utf8");
  const secondOverlapRecord = JSON.parse(run("node", [
    cliPath,
    "record",
    "second overlapping current-session work",
    "--runner",
    "codex",
    "--cwd",
    markNudgeRoot,
    "--check",
    "node --version"
  ]).stdout);
  assert(secondOverlapRecord.mark_nudges[0]?.run_id === firstOverlapRecord.id, "record should nudge when changed files overlap a recent unmarked run");
  assert(secondOverlapRecord.mark_nudges[0]?.overlap_files.includes("shared.txt"), "record mark nudge should name overlapping files");
  const markNudgeStatus = JSON.parse(run("node", [cliPath, "status", "--cwd", markNudgeRoot]).stdout);
  assert(markNudgeStatus.mark_nudges.some((nudge) => nudge.run_id === firstOverlapRecord.id), "status should surface changed-file overlap mark nudges");

  const manualUntrackedDirRoot = join(tempRoot, "manual-untracked-dir");
  await mkdir(manualUntrackedDirRoot, { recursive: true });
  run("git", ["init"], manualUntrackedDirRoot);
  await writeFile(join(manualUntrackedDirRoot, "README.md"), "# Manual Untracked Directory\n", "utf8");
  run("git", ["add", "README.md"], manualUntrackedDirRoot);
  run("git", ["commit", "-m", "initial"], manualUntrackedDirRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await mkdir(join(manualUntrackedDirRoot, "playbooks", "nested"), { recursive: true });
  await writeFile(join(manualUntrackedDirRoot, "playbooks", "one.md"), "one\n", "utf8");
  await writeFile(join(manualUntrackedDirRoot, "playbooks", "nested", "two.md"), "two\n", "utf8");
  const manualUntrackedDirRecord = JSON.parse(run("node", [
    cliPath,
    "record",
    "manual untracked directory attribution",
    "--runner",
    "codex",
    "--cwd",
    manualUntrackedDirRoot,
    "--write-scope",
    "playbooks"
  ]).stdout);
  assert(manualUntrackedDirRecord.status === "ok", "manual untracked directory record should pass with a directory write scope");
  assert(manualUntrackedDirRecord.changed_files.includes("playbooks/one.md"), "manual untracked directory attribution should expand top-level files");
  assert(manualUntrackedDirRecord.changed_files.includes("playbooks/nested/two.md"), "manual untracked directory attribution should expand nested files");
  assert(!manualUntrackedDirRecord.changed_files.includes("playbooks"), "manual untracked directory attribution should not report the directory as the changed file");
  assert(manualUntrackedDirRecord.write_scope.violations.length === 0, "expanded untracked files should respect directory write scopes");

  const baselineRecordRoot = join(tempRoot, "manual-baseline");
  await mkdir(baselineRecordRoot, { recursive: true });
  run("git", ["init"], baselineRecordRoot);
  await writeFile(join(baselineRecordRoot, "README.md"), "# Manual Baseline\n", "utf8");
  run("git", ["add", "README.md"], baselineRecordRoot);
  run("git", ["commit", "-m", "initial"], baselineRecordRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(baselineRecordRoot, "dirty-at-baseline.txt"), "before\n", "utf8");
  await writeFile(join(baselineRecordRoot, "unchanged-dirty.txt"), "same\n", "utf8");
  const baselineStart = JSON.parse(run("node", [
    cliPath,
    "record",
    "--start",
    "begin baselined manual session",
    "--runner",
    "codex",
    "--cwd",
    baselineRecordRoot
  ]).stdout);
  assert(baselineStart.type === "session_baseline", "record --start should append a session baseline event");
  assert(baselineStart.dirty_files.includes("dirty-at-baseline.txt"), "baseline should capture dirty files");
  await writeFile(join(baselineRecordRoot, "dirty-at-baseline.txt"), "after\n", "utf8");
  await writeFile(join(baselineRecordRoot, "new-after-baseline.txt"), "new\n", "utf8");
  const baselineRecord = JSON.parse(run("node", [
    cliPath,
    "record",
    "finished baselined manual session",
    "--runner",
    "codex",
    "--cwd",
    baselineRecordRoot,
    "--check",
    "node --version",
    "--write-scope",
    "dirty-at-baseline.txt,new-after-baseline.txt"
  ]).stdout);
  assert(baselineRecord.status === "ok", "baselined record should pass when changed files are in scope");
  assert(baselineRecord.session_baseline.id === baselineStart.id, "manual record should link to the baseline it used");
  assert(baselineRecord.changed_files.includes("dirty-at-baseline.txt"), "baselined record should include dirty baseline files that changed again");
  assert(baselineRecord.changed_files.includes("new-after-baseline.txt"), "baselined record should include files created after baseline");
  assert(!baselineRecord.changed_files.includes("unchanged-dirty.txt"), "baselined record should exclude dirty files unchanged since baseline");
  assert(baselineRecord.contaminated_files.includes("dirty-at-baseline.txt"), "dirty-at-baseline files changed again should be contaminated");
  const baselineEval = JSON.parse(run("node", [cliPath, "eval", baselineRecord.id, "--cwd", baselineRecordRoot]).stdout);
  assert(baselineEval.signals.baseline_contaminated_files === 1, "eval should count contaminated baseline files");
  assert(baselineEval.outcome.risks.includes("baseline_contaminated_files"), "outcome should flag contaminated baseline files");

  const multiBaselineRoot = join(tempRoot, "manual-multiple-baseline");
  await mkdir(multiBaselineRoot, { recursive: true });
  run("git", ["init"], multiBaselineRoot);
  await writeFile(join(multiBaselineRoot, "README.md"), "# Multiple Baselines\n", "utf8");
  run("git", ["add", "README.md"], multiBaselineRoot);
  run("git", ["commit", "-m", "initial"], multiBaselineRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  const firstBaseline = JSON.parse(run("node", [
    cliPath,
    "record",
    "--start",
    "first open baseline",
    "--runner",
    "codex",
    "--cwd",
    multiBaselineRoot
  ]).stdout);
  const secondBaseline = JSON.parse(run("node", [
    cliPath,
    "record",
    "--start",
    "second open baseline",
    "--runner",
    "codex",
    "--cwd",
    multiBaselineRoot
  ]).stdout);
  await writeFile(join(multiBaselineRoot, "newest-baseline-change.txt"), "changed\n", "utf8");
  const multiBaselineRun = spawnSync("node", [
    cliPath,
    "record",
    "use newest open baseline",
    "--runner",
    "codex",
    "--cwd",
    multiBaselineRoot
  ], { encoding: "utf8" });
  assert(multiBaselineRun.status === 0, "record should succeed when multiple baselines are open");
  assert(multiBaselineRun.stderr.includes("multiple open record baselines"), "record should warn when multiple baselines are open");
  const multiBaselineRecord = JSON.parse(multiBaselineRun.stdout);
  assert(multiBaselineRecord.session_baseline.id === secondBaseline.id, "record should use the newest open baseline");
  assert(multiBaselineRecord.session_baseline.closed_baseline_ids.includes(firstBaseline.id), "record should close older open baselines it saw");
  assert(multiBaselineRecord.session_baseline.closed_baseline_ids.includes(secondBaseline.id), "record should close the baseline it used");

  const manualScopeRoot = join(tempRoot, "manual-scope");
  await mkdir(manualScopeRoot, { recursive: true });
  run("git", ["init"], manualScopeRoot);
  await writeFile(join(manualScopeRoot, "README.md"), "# Manual Scope\n", "utf8");
  run("git", ["add", "README.md"], manualScopeRoot);
  run("git", ["commit", "-m", "initial"], manualScopeRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(manualScopeRoot, "outside.txt"), "outside\n", "utf8");
  const manualScopeRecord = JSON.parse(run("node", [
    cliPath,
    "record",
    "manual scope violation",
    "--runner",
    "codex",
    "--cwd",
    manualScopeRoot,
    "--write-scope",
    "allowed.txt"
  ]).stdout);
  assert(manualScopeRecord.status === "failed", "manual records should fail on write-scope violations");
  assert(manualScopeRecord.status_reason === "write_scope_violation", "manual scope failures should use write-scope status reason");
  assert(manualScopeRecord.write_scope.violations.includes("outside.txt"), "manual write-scope violations should list files");

  const ledgerPath = join(tempRoot, ".rux", "ledger");
  assert(existsSync(ledgerPath), "ledger directory should exist");

  const transcript = await readFile(join(tempRoot, summary.transcript_path), "utf8");
  assert(transcript.includes("runner: fake"), "transcript should contain fake runner output");

  const pairResult = run("node", [
    cliPath,
    "run",
    "review the docs change",
    "--runner",
    "fake",
    "--roster",
    "pair",
    "--cwd",
    tempRoot,
    "--check",
    "node --version"
  ]);
  const pairSummary = JSON.parse(pairResult.stdout);
  assert(pairSummary.roster === "pair", "pair run should keep pair roster");
  assert(pairSummary.role === "roster", "pair summary should be a roster parent");
  assert(pairSummary.status_reason === "completed", "pair parent should classify completed roster status");
  assert(pairSummary.adapter.notes[0].includes("child runs"), "pair parent should explain adapter metadata lives on children");
  assert(pairSummary.child_run_ids.length === 2, "pair run should create implementer and reviewer child runs");
  assert(pairSummary.checks.length === 1, "pair parent should include implementer check result");
  assert(pairSummary.repo.before.inside_work_tree === true, "pair parent should include repo snapshot before roster execution");
  assert(pairSummary.repo.after.inside_work_tree === true, "pair parent should include repo snapshot after roster execution");
  assert(pairSummary.replay.command.includes("--roster pair"), "roster parent replay should include roster command");

  const pairShow = JSON.parse(run("node", [cliPath, "show", pairSummary.id, "--cwd", tempRoot]).stdout);
  assert(pairShow.children.length === 2, "show should include pair child runs");
  assert(pairShow.evaluation.signals.repo_snapshot === true, "show evaluation should see roster parent repo snapshot");
  assert(pairShow.children.map((child) => child.role).join(",") === "implementer,reviewer", "pair children should keep role order");
  assert(pairShow.children.every((child) => child.replay.available === false), "child runs should ask callers to replay the parent roster");
  assert(pairShow.children.every((child) => child.replay.parent_command === pairSummary.replay.command), "child replay metadata should include the parent command");
  const pairTranscript = await readFile(join(tempRoot, pairSummary.transcript_path), "utf8");
  assert(pairTranscript.includes("## child runs"), "pair transcript should summarize child runs");

  const repairResult = run("node", [
    cliPath,
    "run",
    "repair only if the check fails",
    "--runner",
    "fake",
    "--roster",
    "repair",
    "--cwd",
    tempRoot,
    "--check",
    "node --version"
  ]);
  const repairSummary = JSON.parse(repairResult.stdout);
  const repairShow = JSON.parse(run("node", [cliPath, "show", repairSummary.id, "--cwd", tempRoot]).stdout);
  assert(repairSummary.roster === "repair", "repair run should keep repair roster");
  assert(repairShow.children.length === 1, "repair should skip second child when the first attempt passes");
  assert(repairShow.run.notes.some((note) => note.includes("Repair step skipped")), "repair parent should explain skipped repair");

  const chainResult = run("node", [
    cliPath,
    "run",
    "plan code review workflow",
    "--runner",
    "fake",
    "--roster",
    "plan-code-review",
    "--cwd",
    tempRoot
  ]);
  const chainSummary = JSON.parse(chainResult.stdout);
  const chainShow = JSON.parse(run("node", [cliPath, "show", chainSummary.id, "--cwd", tempRoot]).stdout);
  assert(chainSummary.roster === "plan-code-review", "chain run should keep plan-code-review roster");
  assert(chainShow.children.map((child) => child.role).join(",") === "planner,coder,reviewer", "chain children should keep role order");

  const listOutput = run("node", [cliPath, "ls", "--cwd", tempRoot]).stdout;
  assert(listOutput.includes(pairSummary.id), "ls should include roster parent runs");
  assert(!listOutput.includes(pairSummary.child_run_ids[0]), "ls should keep child runs out of the overview");
  assert(listOutput.includes("mark=-"), "ls should include lifecycle mark column");

  const oldSessionPath = join(tempRoot, "old-claude-session.txt");
  await writeFile(oldSessionPath, "Claude session transcript from before Rux existed.\nNo checks were captured.\n", "utf8");
  const importResult = run("node", [
    cliPath,
    "import",
    "--from",
    oldSessionPath,
    "--runner",
    "claude",
    "--task",
    "Imported old Claude session",
    "--cwd",
    tempRoot,
    "--started-at",
    "2026-06-01T00:00:00.000Z"
  ]);
  const importedSummary = JSON.parse(importResult.stdout);
  assert(importedSummary.source === "imported", "imported run should keep imported source");
  assert(importedSummary.confidence === "low", "imported run should be low confidence");
  assert(importedSummary.runner === "claude", "imported run should keep selected runner");
  assert(importedSummary.status === "unknown", "imported run should default to unknown status");
  assert(importedSummary.changed_files.length === 0, "imported run should not invent changed files");
  assert(importedSummary.checks.length === 0, "imported run should not invent checks");
  assert(importedSummary.repo.imported_at.inside_work_tree === true, "imported run should include repo context at import time");
  assert(importedSummary.replay.available === false, "imported run should not pretend to be replayable");

  const importedTranscript = await readFile(join(tempRoot, importedSummary.transcript_path), "utf8");
  assert(importedTranscript.includes("source: imported"), "imported transcript should mark source");
  assert(importedTranscript.includes("confidence: low"), "imported transcript should mark low confidence");
  assert(importedTranscript.includes("No checks were captured."), "imported transcript should include source text");

  run("node", [
    cliPath,
    "verdict",
    importedSummary.id,
    "partial",
    "--note",
    "old session imported only for continuity",
    "--cwd",
    tempRoot
  ]);
  const importedShow = JSON.parse(run("node", [cliPath, "show", importedSummary.id, "--cwd", tempRoot]).stdout);
  assert(importedShow.run.imported_from === oldSessionPath, "show should include imported source path");
  assert(importedShow.run.status_reason === "imported_unverified", "imported run should classify unverified status");
  assert(importedShow.run.adapter.notes[0].includes("Original provider invocation was not observed"), "imported run should preserve adapter uncertainty");
  assert(importedShow.run.replay.available === false, "show should preserve imported replay boundary");
  assert(importedShow.verdicts[0]?.verdict === "partial", "imported run should accept later verdicts");
  assert(importedShow.evaluation.routing.blockers.includes("not_live"), "show evaluation should explain imported routing blocker");
  const importedEval = JSON.parse(run("node", [cliPath, "eval", importedSummary.id, "--cwd", tempRoot]).stdout);
  assert(importedEval.routing.eligible === false, "eval should mark imported runs ineligible for routing");
  assert(importedEval.routing.blockers.includes("not_high_confidence"), "eval should show low confidence blocker");
  assert(importedEval.outcome.label === "human_partial", "eval should include imported human outcome after verdict");
  assert(importedEval.outcome.risks.includes("not_live"), "imported outcome should retain not-live risk");

  const claudeGuard = spawnSync("node", [
    cliPath,
    "run",
    "guard",
    "--runner",
    "claude",
    "--allow-dirty",
    "--model",
    "claude-sonnet-smoke",
    "--effort",
    "high",
    "--cost-hint",
    "0.42",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(claudeGuard.status === 0, "mocked claude runner should complete");
  assert(claudeGuard.stderr.includes("rux: starting claude mode=plan"), "provider runs should print Rux start progress on stderr");
  assert(claudeGuard.stderr.includes("rux: claude finished exit=0"), "provider runs should print Rux finish progress on stderr");
  const claudeSummary = JSON.parse(claudeGuard.stdout);
  assert(claudeSummary.runner === "claude", "mocked claude run should use claude runner");
  assert(claudeSummary.status === "ok", "mocked claude run should be ok");
  assert(claudeSummary.status_reason === "completed", "mocked claude run should classify completed status");
  assert(claudeSummary.adapter.command === "claude", "mocked claude run should expose adapter command");
  assert(claudeSummary.adapter.argv.includes("--permission-mode"), "mocked claude adapter should expose argv");
  assert(claudeSummary.adapter.stdout_bytes > 0, "mocked claude adapter should expose stdout byte count");
  assert(claudeSummary.adapter.stderr_signal.level === "none", "mocked claude adapter should classify empty stderr");
  assert(claudeSummary.adapter.parsed_output.format === "claude-json", "mocked claude adapter should parse representative JSON output");
  assert(claudeSummary.adapter.parsed_output.parsed === true, "mocked claude adapter should avoid raw text fallback for JSON output");
  assert(claudeSummary.model === "claude-sonnet-smoke", "mocked claude run should capture model metadata");
  assert(claudeSummary.effort === "high", "mocked claude run should capture effort metadata");
  assert(claudeSummary.cost_hint.amount === 0.42, "mocked claude run should capture numeric cost hint");
  assert(claudeSummary.adapter.metadata_sources.model === "user_option", "mocked claude adapter should identify user-supplied model metadata");
  assert(claudeSummary.adapter.metadata_sources.effort === "user_option", "mocked claude adapter should identify user-supplied effort metadata");
  assert(claudeSummary.adapter.metadata_sources.cost_hint === "user_option", "mocked claude adapter should identify user-supplied cost metadata");
  assert(claudeSummary.replay.provider_call_required === true, "real runner replay should disclose provider call");
  assert(claudeSummary.replay.command.includes("--model claude-sonnet-smoke"), "real runner replay should include model metadata");
  assert(claudeSummary.replay.command.includes("--effort high"), "real runner replay should include effort metadata");
  assert(claudeSummary.replay.command.includes("--cost-hint 0.42"), "real runner replay should include cost hint");

  const claudeTranscript = await readFile(join(tempRoot, claudeSummary.transcript_path), "utf8");
  assert(claudeTranscript.includes("--permission-mode plan"), "claude runner should use plan permission mode");
  assert(claudeTranscript.includes("mock claude structured response"), "claude transcript should capture parsed assistant text");

  // Without --model, the adapter must observe the model from the real-shaped
  // `modelUsage` map (model name is a key, not a value) and pick the primary
  // model by cost. This is the regression guard for the Proof Quarter metadata bar.
  const claudeObservedRun = spawnSync("node", [
    cliPath,
    "run",
    "observed guard",
    "--runner",
    "claude",
    "--allow-dirty",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(claudeObservedRun.status === 0, "claude run without --model should complete");
  const claudeObservedSummary = JSON.parse(claudeObservedRun.stdout);
  assert(claudeObservedSummary.model === "claude-opus-4-8", "claude run should observe the primary model from modelUsage (cost-weighted, suffix stripped)");
  assert(claudeObservedSummary.adapter.metadata_sources.model === "observed", "claude run without --model should mark model metadata as observed");
  assert(claudeObservedSummary.cost_hint.amount === 0.0538, "claude run should observe total_cost_usd as cost hint");
  assert(claudeObservedSummary.adapter.metadata_sources.cost_hint === "observed", "claude run should mark observed cost metadata");

  // Cross-unit guard: a zero-cost entry with huge token counts must not beat a
  // cost-bearing primary. Scoring stays on one dimension (cost) per usage map.
  const claudeCostMixRun = spawnSync("node", [
    cliPath,
    "run",
    "cost mix guard",
    "--runner",
    "claude",
    "--allow-dirty",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(claudeCostMixRun.status === 0, "claude cost-mix run should complete");
  const claudeCostMixSummary = JSON.parse(claudeCostMixRun.stdout);
  assert(claudeCostMixSummary.model === "claude-opus-4-8", "primary model must be chosen by cost, not token count, when costs are present");

  const claudeStreamRun = spawnSync("node", [
    cliPath,
    "run",
    "stream guard",
    "--runner",
    "claude",
    "--stream",
    "--allow-dirty",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(claudeStreamRun.status === 0, "mocked streaming claude runner should complete");
  assert(claudeStreamRun.stderr.includes("rux: claude > mock claude streamed chunk"), "streaming run should render assistant text live on stderr");
  assert(claudeStreamRun.stderr.includes("rux: claude done"), "streaming run should render the result event live on stderr");
  const claudeStreamSummary = JSON.parse(claudeStreamRun.stdout);
  assert(claudeStreamSummary.status === "ok", "mocked streaming claude run should be ok");
  assert(claudeStreamSummary.adapter.argv.includes("stream-json"), "streaming claude adapter should request stream-json output");
  assert(claudeStreamSummary.adapter.parsed_output.format === "claude-stream-json", "streaming claude adapter should parse stream-json output");
  assert(claudeStreamSummary.adapter.parsed_output.parsed === true, "streaming claude adapter should avoid raw text fallback");
  assert(claudeStreamSummary.model === "claude-stream-mock", "streaming claude run should capture observed model metadata");
  assert(claudeStreamSummary.cost_hint.amount === 0.07, "streaming claude run should capture observed cost from the result event");
  assert(claudeStreamSummary.replay.command.includes("--stream"), "streaming run replay should preserve the --stream flag");
  const claudeStreamTranscript = await readFile(join(tempRoot, claudeStreamSummary.transcript_path), "utf8");
  assert(claudeStreamTranscript.includes("mock claude streamed response"), "streaming claude transcript should capture the result assistant text");

  const claudeWriteRun = spawnSync("node", [
    cliPath,
    "run",
    "write claude guard",
    "--runner",
    "claude",
    "--allow-dirty",
    "--provider-mode",
    "write",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(claudeWriteRun.status === 0, "mocked claude write-mode runner should complete");
  const claudeWriteSummary = JSON.parse(claudeWriteRun.stdout);
  assert(claudeWriteSummary.provider_mode === "write", "write-mode claude summaries should expose provider_mode");
  const claudeWriteTranscript = await readFile(join(tempRoot, claudeWriteSummary.transcript_path), "utf8");
  assert(claudeWriteTranscript.includes("--permission-mode acceptEdits"), "claude write mode should accept edits instead of plan mode");
  run("node", [
    cliPath,
    "verdict",
    claudeSummary.id,
    "accepted",
    "--note",
    "mock claude accepted for suggestion smoke",
    "--cwd",
    tempRoot
  ]);
  const claudeEval = JSON.parse(run("node", [cliPath, "eval", claudeSummary.id, "--cwd", tempRoot]).stdout);
  assert(claudeEval.routing.eligible === true, "accepted live claude run should be routing eligible");
  assert(claudeEval.routing.score === 1, "accepted live claude run should score 1");
  assert(claudeEval.latest_verdict.verdict === "accepted", "eval should include latest human verdict");
  assert(claudeEval.outcome.label === "human_accepted", "eval should include human accepted outcome");
  assert(claudeEval.outcome.score === 1, "human accepted outcome should score 1");
  assert(claudeEval.model === "claude-sonnet-smoke", "eval should include model metadata");
  assert(claudeEval.effort === "high", "eval should include effort metadata");
  assert(claudeEval.cost_hint.amount === 0.42, "eval should include cost hint metadata");
  assert(claudeEval.signals.adapter_exit_code === 0, "eval should include adapter exit code");
  assert(claudeEval.signals.adapter_stdout_bytes > 0, "eval should include adapter output size");
  assert(claudeEval.signals.adapter_stderr_signal === "none", "eval should include adapter stderr signal");

  const tempPolicyPath = join(tempRoot, "rux.policy.json");
  const tempPolicy = JSON.parse(await readFile(tempPolicyPath, "utf8"));
  tempPolicy.token_governor = {
    ...(tempPolicy.token_governor ?? {}),
    mode: "advisory",
    max_tool_output_chars: 10
  };
  await writeFile(tempPolicyPath, `${JSON.stringify(tempPolicy, null, 2)}\n`, "utf8");

  const codexRun = spawnSync("node", [cliPath, "run", "codex guard", "--runner", "codex", "--allow-dirty", "--cwd", tempRoot], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(codexRun.status === 0, "mocked codex runner should complete");
  const codexSummary = JSON.parse(codexRun.stdout);
  assert(codexSummary.runner === "codex", "mocked codex run should use codex runner");
  assert(codexSummary.status === "ok", "mocked codex run should be ok");
  assert(codexSummary.provider_mode === "plan", "default codex summaries should expose plan provider_mode");
  assert(codexSummary.task_kind === "unspecified", "runs without --task-kind should record unspecified task_kind");
  assert(codexSummary.task_kind_source === "unspecified", "runs without --task-kind should record unspecified task kind source");
  assert(codexSummary.task_kind_suggestion === "general", "runs without --task-kind should store a non-authoritative suggestion");
  assert(codexSummary.adapter.argv.includes("--sandbox"), "mocked codex adapter should expose sandbox argv");
  assert(codexSummary.adapter.stderr_signal.level === "diagnostic", "mocked codex adapter should classify successful stderr as diagnostic");
  assert(codexSummary.adapter.parsed_output.format === "codex-jsonl", "mocked codex adapter should parse representative JSONL output");
  assert(codexSummary.adapter.parsed_output.event_types.includes("item.completed"), "mocked codex adapter should expose JSONL event types");
  assert(codexSummary.adapter.output_policy.max_tool_output_chars === 10, "mocked codex adapter should record token-governor output cap");
  assert(codexSummary.adapter.output_policy.rendering_truncated === true, "mocked codex adapter should record truncated provider rendering");
  assert(codexSummary.adapter.stdout_bytes > codexSummary.adapter.output_policy.max_tool_output_chars, "provider stdout should still be fully captured beyond rendered cap");
  tempPolicy.token_governor.max_tool_output_chars = 20000;
  await writeFile(tempPolicyPath, `${JSON.stringify(tempPolicy, null, 2)}\n`, "utf8");
  // Installed codex `exec --json` emits no model id, so model stays not_observed (honest).
  assert(codexSummary.model === null, "codex JSONL without a model field should leave model unobserved");
  assert(codexSummary.adapter.metadata_sources.model === "not_observed", "codex JSONL should mark model metadata as not_observed");
  const codexEval = JSON.parse(run("node", [cliPath, "eval", codexSummary.id, "--cwd", tempRoot]).stdout);
  assert(codexEval.signals.adapter_stderr_signal === "diagnostic", "eval should expose diagnostic stderr without treating it as failure");
  const codexOutcome = JSON.parse(run("node", [cliPath, "outcome", codexSummary.id, "--cwd", tempRoot]).stdout);
  assert(codexOutcome.outcome.label === "unlabeled", "outcome should mark unlabeled provider runs");
  assert(codexOutcome.outcome.risks.includes("missing_verdict_or_check"), "unlabeled outcome should explain missing signal");
  const codexPostRunCheckProcess = spawnSync("node", [
    cliPath,
    "check",
    codexSummary.id,
    "--command",
    "node --version",
    "--note",
    "verified after provider run",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8"
  });
  assert(codexPostRunCheckProcess.status === 0, "post-run check should complete through spawn path");
  assert(codexPostRunCheckProcess.stderr.includes("rux: running check: node --version"), "post-run checks should print start progress on stderr");
  assert(codexPostRunCheckProcess.stderr.includes("rux: check passed exit=0"), "post-run checks should print completion progress on stderr");
  const codexPostRunCheck = JSON.parse(codexPostRunCheckProcess.stdout);
  assert(codexPostRunCheck.type === "check", "post-run check should append a check event");
  assert(codexPostRunCheck.source === "post_run_check", "post-run check should record its source");
  assert(codexPostRunCheck.exit_code === 0, "post-run check should capture exit code");
  assert(codexPostRunCheck.repo.before.head === codexSummary.repo.after.head, "post-run check should capture repo state before the check");
  assert(codexPostRunCheck.repo.after.head === codexSummary.repo.after.head, "post-run check should capture repo state after the check");
  assert(Array.isArray(codexPostRunCheck.changed_files), "post-run check should report changed files");
  const checkedCodexOutcome = JSON.parse(run("node", [cliPath, "outcome", codexSummary.id, "--cwd", tempRoot]).stdout);
  assert(checkedCodexOutcome.outcome.label === "checks_passed", "post-run check should make outcome check-backed");
  assert(checkedCodexOutcome.outcome.checks.total === 1, "post-run check should be visible in outcome");
  const checkedCodexEval = JSON.parse(run("node", [cliPath, "eval", codexSummary.id, "--cwd", tempRoot]).stdout);
  assert(checkedCodexEval.routing.eligible === true, "post-run checked provider run should become routing eligible");
  assert(checkedCodexEval.signals.checks_total === 1, "eval should count post-run checks");
  assert(checkedCodexEval.signals.check_changed_files === 0, "eval should expose check-time file changes");
  assert(checkedCodexEval.routing.score_basis === "checks_passed", "post-run checked provider run should score from checks");

  const checkVerdictRoot = join(tempRoot, "check-verdict-root");
  await mkdir(checkVerdictRoot, { recursive: true });
  run("git", ["init"], checkVerdictRoot);
  await writeFile(join(checkVerdictRoot, "README.md"), "# Check Verdict\n", "utf8");
  run("git", ["add", "README.md"], checkVerdictRoot);
  run("git", ["commit", "-m", "initial"], checkVerdictRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  const codexCheckVerdictRun = spawnSync("node", [
    cliPath,
    "run",
    "codex check verdict guard",
    "--runner",
    "codex",
    "--allow-dirty",
    "--cwd",
    checkVerdictRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(codexCheckVerdictRun.status === 0, "mocked codex run for check --verdict should complete");
  const codexCheckVerdictSummary = JSON.parse(codexCheckVerdictRun.stdout);
  const checkWithVerdict = JSON.parse(run("node", [
    cliPath,
    "check",
    codexCheckVerdictSummary.id,
    "--command",
    "node --version",
    "--verdict",
    "accepted",
    "--cwd",
    checkVerdictRoot
  ]).stdout);
  assert(checkWithVerdict.type === "check", "check --verdict should still return the check event");
  const checkVerdictShow = JSON.parse(run("node", [cliPath, "show", codexCheckVerdictSummary.id, "--cwd", checkVerdictRoot]).stdout);
  assert(checkVerdictShow.verdicts[0]?.verdict === "accepted", "check --verdict should append a verdict event");
  assert(checkVerdictShow.evaluation.latest_verdict.verdict === "accepted", "check --verdict should make the verdict visible to eval/show");
  const invalidRunVerdict = spawnSync("node", [
    cliPath,
    "run",
    "invalid verdict should not write",
    "--runner",
    "codex",
    "--allow-dirty",
    "--verdict",
    "shipit",
    "--cwd",
    checkVerdictRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(invalidRunVerdict.status !== 0, "invalid run --verdict should fail before capture");
  assert(invalidRunVerdict.stderr.includes("--verdict must be one of"), "invalid run --verdict should explain allowed values");
  assert(!invalidRunVerdict.stderr.includes("recorded run"), "invalid run --verdict should not write a run before failing");
  const baselineVerdict = spawnSync("node", [
    cliPath,
    "record",
    "--start",
    "baseline verdict guard",
    "--runner",
    "codex",
    "--verdict",
    "accepted",
    "--cwd",
    checkVerdictRoot
  ], { encoding: "utf8" });
  assert(baselineVerdict.status !== 0, "record --start should reject --verdict");
  assert(baselineVerdict.stderr.includes("baseline only"), "record --start verdict rejection should explain the boundary");

  const codexTranscript = await readFile(join(tempRoot, codexSummary.transcript_path), "utf8");
  assert(codexTranscript.includes("exec --sandbox read-only"), "codex runner should use read-only sandbox");
  assert(codexTranscript.includes("mock codex structured response"), "codex transcript should capture parsed assistant text");
  const codexWriteRun = spawnSync("node", [
    cliPath,
    "run",
    "codex write guard",
    "--runner",
    "codex",
    "--allow-dirty",
    "--provider-mode",
    "write",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(codexWriteRun.status === 0, "mocked codex write-mode runner should complete");
  const codexWriteSummary = JSON.parse(codexWriteRun.stdout);
  assert(codexWriteSummary.provider_mode === "write", "write-mode codex summaries should expose provider_mode");
  const codexWriteTranscript = await readFile(join(tempRoot, codexWriteSummary.transcript_path), "utf8");
  assert(codexWriteTranscript.includes("exec --sandbox workspace-write"), "codex write mode should use workspace-write sandbox");

  const typedTaskKindRun = JSON.parse(run("node", [
    cliPath,
    "run",
    "typed task kind guard",
    "--runner",
    "fake",
    "--task-kind",
    "review",
    "--cwd",
    tempRoot
  ]).stdout);
  assert(typedTaskKindRun.task_kind === "review", "--task-kind user path should record the user task_kind");
  assert(typedTaskKindRun.task_kind_source === "user", "--task-kind user path should record source user");
  assert(typedTaskKindRun.task_kind_suggestion === null, "--task-kind user path should not store a suggestion");
  assert(typedTaskKindRun.provider_mode === "internal", "fake run summaries should expose internal provider_mode");

  const geminiRun = spawnSync("node", [cliPath, "run", "gemini guard", "--runner", "gemini", "--allow-dirty", "--cwd", tempRoot], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(geminiRun.status === 0, "mocked gemini runner should complete");
  const geminiSummary = JSON.parse(geminiRun.stdout);
  assert(geminiSummary.runner === "gemini", "mocked gemini run should use gemini runner");
  assert(geminiSummary.status === "ok", "mocked gemini run should be ok");
  assert(geminiSummary.provider_mode === "plan", "default gemini summaries should expose plan provider_mode");
  assert(geminiSummary.adapter.parsed_output.format === "gemini-json", "mocked gemini adapter should parse representative JSON output");
  assert(geminiSummary.adapter.parsed_output.parsed === true, "mocked gemini adapter should avoid raw text fallback for JSON output");
  assert(geminiSummary.model === "gemini-mock-json", "mocked gemini JSON should populate observed model metadata");
  assert(geminiSummary.adapter.metadata_sources.model === "observed", "mocked gemini JSON should mark model metadata as observed");

  const geminiTranscript = await readFile(join(tempRoot, geminiSummary.transcript_path), "utf8");
  assert(geminiTranscript.includes("--approval-mode plan"), "gemini runner should use plan approval mode");
  assert(geminiTranscript.includes("--skip-trust"), "gemini runner should skip workspace trust prompts for headless runs");
  assert(geminiTranscript.includes("mock gemini structured response"), "gemini transcript should capture parsed assistant text");
  const geminiWriteRun = spawnSync("node", [
    cliPath,
    "run",
    "gemini write guard",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--provider-mode",
    "write",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(geminiWriteRun.status === 0, "mocked gemini write-mode runner should complete");
  const geminiWriteSummary = JSON.parse(geminiWriteRun.stdout);
  assert(geminiWriteSummary.provider_mode === "write", "write-mode gemini summaries should expose provider_mode");
  const geminiWriteTranscript = await readFile(join(tempRoot, geminiWriteSummary.transcript_path), "utf8");
  assert(geminiWriteTranscript.includes("--approval-mode auto_edit"), "gemini write mode should use auto_edit approval mode");

  const providerUntrackedDirRoot = join(tempRoot, "provider-untracked-dir");
  await mkdir(providerUntrackedDirRoot, { recursive: true });
  run("git", ["init"], providerUntrackedDirRoot);
  await writeFile(join(providerUntrackedDirRoot, "README.md"), "# Provider Untracked Directory\n", "utf8");
  run("git", ["add", "README.md"], providerUntrackedDirRoot);
  run("git", ["commit", "-m", "initial"], providerUntrackedDirRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  const providerUntrackedDirRun = spawnSync("node", [
    cliPath,
    "run",
    "untracked directory attribution",
    "--runner",
    "gemini",
    "--provider-mode",
    "write",
    "--allow-dirty",
    "--write-scope",
    "provider-output",
    "--cwd",
    providerUntrackedDirRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(providerUntrackedDirRun.status === 0, "provider untracked directory attribution run should complete");
  const providerUntrackedDirSummary = JSON.parse(providerUntrackedDirRun.stdout);
  assert(providerUntrackedDirSummary.status === "ok", "provider untracked directory run should pass with directory write scope");
  assert(providerUntrackedDirSummary.changed_files.includes("provider-output/one.md"), "provider untracked directory attribution should expand top-level files");
  assert(providerUntrackedDirSummary.changed_files.includes("provider-output/nested/two.md"), "provider untracked directory attribution should expand nested files");
  assert(!providerUntrackedDirSummary.changed_files.includes("provider-output"), "provider untracked directory attribution should not report the directory itself");
  assert(providerUntrackedDirSummary.write_scope.violations.length === 0, "expanded provider files should respect directory write scopes");

  const providerDirtyContentRoot = join(tempRoot, "provider-dirty-content");
  await mkdir(providerDirtyContentRoot, { recursive: true });
  run("git", ["init"], providerDirtyContentRoot);
  await writeFile(join(providerDirtyContentRoot, "dirty-content.txt"), "clean\n", "utf8");
  run("git", ["add", "dirty-content.txt"], providerDirtyContentRoot);
  run("git", ["commit", "-m", "initial"], providerDirtyContentRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  await writeFile(join(providerDirtyContentRoot, "dirty-content.txt"), "before\n", "utf8");
  const providerDirtyContentRun = spawnSync("node", [
    cliPath,
    "run",
    "dirty content attribution",
    "--runner",
    "gemini",
    "--provider-mode",
    "write",
    "--allow-dirty",
    "--cwd",
    providerDirtyContentRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(providerDirtyContentRun.status === 0, "provider dirty content attribution run should complete");
  const providerDirtyContentSummary = JSON.parse(providerDirtyContentRun.stdout);
  assert(providerDirtyContentSummary.changed_files.includes("dirty-content.txt"), "provider changed_files should include same-status dirty file edits");

  const blockedGeminiRun = spawnSync("node", [
    cliPath,
    "run",
    "needs provider approval",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(blockedGeminiRun.status === 0, "provider approval run should still record a run");
  assert(blockedGeminiRun.stderr.includes("rux: starting gemini mode=plan"), "provider progress should identify the runner and mode");
  assert(blockedGeminiRun.stderr.includes("Do you agree with this approach?"), "provider output should be visible on stderr while stdout stays JSON");
  const blockedGeminiSummary = JSON.parse(blockedGeminiRun.stdout);
  assert(blockedGeminiSummary.status === "blocked", "provider approval output should not be marked ok");
  assert(blockedGeminiSummary.status_reason === "provider_needs_input", "provider approval output should classify as needing input");
  assert(blockedGeminiSummary.output_signal.kind === "needs_input", "blocked run summary should expose output signal");
  const blockedGeminiOutcome = JSON.parse(run("node", [cliPath, "outcome", blockedGeminiSummary.id, "--cwd", tempRoot]).stdout);
  assert(blockedGeminiOutcome.outcome.label === "blocked_for_input", "blocked provider runs should get a distinct outcome");
  assert(blockedGeminiOutcome.outcome.risks.includes("provider_needs_input"), "blocked provider outcome should expose input risk");
  const blockedGeminiEval = JSON.parse(run("node", [cliPath, "eval", blockedGeminiSummary.id, "--cwd", tempRoot]).stdout);
  assert(blockedGeminiEval.routing.blockers.includes("run_not_ok"), "blocked provider runs should not become routing evidence");
  assert(blockedGeminiEval.signals.output_signal === "needs_input", "eval should expose output signal");
  const softBlockedGeminiRun = spawnSync("node", [
    cliPath,
    "run",
    "soft provider approval",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(softBlockedGeminiRun.status === 0, "soft provider approval run should record");
  const softBlockedGeminiSummary = JSON.parse(softBlockedGeminiRun.stdout);
  assert(softBlockedGeminiSummary.status === "blocked", "soft approval wording should be blocked");
  assert(softBlockedGeminiSummary.status_reason === "provider_needs_input", "soft approval wording should classify as needing input");

  const needsInputCheckFailedRun = spawnSync("node", [
    cliPath,
    "run",
    "needs input check failed precedence",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--cwd",
    tempRoot,
    "--check",
    "node -e \"process.exit(7)\""
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(needsInputCheckFailedRun.status === 0, "provider input plus failed check should still record");
  const needsInputCheckFailedSummary = JSON.parse(needsInputCheckFailedRun.stdout);
  assert(needsInputCheckFailedSummary.status === "failed", "failed checks should outrank provider input requests");
  assert(needsInputCheckFailedSummary.status_reason === "check_failed", "failed checks should use check_failed before provider_needs_input");

  const planCheckFailedRun = spawnSync("node", [
    cliPath,
    "run",
    "plan check failed precedence",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--cwd",
    tempRoot,
    "--check",
    "node -e \"process.exit(7)\""
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(planCheckFailedRun.status === 0, "plan-mode writes plus failed checks should still record");
  const planCheckFailedSummary = JSON.parse(planCheckFailedRun.stdout);
  assert(planCheckFailedSummary.status === "failed", "plan-mode writes should fail the run even when the check fails");
  assert(planCheckFailedSummary.status_reason === "provider_plan_changed_files", "plan-mode file changes should outrank check_failed");

  const planInputRun = spawnSync("node", [
    cliPath,
    "run",
    "plan input precedence",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(planInputRun.status === 0, "plan-mode writes plus input requests should still record");
  const planInputSummary = JSON.parse(planInputRun.stdout);
  assert(planInputSummary.status_reason === "provider_plan_changed_files", "plan-mode file changes should outrank provider_needs_input");

  const scopePlanInputRun = spawnSync("node", [
    cliPath,
    "run",
    "scope plan input precedence",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--write-scope",
    "allowed.txt",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(scopePlanInputRun.status === 0, "scope violations plus plan/input signals should still record");
  const scopePlanInputSummary = JSON.parse(scopePlanInputRun.stdout);
  assert(scopePlanInputSummary.status_reason === "write_scope_violation", "write-scope violations should outrank plan-mode changes and provider_needs_input");

  const scopeCheckFailedRun = spawnSync("node", [
    cliPath,
    "run",
    "scope check failed precedence",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--provider-mode",
    "write",
    "--write-scope",
    "allowed.txt",
    "--cwd",
    tempRoot,
    "--check",
    "node -e \"process.exit(7)\""
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(scopeCheckFailedRun.status === 0, "scope violations plus failed checks should still record");
  const scopeCheckFailedSummary = JSON.parse(scopeCheckFailedRun.stdout);
  assert(scopeCheckFailedSummary.status_reason === "write_scope_violation", "write-scope violations should outrank check_failed");

  const planChangedGeminiRun = spawnSync("node", [
    cliPath,
    "run",
    "plan mode edits",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(planChangedGeminiRun.status === 0, "plan-mode file changes should still record a run");
  const planChangedGeminiSummary = JSON.parse(planChangedGeminiRun.stdout);
  assert(planChangedGeminiSummary.status === "failed", "plan-mode file changes should fail the run");
  assert(planChangedGeminiSummary.status_reason === "provider_plan_changed_files", "plan-mode file changes should get a safety-specific reason");
  assert(planChangedGeminiSummary.output_signal.kind === "plan_changed_files", "plan-mode write violation should expose output signal");
  assert(planChangedGeminiSummary.changed_files.includes("plan-mode-edited.txt"), "plan-mode write violation should report changed file");
  const planChangedGeminiOutcome = JSON.parse(run("node", [cliPath, "outcome", planChangedGeminiSummary.id, "--cwd", tempRoot]).stdout);
  assert(planChangedGeminiOutcome.outcome.label === "run_failed", "plan-mode write violation should report a failed run, not a failed check");
  assert(planChangedGeminiOutcome.outcome.risks.includes("provider_plan_changed_files"), "plan-mode write violation should be an outcome risk");

  const scopedGeminiRun = spawnSync("node", [
    cliPath,
    "run",
    "scoped write edits",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--provider-mode",
    "write",
    "--write-scope",
    "allowed-output.txt",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(scopedGeminiRun.status === 0, "write-scope violations should still record a run");
  const scopedGeminiSummary = JSON.parse(scopedGeminiRun.stdout);
  assert(scopedGeminiSummary.status === "failed", "out-of-scope provider edits should fail the run");
  assert(scopedGeminiSummary.status_reason === "write_scope_violation", "out-of-scope provider edits should get a scope-specific reason");
  assert(scopedGeminiSummary.output_signal.kind === "write_scope_violation", "out-of-scope provider edits should expose output signal");
  assert(scopedGeminiSummary.write_scope.allowed.includes("allowed-output.txt"), "run summary should record allowed write scope");
  assert(scopedGeminiSummary.write_scope.violations.includes("out-of-scope-edited.txt"), "run summary should record scope violations");
  assert(scopedGeminiSummary.replay.command.includes("--write-scope allowed-output.txt"), "write-scope should be replay-visible");
  const scopedGeminiEval = JSON.parse(run("node", [cliPath, "eval", scopedGeminiSummary.id, "--cwd", tempRoot]).stdout);
  assert(scopedGeminiEval.routing.blockers.includes("write_scope_violation"), "scope-violating runs should be blocked from routing evidence");
  assert(scopedGeminiEval.signals.write_scope_violations === 1, "eval should count scope violations");
  assert(scopedGeminiEval.outcome.risks.includes("write_scope_violation"), "outcome should surface scope risk");
  const scopedGeminiExport = JSON.parse(run("node", [cliPath, "export", "--cwd", tempRoot, "--run-id", scopedGeminiSummary.id]).stdout);
  assert(scopedGeminiExport.runs[0].write_scope.violations.includes("out-of-scope-edited.txt"), "export should preserve write-scope violations");

  const checkedGeminiRun = spawnSync("node", [
    cliPath,
    "run",
    "gemini checked guard",
    "--runner",
    "gemini",
    "--allow-dirty",
    "--cwd",
    tempRoot,
    "--check",
    "node --version"
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(checkedGeminiRun.status === 0, "checked gemini run should complete");
  assert(checkedGeminiRun.stderr.includes("rux: running check: node --version"), "run checks should print start progress on stderr");
  assert(checkedGeminiRun.stderr.includes("rux: check passed exit=0"), "run checks should print completion progress on stderr");
  const checkedGeminiSummary = JSON.parse(checkedGeminiRun.stdout);
  const checkedGeminiOutcome = JSON.parse(run("node", [cliPath, "outcome", checkedGeminiSummary.id, "--cwd", tempRoot]).stdout);
  assert(checkedGeminiOutcome.outcome.label === "checks_passed", "outcome should mark check-passing provider runs");
  assert(checkedGeminiOutcome.outcome.score === 0.75, "check-passing outcome should use medium positive score");
  assert(checkedGeminiOutcome.outcome.checks.total === 1, "check-passing outcome should include check count");
  const failedCheckedCodexRun = spawnSync("node", [
    cliPath,
    "run",
    "codex failed post-run check guard",
    "--runner",
    "codex",
    "--allow-dirty",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(failedCheckedCodexRun.status === 0, "mocked codex run for failed post-run check should complete");
  const failedCheckedCodexSummary = JSON.parse(failedCheckedCodexRun.stdout);
  const failedPostRunCheck = JSON.parse(run("node", [
    cliPath,
    "check",
    failedCheckedCodexSummary.id,
    "--command",
    "node -e \"process.exit(7)\"",
    "--cwd",
    tempRoot
  ]).stdout);
  assert(failedPostRunCheck.exit_code === 7, "post-run check should capture failing exit code");
  const failedCheckedCodexEval = JSON.parse(run("node", [cliPath, "eval", failedCheckedCodexSummary.id, "--cwd", tempRoot]).stdout);
  assert(failedCheckedCodexEval.outcome.label === "checks_failed", "failed post-run check should make outcome negative");
  assert(failedCheckedCodexEval.routing.eligible === true, "failed checked provider run should remain routing evidence");
  assert(failedCheckedCodexEval.routing.score === 0, "failed checked provider run should score zero");
  assert(failedCheckedCodexEval.routing.score_basis === "checks_failed", "failed checked provider run should explain score basis");

  const mutatingCheckedCodexRun = spawnSync("node", [
    cliPath,
    "run",
    "codex mutating post-run check guard",
    "--runner",
    "codex",
    "--allow-dirty",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(mutatingCheckedCodexRun.status === 0, "mocked codex run for mutating post-run check should complete");
  const mutatingCheckedCodexSummary = JSON.parse(mutatingCheckedCodexRun.stdout);
  const mutatingPostRunCheck = JSON.parse(run("node", [
    cliPath,
    "check",
    mutatingCheckedCodexSummary.id,
    "--command",
    "node -e \"require('node:fs').writeFileSync('check-mutated.txt','changed')\"",
    "--cwd",
    tempRoot
  ]).stdout);
  assert(mutatingPostRunCheck.exit_code === 0, "mutating post-run check can still pass");
  assert(mutatingPostRunCheck.changed_files.includes("check-mutated.txt"), "post-run check should report files it changed");
  const mutatingCheckedCodexEval = JSON.parse(run("node", [cliPath, "eval", mutatingCheckedCodexSummary.id, "--cwd", tempRoot]).stdout);
  assert(mutatingCheckedCodexEval.outcome.label === "checks_passed", "mutating passing check should still be outcome-visible");
  assert(mutatingCheckedCodexEval.outcome.risks.includes("check_modified_files"), "mutating check should be visible as an outcome risk");
  assert(mutatingCheckedCodexEval.routing.eligible === false, "mutating checks should not become routing evidence");
  assert(mutatingCheckedCodexEval.routing.blockers.includes("check_modified_files"), "mutating checks should explain the routing blocker");

  const postRunCheckAttributionRoot = join(tempRoot, "post-run-check-attribution");
  await mkdir(postRunCheckAttributionRoot, { recursive: true });
  run("git", ["init"], postRunCheckAttributionRoot);
  await writeFile(join(postRunCheckAttributionRoot, "check-dirty.txt"), "clean\n", "utf8");
  run("git", ["add", "check-dirty.txt"], postRunCheckAttributionRoot);
  run("git", ["commit", "-m", "initial"], postRunCheckAttributionRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  const postRunCheckAttributionRun = JSON.parse(run("node", [
    cliPath,
    "run",
    "post-run check attribution baseline",
    "--runner",
    "fake",
    "--cwd",
    postRunCheckAttributionRoot
  ]).stdout);
  await writeFile(join(postRunCheckAttributionRoot, "check-dirty.txt"), "before\n", "utf8");
  const postRunDirtyCheck = JSON.parse(run("node", [
    cliPath,
    "check",
    postRunCheckAttributionRun.id,
    "--command",
    "node -e \"require('node:fs').writeFileSync('check-dirty.txt','after\\n');require('node:fs').mkdirSync('check-output/nested',{recursive:true});require('node:fs').writeFileSync('check-output/one.md','one\\n');require('node:fs').writeFileSync('check-output/nested/two.md','two\\n')\"",
    "--cwd",
    postRunCheckAttributionRoot
  ]).stdout);
  assert(postRunDirtyCheck.changed_files.includes("check-dirty.txt"), "post-run checks should include same-status dirty file edits");
  assert(postRunDirtyCheck.changed_files.includes("check-output/one.md"), "post-run checks should expand untracked top-level files");
  assert(postRunDirtyCheck.changed_files.includes("check-output/nested/two.md"), "post-run checks should expand untracked nested files");
  assert(!postRunDirtyCheck.changed_files.includes("check-output"), "post-run checks should not report untracked directories as changed files");

  const preSmokeReleaseCheck = JSON.parse(run("node", [cliPath, "release-check", "--cwd", tempRoot]).stdout);
  assert(preSmokeReleaseCheck.gates.find((gate) => gate.name === "policy_file")?.ok === true, "release-check should require committed policy file");
  assert(preSmokeReleaseCheck.gates.find((gate) => gate.name === "real_provider_task_evidence")?.ok === true, "release-check should accept routing-eligible live provider task evidence");
  assert(preSmokeReleaseCheck.gates.find((gate) => gate.name === "claude_smoke_evidence")?.ok === false, "release-check should require explicit claude provider-smoke evidence");
  assert(preSmokeReleaseCheck.gates.find((gate) => gate.name === "codex_smoke_evidence")?.ok === false, "release-check should require explicit codex provider-smoke evidence");
  assert(preSmokeReleaseCheck.gates.find((gate) => gate.name === "gemini_smoke_evidence")?.ok === false, "release-check should require explicit gemini provider-smoke evidence");

  const claudeProviderSmoke = spawnSync("node", [cliPath, "provider-smoke", "--runner", "claude", "--allow-dirty", "--cwd", tempRoot], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(claudeProviderSmoke.status === 0, "mocked claude provider smoke should complete");
  const claudeProviderSmokeSummary = JSON.parse(claudeProviderSmoke.stdout);
  assert(claudeProviderSmokeSummary.purpose === "provider_smoke", "claude provider smoke should mark purpose");
  assert(claudeProviderSmokeSummary.changed_files.length === 0, "claude provider smoke should not report file changes");
  assert(claudeProviderSmokeSummary.replay.command.includes("provider-smoke"), "provider smoke summary should include replay command");
  assert(claudeProviderSmokeSummary.replay.human_review_required === false, "provider smoke replay should not ask for task review");
  const claudeProviderSmokeEval = JSON.parse(run("node", [cliPath, "eval", claudeProviderSmokeSummary.id, "--cwd", tempRoot]).stdout);
  assert(claudeProviderSmokeEval.release.provider_smoke_evidence === true, "eval should mark provider-smoke release evidence");
  assert(claudeProviderSmokeEval.routing.blockers.includes("provider_smoke"), "eval should exclude provider smoke from routing");
  assert(!claudeProviderSmokeEval.routing.blockers.includes("unlabeled"), "provider smoke should not be treated as an unlabeled task run");
  assert(claudeProviderSmokeEval.outcome.label === "provider_smoke_passed", "provider smoke outcome should be release-only");
  assert(claudeProviderSmokeEval.outcome.confidence === "release_only", "provider smoke outcome should not imply task quality");
  const providerSmokeVerdict = spawnSync("node", [
    cliPath,
    "verdict",
    claudeProviderSmokeSummary.id,
    "accepted",
    "--cwd",
    tempRoot
  ], { encoding: "utf8" });
  assert(providerSmokeVerdict.status !== 0, "provider-smoke runs should reject human verdicts");
  assert(providerSmokeVerdict.stderr.includes("adapter readiness only"), "provider-smoke verdict rejection should explain the boundary");
  const providerSmokeMark = spawnSync("node", [
    cliPath,
    "mark",
    claudeProviderSmokeSummary.id,
    "accepted-downstream",
    "--cwd",
    tempRoot
  ], { encoding: "utf8" });
  assert(providerSmokeMark.status !== 0, "provider-smoke runs should reject lifecycle marks");
  assert(providerSmokeMark.stderr.includes("adapter readiness only"), "provider-smoke mark rejection should explain the boundary");
  const providerSmokeCheck = spawnSync("node", [
    cliPath,
    "check",
    claudeProviderSmokeSummary.id,
    "--command",
    "node --version",
    "--cwd",
    tempRoot
  ], { encoding: "utf8" });
  assert(providerSmokeCheck.status !== 0, "provider-smoke runs should reject post-run checks");
  assert(providerSmokeCheck.stderr.includes("adapter readiness only"), "provider-smoke check rejection should explain the boundary");

  const codexProviderSmoke = spawnSync("node", [cliPath, "provider-smoke", "--runner", "codex", "--allow-dirty", "--cwd", tempRoot], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(codexProviderSmoke.status === 0, "mocked codex provider smoke should complete");
  const codexProviderSmokeSummary = JSON.parse(codexProviderSmoke.stdout);
  assert(codexProviderSmokeSummary.purpose === "provider_smoke", "codex provider smoke should mark purpose");
  assert(codexProviderSmokeSummary.changed_files.length === 0, "codex provider smoke should not report file changes");

  const geminiProviderSmoke = spawnSync("node", [cliPath, "provider-smoke", "--runner", "gemini", "--allow-dirty", "--cwd", tempRoot], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(geminiProviderSmoke.status === 0, "mocked gemini provider smoke should complete");
  const geminiProviderSmokeSummary = JSON.parse(geminiProviderSmoke.stdout);
  assert(geminiProviderSmokeSummary.purpose === "provider_smoke", "gemini provider smoke should mark purpose");
  assert(geminiProviderSmokeSummary.changed_files.length === 0, "gemini provider smoke should not report file changes");

  const postSmokeReleaseCheck = JSON.parse(run("node", [cliPath, "release-check", "--cwd", tempRoot]).stdout);
  assert(postSmokeReleaseCheck.gates.find((gate) => gate.name === "claude_smoke_evidence")?.ok === true, "release-check should accept explicit claude provider-smoke evidence");
  assert(postSmokeReleaseCheck.gates.find((gate) => gate.name === "codex_smoke_evidence")?.ok === true, "release-check should accept explicit codex provider-smoke evidence");
  assert(postSmokeReleaseCheck.gates.find((gate) => gate.name === "gemini_smoke_evidence")?.ok === true, "release-check should accept explicit gemini provider-smoke evidence");
  const postSmokeList = run("node", [cliPath, "ls", "--cwd", tempRoot]).stdout;
  assert(postSmokeList.includes("Rux provider smoke for claude. Do not edit files."), "ls should keep provider-smoke tasks readable");
  assert(!postSmokeList.includes("\nDo not edit files."), "ls should collapse multi-line task text");

  const probeRun = spawnSync("node", [
    cliPath,
    "run",
    "probe guard",
    "--runner",
    "codex",
    "--allow-dirty",
    "--purpose",
    "probe",
    "--check",
    "node --version",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(probeRun.status === 0, "mocked probe run should complete");
  const probeSummary = JSON.parse(probeRun.stdout);
  assert(probeSummary.purpose === "probe", "--purpose probe runs should record probe purpose");

  const suggestResult = run("node", [cliPath, "suggest", "guard", "--cwd", tempRoot]);
  const suggestion = JSON.parse(suggestResult.stdout);
  assert(suggestion.recommendation.runner === "claude", "suggest should choose accepted live claude evidence");
  assert(suggestion.recommendation.model === "claude-sonnet-smoke", "suggest should include model metadata");
  assert(suggestion.recommendation.effort === "high", "suggest should include effort metadata");
  assert(suggestion.recommendation.confidence === "thin_local_evidence", "single accepted run should be thin evidence");
  assert(suggestion.recommendation.maturity.level === "thin", "suggest should expose recommendation maturity");
  assert(suggestion.evidence.maturity.strongest_level === "thin", "suggest evidence maturity should stay thin for one-run groups");
  assert(suggestion.evidence.eligible_runs === 4, "accepted and checked live provider runs should be eligible");
  assert(suggestion.evidence.ignored_reasons.fake_runner >= 1, "suggest should ignore fake runner history");
  assert(suggestion.evidence.ignored_reasons.not_live >= 1, "suggest should ignore imported history");
  assert(suggestion.evidence.ignored_reasons.unlabeled >= 1, "suggest should ignore unlabeled provider runs");
  assert(suggestion.evidence.ignored_reasons.check_modified_files >= 1, "suggest should ignore runs with mutating checks");
  assert(suggestion.evidence.ignored_reasons.provider_smoke >= 3, "suggest should ignore provider-smoke runs");
  assert(suggestion.evidence.ignored_reasons.probe_run >= 1, "suggest should ignore probe runs by default");

  // --in-session weighs handoff cost: an agent already holding the local context
  // should not be told to hand off on thin evidence. tempRoot's best is thin claude.
  const thinSameStay = JSON.parse(run("node", [cliPath, "suggest", "guard", "--cwd", tempRoot, "--in-session", "claude"]).stdout);
  assert(thinSameStay.recommendation.continue_in_session === true, "in-session matching the evidence runner should stay in session");
  assert(thinSameStay.recommendation.handoff === "skip", "staying in session should skip the handoff");
  assert(thinSameStay.recommendation.runner === "claude", "in-session stay should name the current-session runner");
  assert(thinSameStay.recommendation.evidence_runner === "claude", "in-session stay should attribute the maturity to its evidence runner");
  const thinOtherStay = JSON.parse(run("node", [cliPath, "suggest", "guard", "--cwd", tempRoot, "--in-session", "codex"]).stdout);
  assert(thinOtherStay.recommendation.continue_in_session === true, "thin evidence for a different runner should not justify a handoff");
  assert(thinOtherStay.recommendation.runner === "codex", "thin in-session stay should keep the asking-session runner");
  assert(thinOtherStay.recommendation.reason.includes("not a clear enough advantage"), "thin stay reason should explain the handoff is not justified");

  // Build directional claude evidence (3 labeled runs) to prove a real advantage still hands off.
  const inSessionRoot = join(tempRoot, "in-session-directional");
  await mkdir(inSessionRoot, { recursive: true });
  run("git", ["init"], inSessionRoot);
  await writeFile(join(inSessionRoot, "README.md"), "# In Session\n", "utf8");
  run("git", ["add", "README.md"], inSessionRoot);
  run("git", ["commit", "-m", "initial"], inSessionRoot, {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  });
  const gitIdentity = {
    GIT_AUTHOR_NAME: "Rux Smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.com",
    GIT_COMMITTER_NAME: "Rux Smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.com"
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const feature = `feature-${attempt}.txt`;
    await writeFile(join(inSessionRoot, feature), `feature ${attempt}\n`, "utf8");
    run("node", [cliPath, "record", "implement a feature", "--runner", "claude", "--task-kind", "feature", "--check", "node --version", "--write-scope", feature, "--cwd", inSessionRoot]);
    run("git", ["add", feature], inSessionRoot);
    run("git", ["commit", "-m", `feature ${attempt}`], inSessionRoot, gitIdentity);
  }
  const directionalPlain = JSON.parse(run("node", [cliPath, "suggest", "implement a feature", "--cwd", inSessionRoot]).stdout);
  assert(directionalPlain.recommendation.runner === "claude", "three labeled claude runs should recommend claude");
  assert(directionalPlain.recommendation.maturity.level === "directional", "three labeled runs should reach directional maturity");
  const directionalHandoff = JSON.parse(run("node", [cliPath, "suggest", "implement a feature", "--cwd", inSessionRoot, "--in-session", "codex"]).stdout);
  assert(directionalHandoff.recommendation.continue_in_session === false, "directional evidence for another runner should still recommend a handoff");
  assert(directionalHandoff.recommendation.handoff === "recommended", "directional advantage should label the handoff");
  assert(directionalHandoff.recommendation.runner === "claude", "directional handoff should name the evidence runner, not the current session");
  assert(directionalHandoff.recommendation.reason.includes("clear enough advantage"), "directional handoff reason should explain the advantage clears the bar");
  const directionalSame = JSON.parse(run("node", [cliPath, "suggest", "implement a feature", "--cwd", inSessionRoot, "--in-session", "claude"]).stdout);
  assert(directionalSame.recommendation.continue_in_session === true, "matching the directional evidence runner should still stay (no handoff cost)");
  const badInSession = spawnSync("node", [cliPath, "suggest", "guard", "--cwd", tempRoot, "--in-session", "fake"], { encoding: "utf8" });
  assert(badInSession.status !== 0, "fake is a smoke stand-in, not a real session, and should be rejected");
  assert(badInSession.stderr.includes("Unknown --in-session runner"), "in-session error should name the problem and list real runners");

  const rankResult = run("node", [cliPath, "rank", "--task-kind", "unspecified", "--cwd", tempRoot]);
  const ranking = JSON.parse(rankResult.stdout);
  assert(ranking.evidence.eligible_runs === 4, "rank should use eligible live provider runs for the scope");
  assert(ranking.rankings[0]?.candidates[0]?.runner === "claude", "rank should put accepted claude evidence first");
  assert(ranking.rankings[0]?.candidates[0]?.roster === "solo", "rank should include roster in candidates");
  assert(ranking.rankings[0]?.candidates[0]?.model === "claude-sonnet-smoke", "rank should include model in candidates");
  assert(ranking.rankings[0]?.candidates[0]?.effort === "high", "rank should include effort in candidates");
  assert(ranking.rankings[0]?.candidates[0]?.maturity.level === "thin", "rank should expose candidate maturity");
  assert(ranking.evidence.maturity.strongest_level === "thin", "rank should expose evidence maturity");
  assert(ranking.evidence.ignored_reasons.not_live >= 1, "rank should ignore imported history");
  assert(ranking.evidence.ignored_reasons.fake_runner >= 1, "rank should ignore fake runner history");
  assert(ranking.evidence.ignored_reasons.check_modified_files >= 1, "rank should ignore runs with mutating checks");
  assert(ranking.evidence.ignored_reasons.provider_smoke >= 3, "rank should ignore provider-smoke runs");
  assert(ranking.evidence.ignored_reasons.probe_run >= 1, "rank should ignore probe runs by default");
  const rankWithProbes = JSON.parse(run("node", [cliPath, "rank", "--task-kind", "unspecified", "--include-probes", "--cwd", tempRoot]).stdout);
  assert(rankWithProbes.evidence.include_probes === true, "rank --include-probes should mark probe inclusion");
  assert(rankWithProbes.evidence.eligible_runs === ranking.evidence.eligible_runs + 1, "rank --include-probes should include checked probe evidence");
  assert(!rankWithProbes.evidence.ignored_reasons.probe_run, "rank --include-probes should not ignore probes as probes");

  const evidencePlanRun = spawnSync("node", [cliPath, "plan", "guard", "--cwd", tempRoot], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(evidencePlanRun.status === 0, "evidence-backed plan should complete");
  const evidencePlan = JSON.parse(evidencePlanRun.stdout);
  assert(evidencePlan.recommendation.runner === "claude", "plan should reuse accepted live claude evidence");
  assert(evidencePlan.recommendation.model === "claude-sonnet-smoke", "plan should carry evidence-backed model metadata");
  assert(evidencePlan.recommendation.effort === "high", "plan should carry evidence-backed effort metadata");
  assert(evidencePlan.recommendation.roster === "solo", "plan should reuse evidence-backed roster");
  assert(evidencePlan.recommendation.maturity.level === "thin", "plan should expose selected evidence maturity");
  assert(evidencePlan.runner_source === "evidence", "plan should label evidence-backed runner source");
  assert(evidencePlan.command.includes("--model claude-sonnet-smoke"), "plan command should include recommended model metadata");
  assert(evidencePlan.command.includes("--effort high"), "plan command should include recommended effort metadata");

  const overridePlanRun = spawnSync("node", [
    cliPath,
    "plan",
    "build an integration workflow architecture for release",
    "--runner",
    "claude",
    "--roster",
    "plan-code-review",
    "--planner-runner",
    "codex",
    "--reviewer-runner",
    "claude",
    "--cwd",
    tempRoot
  ], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ""}` }
  });
  assert(overridePlanRun.status === 0, "override plan should complete");
  const overridePlan = JSON.parse(overridePlanRun.stdout);
  assert(overridePlan.recommendation.roster === "plan-code-review", "plan should honor explicit roster override");
  assert(overridePlan.runner_by_role.planner === "codex", "plan should honor planner runner override");
  assert(overridePlan.runner_by_role.coder === "claude", "plan should default coder to primary runner");
  assert(overridePlan.runner_by_role.reviewer === "claude", "plan should honor reviewer runner override");
  assert(overridePlan.recommendation.roles.map((role) => role.role).join(",") === "planner,coder,reviewer", "plan should preview fixed chain role order");
  assert(overridePlan.recommendation.one_agent_not_enough.includes("scoping, implementation, and review"), "multi-agent plans should explain why one agent is not enough");

  const doctorResult = run("node", [cliPath, "doctor", "--cwd", tempRoot], repoRoot, {
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  });
  const doctor = JSON.parse(doctorResult.stdout);
  assert(doctor.node.ok === true, "doctor should accept the current Node runtime");
  assert(doctor.git.inside_work_tree === true, "doctor should detect the temp git repo");
  assert(doctor.runners.find((runner) => runner.name === "claude")?.available === true, "doctor should see mocked claude on PATH");
  assert(doctor.runners.find((runner) => runner.name === "codex")?.available === true, "doctor should see mocked codex on PATH");
  assert(doctor.runners.find((runner) => runner.name === "gemini")?.available === true, "doctor should see mocked gemini on PATH");
  assert(doctor.store.runs >= 1, "doctor should summarize local run records");
  assert(doctor.store.checks >= 1, "doctor should count post-run check records");
  assert(doctor.store.reports >= 1, "doctor should count report records");

  const statusResult = run("node", [cliPath, "status", "--cwd", tempRoot], repoRoot, {
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  });
  const status = JSON.parse(statusResult.stdout);
  assert(status.ledger.runs >= 1, "status should summarize run records");
  assert(status.policy.exists === true, "status should expose committed policy file");
  assert(status.policy.parallel_provider_cli_runs === false, "status should expose concurrency policy");
  assert(status.outcomes.labels.human_accepted >= 1, "status should count human accepted outcomes");
  assert(status.ledger.checks >= 1, "status should count post-run check records");
  assert(status.ledger.reports >= 1, "status should count report records");
  assert(status.outcomes.labels.checks_passed >= 2, "status should count check-passing outcomes");
  assert(status.outcomes.labels.checks_failed >= 1, "status should count failing check outcomes");
  assert(status.outcomes.labels.provider_smoke_passed >= 3, "status should count provider smoke outcomes");
  assert(status.evidence.eligible_runs === 4, "status should summarize recommendation-eligible evidence");
  assert(status.evidence.maturity.strongest_level === "thin", "status should show thin maturity when no setup has repeated evidence");
  assert(status.evidence.ignored_reasons.check_modified_files >= 1, "status should expose mutating-check evidence as ignored");
  assert(status.evidence.live_provider_task_runs >= 4, "status should count live provider task runs separately from smoke");
  assert(status.evidence.provider_smoke_runs >= 3, "status should count provider-smoke runs separately");
  assert(status.next_capture.needed === false, "status should stop asking for first capture once eligible evidence exists");
  assert(status.next_capture.provider_call_required === false, "evidence-backed status should not ask for a provider call");
  assert(status.next_capture.writes_ledger === false, "evidence-backed status should not ask for a ledger write");
  assert(status.next_capture.human_review_required === false, "evidence-backed status should not ask for review");
  assert(status.provider_smoke.find((item) => item.runner === "codex")?.ok === true, "status should include codex smoke state");
  assert(status.provider_smoke.find((item) => item.runner === "gemini")?.ok === true, "status should include gemini smoke state");
  assert(status.release.blockers.includes("package_private_removed"), "status should include release blockers");
  assert(status.release.blocker_summary.one_time.includes("package_private_removed"), "status should expose one-time release blockers");
  assert(status.release.blocker_summary.permanent.includes("worktree_clean"), "status should expose permanent release blockers");
  assert(status.latest_runs.length > 0, "status should include recent run summaries");
  assert(status.latest_runs.every((item) => item.task_summary && !item.task_summary.includes("\n")), "status latest run summaries should be one-line");
  assert(status.notes.some((note) => note.includes("read-only")), "status should say it is read-only");

  const exportResult = JSON.parse(run("node", [cliPath, "export", "--cwd", tempRoot, "--limit", "3"]).stdout);
  assert(exportResult.scope === "recent_runs", "export should default to recent run scope");
  assert(exportResult.runs.length === 3, "export should honor limit");
  assert(exportResult.counts.truncated === true, "export should report truncation when limit is smaller than history");
  assert(exportResult.runs[0].outcome.label, "exported runs should include outcome summary");
  assert(exportResult.runs[0].routing, "exported runs should include routing summary");
  assert(exportResult.runs[0].replay, "exported runs should include replay metadata");
  assert("status_reason" in exportResult.runs[0], "exported runs should include status reason");
  assert(exportResult.runs[0].adapter, "exported runs should include adapter metadata");
  assert(!("transcript" in exportResult.runs[0]), "export should omit transcript text by default");

  const singleExport = JSON.parse(run("node", [
    cliPath,
    "export",
    "--cwd",
    tempRoot,
    "--run-id",
    summary.id,
    "--include-transcripts"
  ]).stdout);
  assert(singleExport.scope === "single_run", "single export should mark single run scope");
  assert(singleExport.include_transcripts === true, "single export should include transcript flag");
  assert(singleExport.runs.length === 1, "single export should contain one run");
  assert(singleExport.runs[0].id === summary.id, "single export should return requested run");
  assert(singleExport.runs[0].repo.before.head === summary.repo.before.head, "export should include repo snapshot");
  assert(singleExport.runs[0].replay.command === summary.replay.command, "export should preserve replay command");
  assert(singleExport.runs[0].adapter.command === "(built-in)", "export should preserve adapter metadata");
  assert(singleExport.runs[0].transcript.includes("runner: fake"), "single export should include transcript text when requested");
  const pairExport = JSON.parse(run("node", [
    cliPath,
    "export",
    "--cwd",
    tempRoot,
    "--run-id",
    pairSummary.id
  ]).stdout);
  assert(pairExport.runs[0].repo.before.head === pairSummary.repo.before.head, "export should preserve roster parent repo snapshot");
  const codexCheckExport = JSON.parse(run("node", [
    cliPath,
    "export",
    "--cwd",
    tempRoot,
    "--run-id",
    codexSummary.id
  ]).stdout);
  assert(codexCheckExport.runs[0].checks[0]?.source === "post_run_check", "export should preserve post-run check source");
  assert(codexCheckExport.runs[0].checks[0]?.repo?.before?.head === codexSummary.repo.after.head, "export should preserve post-run check repo state");
  assert(Array.isArray(codexCheckExport.runs[0].checks[0]?.changed_files), "export should preserve post-run check changed files");
  assert(!codexCheckExport.runs[0].replay.command.includes("node --version"), "post-run checks should not be folded into replay commands");
  assert(codexCheckExport.runs[0].routing.eligible === true, "export should use post-run checks in routing evaluation");

  const badExport = spawnSync("node", [cliPath, "export", "--cwd", tempRoot, "--limit", "0"], { encoding: "utf8" });
  assert(badExport.status !== 0, "export should reject invalid limit");
  assert(badExport.stderr.includes("--limit must be a positive integer"), "export should explain invalid limit");

  const releaseCheckResult = run("node", [cliPath, "release-check", "--cwd", repoRoot]);
  const releaseCheck = JSON.parse(releaseCheckResult.stdout);
  assert(releaseCheck.ready === true, "release-check should pass for the committed release repo");
  const strictReleaseCheckResult = spawnSync("node", [cliPath, "release-check", "--cwd", repoRoot, "--strict"], { encoding: "utf8" });
  assert(strictReleaseCheckResult.status === 0, "strict release-check should pass for the committed release repo");
  assert(JSON.parse(strictReleaseCheckResult.stdout).ready === true, "strict release-check should still print JSON");
  const nameGate = releaseCheck.gates.find((gate) => gate.name === "name_release_decision");
  assert(nameGate?.ok === true, "release-check should pass once the release name is selected");
  assert(nameGate?.lifecycle === "one_time", "release-check should classify name decision as one-time");
  assert(releaseCheck.blocker_summary.total === 0, "release-check should have no blockers for the committed release repo");
  assert(releaseCheck.gates.find((gate) => gate.name === "package_scope_matches_npm_org")?.ok === true, "release-check should require the moshpits npm org scope");
  assert(releaseCheck.gates.find((gate) => gate.name === "package_private_removed")?.ok === true, "release-check should pass once package privacy is deliberately removed");
  assert(releaseCheck.gates.find((gate) => gate.name === "package_private_removed")?.lifecycle === "one_time", "release-check should mark package privacy as one-time");
  assert(releaseCheck.gates.find((gate) => gate.name === "package_files_allowlist")?.ok === true, "release-check should require scoped package files");
  assert(releaseCheck.gates.find((gate) => gate.name === "policy_file")?.ok === true, "release-check should accept repo policy file");
  assert(releaseCheck.gates.find((gate) => gate.name === "prepublish_release_guard")?.ok === true, "release-check should require npm publish guard");
  assert(releaseCheck.gates.find((gate) => gate.name === "worktree_clean")?.ok === true, "release-check should pass for a clean committed release repo");
  assert(typeof releaseCheck.gates.find((gate) => gate.name === "real_provider_task_evidence")?.ok === "boolean", "release-check should report real provider task evidence gate state");
  assert(typeof releaseCheck.gates.find((gate) => gate.name === "gemini_smoke_evidence")?.ok === "boolean", "release-check should report gemini provider-smoke gate state");
  assert(releaseCheck.gates.find((gate) => gate.name === "no_local_only_language")?.ok === true, "release-check should confirm local-only wording is gone");

  const proposalResult = run("node", [cliPath, "propose", "--cwd", tempRoot]);
  const proposalSummary = JSON.parse(proposalResult.stdout);
  assert(proposalSummary.proposal_path.endsWith(".md"), "propose should write a markdown proposal");
  assert(proposalSummary.release.ready === false, "proposal should include release readiness");
  assert(proposalSummary.release.blocker_summary.by_lifecycle.one_time >= 1, "proposal should include release blocker lifecycle summary");
  assert(proposalSummary.findings.some((finding) => finding.category === "release"), "proposal should include release readiness finding");
  assert(proposalSummary.cited_run_ids.includes(importedSummary.id), "proposal should cite imported history when present");
  assert(proposalSummary.findings.some((finding) => finding.category === "labels" && finding.run_ids.length > 0), "proposal should cite unlabeled provider runs");
  const proposal = await readFile(join(tempRoot, proposalSummary.proposal_path), "utf8");
  assert(proposal.includes("# Rux Proposal"), "proposal should have a clear heading");
  assert(proposal.includes("- Release ready: no"), "proposal markdown should include release readiness");
  assert(proposal.includes("- One-time blockers:"), "proposal markdown should separate one-time blockers");
  assert(proposal.includes("Release-check is not ready."), "proposal markdown should include release blocker finding");
  assert(proposal.includes("This proposal is advisory."), "proposal should state the human-action guardrail");

  const lifecycleRun = JSON.parse(run("node", [
    cliPath,
    "run",
    "exercise lifecycle marks",
    "--runner",
    "fake",
    "--cwd",
    tempRoot
  ]).stdout);
  const acceptedMark = JSON.parse(run("node", [
    cliPath,
    "mark",
    lifecycleRun.id,
    "accepted-downstream",
    "--note",
    "merged after review",
    "--cwd",
    tempRoot
  ]).stdout);
  assert(acceptedMark.mark === "accepted-downstream", "mark should record downstream acceptance");
  const acceptedLifecycleOutcome = JSON.parse(run("node", [cliPath, "outcome", lifecycleRun.id, "--cwd", tempRoot]).stdout);
  assert(acceptedLifecycleOutcome.outcome.label === "accepted_downstream", "outcome should prefer downstream acceptance mark");

  run("node", [
    cliPath,
    "mark",
    lifecycleRun.id,
    "replayed",
    "--note",
    "rerun for comparison",
    "--cwd",
    tempRoot
  ]);
  run("node", [
    cliPath,
    "mark",
    lifecycleRun.id,
    "reverted",
    "--note",
    "rolled back after regression",
    "--cwd",
    tempRoot
  ]);

  const lifecycleShow = JSON.parse(run("node", [cliPath, "show", lifecycleRun.id, "--cwd", tempRoot]).stdout);
  assert(lifecycleShow.marks.length === 3, "show should include lifecycle marks");
  assert(lifecycleShow.evaluation.latest_mark.mark === "reverted", "eval should expose latest lifecycle mark");
  assert(lifecycleShow.evaluation.outcome.label === "reverted_downstream", "reverted mark should override earlier positive signals");
  assert(lifecycleShow.evaluation.outcome.risks.includes("replayed_downstream"), "outcome should retain replayed downstream risk");
  assert(lifecycleShow.evaluation.routing.blockers.includes("reverted_downstream"), "reverted runs should be blocked from routing");

  const lifecycleExport = JSON.parse(run("node", [cliPath, "export", "--cwd", tempRoot, "--run-id", lifecycleRun.id]).stdout);
  assert(lifecycleExport.runs[0].marks.length === 3, "export should include lifecycle marks");
  assert(lifecycleExport.runs[0].outcome.label === "reverted_downstream", "export should include lifecycle-aware outcome");

  const lifecycleStatus = JSON.parse(run("node", [cliPath, "status", "--cwd", tempRoot], repoRoot, {
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  }).stdout);
  assert(lifecycleStatus.ledger.marks >= 3, "status should count lifecycle marks");
  assert(lifecycleStatus.outcomes.labels.reverted_downstream >= 1, "status should count reverted downstream outcomes");
  const lifecycleDoctor = JSON.parse(run("node", [cliPath, "doctor", "--cwd", tempRoot], repoRoot, {
    PATH: `${tempBin}:${process.env.PATH ?? ""}`
  }).stdout);
  assert(lifecycleDoctor.store.marks >= 3, "doctor should count lifecycle marks");
  const lifecycleList = run("node", [cliPath, "ls", "--cwd", tempRoot]).stdout;
  assert(lifecycleList.includes("mark=reverted  exercise lifecycle marks"), "ls should show the latest lifecycle mark");

  console.log("smoke ok");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function run(command, args, cwd = repoRoot, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv }
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `exit: ${result.status}`,
        result.stdout,
        result.stderr
      ].join("\n")
    );
  }

  return result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isJsonOutput(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

async function installMockClaude(binDir) {
  await mkdir(binDir, { recursive: true });
  const mockPath = join(binDir, "claude");
  await writeFile(
    mockPath,
    [
      "#!/bin/sh",
      "case \" $* \" in",
      "  *\"--output-format stream-json\"*)",
      "    printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"claude-stream-mock\"}'",
      "    printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"mock claude streamed chunk\"}]}}'",
      "    printf '%s\\n' '{\"type\":\"result\",\"result\":\"mock claude streamed response\",\"model\":\"claude-stream-mock\",\"total_cost_usd\":0.07,\"duration_ms\":1200}'",
      "    exit 0",
      "    ;;",
      "  *\"cost mix guard\"*)",
      "    printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"mock claude cost mix response\",\"total_cost_usd\":0.05,\"modelUsage\":{\"claude-haiku-4-5-20251001\":{\"inputTokens\":99999,\"outputTokens\":99999,\"costUSD\":0},\"claude-opus-4-8[1m]\":{\"inputTokens\":5,\"outputTokens\":5,\"costUSD\":0.05}}}'",
      "    exit 0",
      "    ;;",
      "  *\"--output-format json\"*)",
      "    printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"mock claude structured response\",\"total_cost_usd\":0.0538,\"usage\":{\"input_tokens\":12,\"output_tokens\":4},\"modelUsage\":{\"claude-haiku-4-5-20251001\":{\"inputTokens\":441,\"outputTokens\":13,\"costUSD\":0.0005},\"claude-opus-4-8[1m]\":{\"inputTokens\":5075,\"outputTokens\":5,\"costUSD\":0.0533}}}'",
      "    exit 0",
      "    ;;",
      "esac",
      "printf 'mock claude text fallback\\n'",
      ""
    ].join("\n"),
    "utf8"
  );
  await chmod(mockPath, 0o755);
}

async function installMockCodex(binDir) {
  await mkdir(binDir, { recursive: true });
  const mockPath = join(binDir, "codex");
  await writeFile(
    mockPath,
    [
      "#!/bin/sh",
      "printf 'mock codex diagnostic\\n' >&2",
      "case \" $* \" in",
      "  *\" --json \"*)",
      "    printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"thread-mock\"}'",
      "    printf '%s\\n' '{\"type\":\"turn.started\"}'",
      "    printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"mock codex structured response\"}}'",
      "    printf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":24182,\"cached_input_tokens\":2432,\"output_tokens\":42}}'",
      "    exit 0",
      "    ;;",
      "esac",
      "printf 'mock codex text fallback\\n'",
      ""
    ].join("\n"),
    "utf8"
  );
  await chmod(mockPath, 0o755);
}

async function installMockGemini(binDir) {
  await mkdir(binDir, { recursive: true });
  const mockPath = join(binDir, "gemini");
  await writeFile(
    mockPath,
    [
      "#!/bin/sh",
      "case \" $* \" in",
      "  *\"untracked directory attribution\"*)",
      "    printf 'I created an untracked directory.\\n'",
      "    mkdir -p provider-output/nested",
      "    printf 'one\\n' > provider-output/one.md",
      "    printf 'two\\n' > provider-output/nested/two.md",
      "    exit 0",
      "    ;;",
      "  *\"dirty content attribution\"*)",
      "    printf 'I modified an already-dirty file.\\n'",
      "    printf 'after\\n' > dirty-content.txt",
      "    exit 0",
      "    ;;",
      "  *\"scope plan input precedence\"*)",
      "    printf 'I changed a file and still need approval.\\n'",
      "    printf 'Do you agree with this approach?\\n'",
      "    printf 'changed\\n' > scope-plan-input-edited.txt",
      "    exit 0",
      "    ;;",
      "  *\"scope check failed precedence\"*)",
      "    printf 'I edited outside scope before the check failed.\\n'",
      "    printf 'changed\\n' > scope-check-failed-edited.txt",
      "    exit 0",
      "    ;;",
      "  *\"plan check failed precedence\"*)",
      "    printf 'I changed a file before the check failed.\\n'",
      "    printf 'changed\\n' > plan-check-failed-edited.txt",
      "    exit 0",
      "    ;;",
      "  *\"plan input precedence\"*)",
      "    printf 'I changed a file and have a question.\\n'",
      "    printf 'Do you agree with this approach?\\n'",
      "    printf 'changed\\n' > plan-input-edited.txt",
      "    exit 0",
      "    ;;",
      "  *\"needs input check failed precedence\"*)",
      "    printf 'Do you agree with this approach?\\n'",
      "    exit 0",
      "    ;;",
      "  *\"scoped write edits\"*)",
      "    printf 'I edited outside the requested scope.\\n'",
      "    printf 'changed\\n' > out-of-scope-edited.txt",
      "    exit 0",
      "    ;;",
      "  *\"plan mode edits\"*)",
      "    printf 'I changed a file even though the adapter requested plan mode.\\n'",
      "    printf 'changed\\n' > plan-mode-edited.txt",
      "    exit 0",
      "    ;;",
      "  *\"needs provider approval\"*)",
      "    printf 'I found a scoped implementation approach.\\n'",
      "    printf 'Do you agree with this approach? If so, I will draft the implementation plan.\\n'",
      "    exit 0",
      "    ;;",
      "  *\"soft provider approval\"*)",
      "    printf 'Does this targeted standardization approach align with your expectations?\\n'",
      "    printf 'Let me know and I will write up the formal plan.\\n'",
      "    exit 0",
      "    ;;",
      "esac",
      "case \" $* \" in",
      "  *\"--output-format json\"*)",
      "    printf '%s\\n' '{\"session_id\":\"gemini-mock-session\",\"response\":\"mock gemini structured response\",\"stats\":{\"models\":{\"gemini-mock-json\":{\"api\":{\"totalRequests\":1},\"tokens\":{\"input\":10,\"output\":5,\"total\":15}}}}}'",
      "    exit 0",
      "    ;;",
      "esac",
      "printf 'mock gemini text fallback\\n'",
      ""
    ].join("\n"),
    "utf8"
  );
  await chmod(mockPath, 0o755);
}
