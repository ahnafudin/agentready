#!/usr/bin/env node
// scripts/setup.mjs — project bootstrap without commits or pushes.

import {
  at,
  git,
  norm,
  note as write,
  ROOT,
  safeDirectoryHint,
  tryRun,
} from "./lib/util.mjs";

import { githubOrigin } from "./lib/worktree-github.mjs";

function step(msg) {
  process.stderr.write(`\n[setup] ${msg}\n`);
}
const note = (msg) => write(msg, "  ");

/** Show what a sub-script said; our scripts report on stderr, not stdout. */
function relay(result, fallback = "done") {
  const text = [result.err, result.ok ? "" : result.out].filter(Boolean).join("\n").trim();
  for (const line of (text || fallback).split(/\r?\n/)) note(line);
}

// 0. This folder must be the git toplevel, or every later step acts on a parent repository.
const toplevel = git(["rev-parse", "--show-toplevel"]);
if (!toplevel.ok) {
  if (toplevel.dubious) {
    // Never suggest `git init` here: the repo exists, and a second one would be scaffolded over it.
    step("git refuses to read this repository: it is owned by a different user account.");
    note("The repo is fine — this is an ownership check, not a missing .git. Run:");
    note(`  ${safeDirectoryHint()}`);
    note("then re-run `npm run setup`.");
  } else {
    step("not a git repository — run `git init` first, then re-run `npm run setup`.");
  }
  process.exit(1);
}
if (norm(toplevel.out) !== norm(ROOT)) {
  step(`this folder sits inside another repository (${toplevel.out}).`);
  note("run `git init` here first if this is meant to be its own repo, then re-run `npm run setup`.");
  process.exit(1);
}

// 1. git hooks (auto-version)
step("1/5 git hooks (auto-version)");
relay(tryRun(process.execPath, [at("scripts", "install-hooks.mjs")]));

// 2. personalise a pristine copy: version → 0.1.0, project README.
step("2/5 personalise this copy");
relay(tryRun(process.execPath, [at("scripts", "personalize.mjs")]));

// 3. stack detection → tooling.gates + .gitignore block + docs/STACK.md
step("3/5 framework detection");
relay(tryRun(process.execPath, [at("scripts", "stacks.mjs"), "apply"]));
note("re-run any time with `npm run stack:apply` (`npm run stack:reapply` overwrites hand-tuned gates).");

// 4. agent instruction pointers (AGENTS.md → per-tool stubs)
step("4/5 agent instruction files");
relay(tryRun(process.execPath, [at("scripts", "sync-agents.mjs")]));

step("5/5 GitHub Issues and Projects");
if (!githubOrigin(ROOT)) {
  note("No GitHub origin yet. Add your repository remote, authenticate gh, then run npm run issues:setup.");
} else {
  const tracker = tryRun(process.execPath, [at("scripts", "github-setup.mjs")]);
  relay(tracker);
  if (!tracker.ok) {
    note("Fix GitHub access, then re-run npm run issues:setup; local tooling is already installed.");
    process.exitCode = 1;
  }
}

step("local setup finished.");
note("Fill the TODO:fill sections in AGENTS.md and docs/ (checklist in SETUP.md).");
note("Check docs/STACK.md, then verify with npm run gate.");
