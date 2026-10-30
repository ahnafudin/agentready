#!/usr/bin/env node
// scripts/personalize.mjs — turns a pristine copy of agentready into this project, once, early in setup.
// Fires only on a renamed package.json that still has `tooling.pristine` (stacks.mjs clears it next).

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { isMain, isUnrenamed, note as write, parseFlags, readJson, ROOT, writeIfChanged } from "./lib/util.mjs";

/** Marks a README as still being agentready's own, and therefore replaceable. */
export const OWN_README_MARKER = "<!-- tooling:readme -->";
/** Marks a CONTRIBUTING.md as agentready's own, and therefore removable. */
export const OWN_CONTRIBUTING_MARKER = "<!-- tooling:contributing -->";
/**
 * agentready's LICENSE, recognised by its holder line — a licence the owner
 * wrote names someone else and is never moved. (The marker trick is not used
 * here: a comment in LICENSE would stop GitHub recognising it as MIT.)
 */
const OWN_LICENSE = /^Copyright \(c\) [\d, -]+ ahnafudin$/m;
/** What serves agentready's own repository; in a project it misleads, or spends CI minutes on our registry. */
export const UPSTREAM_ONLY = [
  "docs/archive/TRACKER_MIGRATION.md",
  "docs/superpowers/plans/2026-10-30-github-tracker.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  ".github/ISSUE_TEMPLATE",
  ".github/pull_request_template.md",
  ".github/assets",
  ".github/workflows/verify-stacks.yml",
  ".github/workflows/release.yml",
  ".github/workflows/slop-action.yml",
  ".claude-plugin",
  "packages",
  "slop",
];
export const FRESH_VERSION = "0.1.0";
const KEPT_AS = join("docs", "TOOLING.md");
const LICENSE_KEPT_AS = join("docs", "TOOLING-LICENSE");

const note = (msg) => write(msg, "[personalize] ");

function projectReadme(pkg) {
  const name = pkg?.name ?? "this project";
  const description = pkg?.description?.startsWith("TODO:fill") ? "" : (pkg?.description ?? "");
  return [
    `# ${name}`,
    "",
    description || "<!-- TODO:fill — one paragraph on what this project is and who it is for. -->",
    "",
    "## Getting started",
    "",
    "```bash",
    "npm install",
    "npm run setup     # git hooks, framework detection, agent docs, issue tracker",
    "npm run gate      # lint → typecheck → test → build, whatever the language",
    "```",
    "",
    "## Where things are",
    "",
    "| For | Read |",
    "|---|---|",
    "| Rules every AI coding agent follows here | [`AGENTS.md`](AGENTS.md) |",
    "| The detected framework, where logic belongs, the gate commands | [`docs/STACK.md`](docs/STACK.md) |",
    "| Product scope and guardrails | [`docs/PRD.md`](docs/PRD.md) |",
    "| Architecture and key decisions | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |",
    "| What is being built next | [`docs/TASKS.md`](docs/TASKS.md) |",
    "| How the tooling in `scripts/` works | [`docs/TOOLING.md`](docs/TOOLING.md) |",
    "| The licence that tooling came with — keep it beside `scripts/` | [`docs/TOOLING-LICENSE`](docs/TOOLING-LICENSE) |",
    "",
  ].join("\n");
}

/**
 * Personalise a fresh copy. Returns `{ skipped, changed }`; `changed` lists the
 * files rewritten. Safe to call repeatedly — it does nothing once the project
 * has been personalised, and nothing at all in agentready itself.
 */
export function personalize({ root = ROOT } = {}) {
  const changed = [];
  if (isUnrenamed(root)) {
    return { skipped: "this IS agentready (package.json still has the placeholder name)", changed };
  }
  const pkgPath = join(root, "package.json");
  const raw = existsSync(pkgPath) ? readFileSync(pkgPath, "utf8") : null;
  const pkg = raw ? readJson(pkgPath) : null;
  if (!pkg?.tooling?.pristine) {
    return { skipped: "already personalised", changed };
  }

  // 1. Start this project's version history at 0.1.0. Targeted replacement, so
  //    package.json keeps its formatting exactly as `version.mjs` would leave it.
  if (pkg.version !== FRESH_VERSION) {
    const next = raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${FRESH_VERSION}"`);
    if (writeIfChanged(pkgPath, next)) changed.push(`package.json (version → ${FRESH_VERSION})`);
  }

  // 2. Left in place, agentready's README makes an agent think the project IS agentready.
  //    Keep it as tooling docs; a README without the marker is never touched.
  const readmePath = join(root, "README.md");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
  if (readme.includes(OWN_README_MARKER)) {
    const keptPath = join(root, KEPT_AS);
    mkdirSync(dirname(keptPath), { recursive: true });
    if (writeIfChanged(keptPath, readme)) changed.push(`${KEPT_AS.split("\\").join("/")} (agentready's docs kept here)`);
    if (writeIfChanged(readmePath, projectReadme(pkg))) changed.push("README.md (now describes this project)");
  }

  // 3. MIT's notice travels with the tooling it covers; the root is left for the owner's own licence.
  const licensePath = join(root, "LICENSE");
  const license = existsSync(licensePath) ? readFileSync(licensePath, "utf8") : "";
  if (OWN_LICENSE.test(license)) {
    writeIfChanged(join(root, LICENSE_KEPT_AS), license);
    rmSync(licensePath);
    changed.push(`LICENSE (agentready's, kept as ${LICENSE_KEPT_AS.split("\\").join("/")}; choose your own)`);
  }

  // 4. A guide to contributing to agentready has no place in a project.
  const contributingPath = join(root, "CONTRIBUTING.md");
  if (existsSync(contributingPath) && readFileSync(contributingPath, "utf8").includes(OWN_CONTRIBUTING_MARKER)) {
    rmSync(contributingPath);
    changed.push("CONTRIBUTING.md (agentready's, removed)");
  }

  // 5. Safe to remove outright: this only runs once, on a fresh copy.
  for (const rel of UPSTREAM_ONLY) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    rmSync(path, { recursive: true, force: true });
    changed.push(`${rel} (agentready's own, removed)`);
  }

  return { skipped: null, changed };
}

function main(argv = []) {
  // Takes no flags, but refuses any typed so a guessed `--force` is not silently ignored.
  const { problems } = parseFlags(argv, { known: [] });
  if (problems.length) {
    write(`${problems.join("; ")} — personalize takes no flags`);
    return 2;
  }
  const { skipped, changed } = personalize();
  if (skipped) {
    note(`nothing to do — ${skipped}.`);
    return 0;
  }
  if (!changed.length) {
    note("already personalised.");
    return 0;
  }
  for (const c of changed) note(`updated ${c}`);
  note(`agentready's own README is now ${KEPT_AS.split("\\").join("/")} — it documents scripts/.`);
  return 0;
}

if (isMain(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
