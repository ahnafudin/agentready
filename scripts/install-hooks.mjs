#!/usr/bin/env node
// scripts/install-hooks.mjs — makes every hook in .githooks/ the one git actually runs; idempotent, fail-soft.
// Never touches a foreign hook manager, a parent repo, or a hook that is not ours.

import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { at, git, norm, note as write, parseFlags, ROOT, safeDirectoryHint } from "./lib/util.mjs";

const HOOK_DIR = at(".githooks");
const note = (msg) => write(msg, "[hooks] ");

// Check mode reports hook configuration without changing it.
const { flags, problems } = parseFlags(process.argv.slice(2), { known: ["--check"] });
if (problems.length) {
  note(problems.join("; "));
  note("usage: install-hooks.mjs [--check]");
  process.exit(2);
}
const CHECK = flags.has("--check");

const toplevel = git(["rev-parse", "--show-toplevel"]);
if (!toplevel.ok) {
  if (toplevel.dubious) {
    note("git refuses to read this repository: it is owned by a different user account.");
    note("This is NOT a missing repo — do not run `git init`. Fix the ownership exception:");
    note(`  ${safeDirectoryHint()}`);
    note("then re-run `npm run setup`.");
  } else {
    note("not a git work tree — skipping hook install");
  }
  process.exit(0);
}

if (norm(toplevel.out) !== norm(ROOT)) {
  note(`this folder sits inside another repository (${toplevel.out}) — skipping hook install`);
  note("run `git init` here first if this is meant to be its own repo, then `npm run setup`.");
  process.exit(0);
}

if (!existsSync(HOOK_DIR)) {
  note(".githooks/ missing — nothing to install");
  process.exit(0);
}

const ours = readdirSync(HOOK_DIR).filter((f) => !f.startsWith("."));
if (ours.length === 0) {
  note(".githooks/ is empty — nothing to install");
  process.exit(0);
}

const current = git(["config", "--get", "core.hooksPath"]);
const hooksPath = current.ok ? current.out : "";

if (hooksPath === ".githooks") {
  note(`already installed (core.hooksPath=.githooks; ${ours.join(", ")})`);
} else if (hooksPath) {
  note(`core.hooksPath is already "${hooksPath}" (another hook manager?) — not overwriting.`);
  note("to enable agentready's hooks manually: git config core.hooksPath .githooks");
} else {
  if (CHECK) {
    // Not installed is not drift: a CI checkout that never ran postinstall must pass the gate.
    note("hooks are not installed here (core.hooksPath unset) — nothing to compare");
  } else {
    const set = git(["config", "core.hooksPath", ".githooks"]);
    note(set.ok ? `installed: core.hooksPath → .githooks (${ours.join(", ")})` : `install skipped: ${set.out}`);
  }
}

// Best-effort exec bit (required on POSIX; a no-op on Windows).
for (const name of ours) {
  try {
    chmodSync(join(HOOK_DIR, name), 0o755);
  } catch {
    /* ignore — Windows / restricted FS */
  }
}

if (CHECK) note("hook configuration checked");
