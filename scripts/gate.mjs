#!/usr/bin/env node
// scripts/gate.mjs — `npm run gate`: built-in checks, then tooling.gates lint → typecheck → test → build.
// `npm run gate test` runs one gate; `npm run gate:list` lists them (npm swallows a leading `--list`).

import { spawnSync } from "node:child_process";
import { reportVersionSync } from "./check-version-sync.mjs";
import { reportDesign } from "./design-check.mjs";
import { at, isMain, parseFlags, readJson } from "./lib/util.mjs";
import { reportSlop } from "./slop-check.mjs";
import { detectResolved, mergeGates } from "./stacks.mjs";

const ORDER = ["lint", "typecheck", "test", "build"];
/** Built in and always first, so no stack's gate set can drop them. */
const BUILT_IN = [
  { key: "slop", script: "scripts/slop-check.mjs", run: () => reportSlop() },
  { key: "design", script: "scripts/design-check.mjs", run: () => reportDesign() },
  { key: "version-sync", script: "scripts/check-version-sync.mjs", run: () => reportVersionSync() },
];
const BUILT_IN_KEYS = BUILT_IN.map((b) => b.key);
// 127 = POSIX "command not found"; 9009 = the cmd.exe equivalent on Windows.
const NOT_FOUND = new Set([127, 9009]);

function asList(v) {
  if (v === null || v === undefined || v === "") return [];
  return [].concat(v).filter((c) => typeof c === "string" && c.trim() !== "");
}

/** Gate order: the canonical four first, then any extras in declaration order. */
export function gateOrder(gates) {
  const extra = Object.keys(gates).filter((k) => !ORDER.includes(k));
  return [...ORDER, ...extra].filter((k) => asList(gates[k]).length > 0);
}

/** Configured gates, falling back to on-the-fly stack detection. */
export function loadGates() {
  const pkg = readJson(at("package.json"));
  const configured = pkg?.tooling?.gates;
  if (configured && Object.keys(configured).length > 0) return { gates: configured, source: "package.json" };
  const found = detectResolved();
  if (!found.primary) return { gates: {}, source: "none" };
  return { gates: mergeGates(found.primary, found.secondary), source: `detected:${found.primary.id}` };
}

function run(cmd, cwd) {
  process.stderr.write(`\n\x1b[36m$ ${cmd}\x1b[0m\n`);
  const r = spawnSync(cmd, { shell: true, stdio: "inherit", cwd });
  if (r.error) return { ok: false, code: 1, reason: r.error.message };
  const code = r.status ?? 1;
  return { ok: code === 0, code, reason: NOT_FOUND.has(code) ? "command not found" : "" };
}

/** Runs a gate set in order, stopping at the first failure. Shared with verify-stack.mjs. */
export function runGates(gates, { cwd = at(), only = [] } = {}) {
  const keys = gateOrder(gates);
  // An `only` naming no real gate must fail — selecting nothing would otherwise report a pass.
  const unknown = only.filter((k) => !keys.includes(k));
  if (unknown.length) {
    return {
      ok: false,
      passed: [],
      failed: null,
      code: 2,
      reason: `unknown gate: ${unknown.join(", ")} — available: ${keys.join(", ") || "(none configured)"}`,
    };
  }
  const selected = only.length ? keys.filter((k) => only.includes(k)) : keys;
  const passed = [];
  for (const key of selected) {
    for (const cmd of asList(gates[key])) {
      const r = run(cmd, cwd);
      if (!r.ok) return { ok: false, passed, failed: key, code: r.code, reason: r.reason };
    }
    passed.push(key);
  }
  return { ok: true, passed, failed: null };
}

function fail(failed, code, reason, passed) {
  process.stderr.write(`\n\x1b[31m[gate] FAILED at \`${failed}\` (exit ${code})${reason ? ` — ${reason}` : ""}\x1b[0m\n`);
  if (reason === "command not found") {
    process.stderr.write(
      "       This command came from the framework registry and may be unverified.\n" +
        "       Correct it in package.json → `tooling.gates`; see docs/STACK.md.\n",
    );
  }
  if (passed.length) process.stderr.write(`       Already passed: ${passed.join(", ")}\n`);
  return 1;
}

function main(argv) {
  const { positional: only, flags, problems } = parseFlags(argv, { known: ["--list"] });
  if (problems.length) {
    process.stderr.write(`[gate] ${problems.join("; ")}\n`);
    process.stderr.write("usage: gate.mjs [--list] [gate ...]\n");
    return 2;
  }
  const { gates, source } = loadGates();
  const keys = gateOrder(gates);

  if (flags.has("--list")) {
    process.stderr.write(`[gate] source: ${source}\n`);
    for (const b of BUILT_IN) process.stderr.write(`  ${b.key.padEnd(10)} node ${b.script} (built in, always first)\n`);
    for (const k of keys) for (const c of asList(gates[k])) process.stderr.write(`  ${k.padEnd(10)} ${c}\n`);
    return 0;
  }

  const rest = only.filter((k) => !BUILT_IN_KEYS.includes(k));
  const passed = [];
  for (const b of BUILT_IN) {
    if (only.length && !only.includes(b.key)) continue;
    process.stderr.write(`\n\x1b[36m$ node ${b.script}\x1b[0m\n`);
    if (b.run() !== 0) return fail(b.key, 1, "", passed);
    passed.push(b.key);
  }
  if (only.length && rest.length === 0) {
    process.stderr.write(`\n\x1b[32m[gate] PASSED: ${passed.join(" → ")}\x1b[0m\n`);
    return 0;
  }

  if (keys.length === 0) {
    process.stderr.write(
      "[gate] no gates configured yet.\n" +
        "       Run `npm run stack:apply` to fill them in from the framework registry,\n" +
        "       or write `tooling.gates` in package.json yourself. See docs/STACK.md.\n",
    );
    return 0;
  }

  const selected = rest.length ? keys.filter((k) => rest.includes(k)) : keys;
  if (rest.length && selected.length === 0) {
    process.stderr.write(`[gate] unknown gate: ${rest.join(", ")} — available: ${[...BUILT_IN_KEYS, ...keys].join(", ")}\n`);
    return 1;
  }

  const r = runGates(gates, { only: selected });
  if (!r.ok) return fail(r.failed, r.code, r.reason, [...passed, ...r.passed]);
  process.stderr.write(`\n\x1b[32m[gate] PASSED: ${[...passed, ...r.passed].join(" → ")}\x1b[0m\n`);
  return 0;
}

if (isMain(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
