// Guards that a project made from agentready inherits none of agentready's own scaffolding.
// Copies the tracked files, renames and bootstraps the copy, then runs this whole suite inside it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { at, isUnrenamed, ROOT, tryRun } from "../lib/util.mjs";
import { OWN_README_MARKER, UPSTREAM_ONLY } from "../personalize.mjs";

// Only agentready itself simulates a copy: INSIDE is the copy's own run (it would clone itself
// forever), and a project made from agentready has nothing of ours left to check.
const INSIDE = process.env.TOOLING_DERIVED_TEST === "1";
const SKIP = (INSIDE && "running inside the simulation") || (!isUnrenamed() && "only agentready itself simulates a copy");
const PROJECT_NAME = "derived-smoke-test";

let dir = null;
let setupFailure = null;

function node(args, cwd, env = {}) {
  // `NODE_TEST_CONTEXT` is inherited by children, and the runner reads it to
  // refuse a nested run ("run() is being called recursively"). Dropping it is
  // what lets the copy execute its own suite as an ordinary child process.
  const clean = { ...process.env, ...env };
  delete clean.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: clean });
}

before(() => {
  if (SKIP) return;
  // Exactly what a copy contains: the tracked files. Not node_modules,
  // not local tracker state, not anything else lying around this working tree.
  const listed = tryRun("git", ["ls-files"]);
  if (!listed.ok) {
    setupFailure = `cannot list tracked files (${listed.out})`;
    return;
  }
  dir = mkdtempSync(join(tmpdir(), "tooling-derived-"));
  for (const rel of listed.out.split(/\r?\n/).filter(Boolean)) {
    const src = at(rel);
    if (!existsSync(src)) continue;
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
  }

  // The one thing a new owner always does.
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = PROJECT_NAME;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // The bootstrap steps `npm run setup` performs that do not need git or GitHub.
  for (const script of ["personalize.mjs", "stacks.mjs"]) {
    const args = script === "stacks.mjs" ? [join(dir, "scripts", script), "apply"] : [join(dir, "scripts", script)];
    const r = node(args, dir);
    if (r.status !== 0) setupFailure = `${script} exited ${r.status}: ${r.stderr}`;
  }
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("a project made from agentready", { skip: SKIP }, () => {
  const pkg = () => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const read = (rel) => readFileSync(join(dir, rel), "utf8");

  it("bootstraps without error", () => {
    assert.equal(setupFailure, null);
    assert.ok(dir, "the copy should exist");
  });

  it("starts its version history at 0.1.0, not at agentready's release", () => {
    assert.equal(pkg().version, "0.1.0");
  });

  it("gets a README about ITSELF, with agentready's kept as tooling docs", () => {
    const readme = read("README.md");
    assert.doesNotMatch(readme, /agentready/, "the project README must not describe agentready");
    assert.ok(!readme.includes(OWN_README_MARKER));
    assert.match(readme, new RegExp(`^# ${PROJECT_NAME}`, "m"));
    assert.match(read("docs/TOOLING.md"), /agentready/, "agentready's own README is still available");
  });

  it("leaves the licence and the contribution guide to the new owner", () => {
    // agentready's MIT licence names ITS author, so at the root it would claim
    // the new project. MIT requires the notice to travel with the copied
    // tooling, so it is kept beside agentready's README instead of deleted.
    assert.ok(!existsSync(join(dir, "LICENSE")), "agentready's licence would claim the new project");
    assert.match(read("docs/TOOLING-LICENSE"), /^MIT License/, "the tooling's licence notice must survive");
    assert.ok(!existsSync(join(dir, "CONTRIBUTING.md")), "a guide to contributing to agentready is noise here");
  });

  it("drops what only serves agentready's own repository", () => {
    // verify-stacks would scaffold a dozen frameworks every month on the new project's CI.
    for (const rel of UPSTREAM_ONLY) assert.ok(existsSync(at(rel)), `${rel} is listed but agentready no longer has it`);
    for (const rel of UPSTREAM_ONLY) assert.ok(!existsSync(join(dir, rel)), `${rel} survived into the project`);
  });

  it("runs ITS gates, not agentready's maintenance checks", () => {
    const { tooling } = pkg();
    assert.ok(!("pristine" in tooling), "the one-shot marker must be consumed");
    const flat = JSON.stringify(tooling.gates);
    assert.doesNotMatch(flat, /sync-agents/, "that maintains agentready itself");
    assert.doesNotMatch(flat, /stacks\.mjs validate/, "so is that");
  });

  it("leaves the conventional `test` script free for the project", () => {
    // agentready's own suite lives at `test:tooling`; if it held `test`,
    // `npm run test --if-present` would run 120 tooling tests as the project's.
    const { scripts } = pkg();
    assert.equal(scripts.test, undefined);
    assert.ok(scripts["test:tooling"], "the tooling suite is still reachable, just renamed");
  });

  it("carries no machine-local tracker identity", () => {
    assert.equal(existsSync(join(dir, ".git", "agentready", "github.json")), false);
  });

  it("keeps every agent front door", () => {
    for (const f of [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "CONVENTIONS.md",
      ".cursor/rules/00-agents.mdc",
      ".windsurf/rules/agents.md",
      ".clinerules/00-agents.md",
      ".junie/guidelines.md",
      ".github/copilot-instructions.md",
    ]) {
      assert.ok(existsSync(join(dir, f)), `missing ${f}`);
    }
  });

  it("inherits the whole attribution defence, not just part of it", () => {
    // A bot in the contributor list only leaves by rewriting published history, so this must arrive installed.
    for (const f of [
      ".githooks/commit-msg", // strips it, once hooks are installed
      ".github/workflows/attribution.yml", // catches it when they are not
      "scripts/check-attribution.mjs",
      ".claude/settings.json",
    ]) {
      assert.ok(existsSync(join(dir, f)), `a derived project is missing ${f}`);
    }
    const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.includeCoAuthoredBy, false, "Claude Code would still add its own trailer");
    // The hook has to be ARMED before the first commit, and `npm install` may
    // never happen in a non-JS project — so a session start arms it too.
    const onStart = settings.hooks.SessionStart.flatMap((g) => g.hooks).map((h) => h.command);
    assert.ok(
      onStart.some((c) => c.includes("install-hooks")),
      "nothing installs the git hooks at session start; the first commits would be unprotected",
    );
  });

  it("passes the whole tooling suite — the check that would have caught all six", () => {
    // TAP because its `# pass N` / `# fail N` lines are stable to assert on.
    // run.mjs, not a glob: this spawn has no shell to expand one.
    const r = node(
      [join(dir, "scripts", "tests", "run.mjs"), "--test-reporter=tap"],
      dir,
      { TOOLING_DERIVED_TEST: "1" },
    );
    const out = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, 0, `the tooling suite must be green in a derived project:\n${out.slice(-2500)}`);
    assert.match(out, /# fail 0/, "no test may fail merely because the repo is not agentready");
    assert.match(out, /# pass ([1-9]\d*)/, "the suite must actually have run");
  });
});
