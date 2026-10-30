// scripts/lib/util.mjs — helpers shared by the repo's scripts.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Repo root (this file lives at <root>/scripts/lib/). */
export const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

/**
 * Run a command, never throw. On success `out` is clean stdout and `err` is stderr
 * (where our scripts report progress); on failure `out` carries both streams.
 */
export function tryRun(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
  const out = String(r.stdout ?? "").trim();
  const err = String(r.stderr ?? "").trim();
  if (r.error) return { ok: false, out: err || String(r.error.message), err };
  if (r.status === 0) return { ok: true, out, err };
  const merged = [out, err].filter(Boolean).join("\n").trim();
  return { ok: false, out: merged || `exited with code ${r.status}`, err };
}

/** Windows needs a shell to launch npm-installed `.cmd` shims; without one they fail with ENOENT. */
export const NEEDS_SHELL = process.platform === "win32";

/** Characters a shell would reinterpret; under `NEEDS_SHELL` arguments are concatenated unescaped (DEP0190). */
export function hasShellMetachars(value) {
  return /["'`$&|;<>^%\r\n()]/.test(String(value ?? ""));
}

/**
 * Run an external CLI that may be a Windows shim (see `NEEDS_SHELL`). On Windows an
 * argument a shell would reinterpret is refused, not quoted; only whitespace is quoted.
 */
export function runTool(cmd, args = [], opts = {}) {
  if (!NEEDS_SHELL) return tryRun(cmd, args, opts);
  const unsafe = args.find(hasShellMetachars);
  if (unsafe !== undefined) {
    return {
      ok: false,
      out: `refusing to pass this through a Windows shell — run it yourself: ${cmd} … ${unsafe}`,
      err: "",
    };
  }
  // Quote the command too: a tool under `C:\Program Files\…` is split at the space.
  const quote = (v) => (/\s/.test(v) ? `"${v}"` : v);
  return tryRun([quote(cmd), ...args.map(quote)].join(" "), undefined, { ...opts, shell: true });
}

/** Normalized path for equality checks, as git reports paths: symlinks and Windows 8.3 short names
 *  resolved, forward slashes, and case-folded on Windows. */
export function norm(p) {
  let real = resolve(p);
  try {
    real = realpathSync.native(real);
  } catch {
    // not on disk yet: compare it as written
  }
  const r = real.split("\\").join("/");
  return process.platform === "win32" ? r.toLowerCase() : r;
}

/** True when `moduleUrl` is the script node was started with, including through a symlinked path. */
export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

/**
 * Git's "dubious ownership" refusal: every git command exits 128, which must not be
 * mistaken for "not a git repository" (advising `git init` would nest a second repo).
 */
export function dubiousOwnership(out) {
  return /detected dubious ownership/i.test(String(out ?? ""));
}

/** The remedy line to print when `dubiousOwnership` matched. */
export function safeDirectoryHint(root = ROOT) {
  return `git config --global --add safe.directory "${resolve(root).split("\\").join("/")}"`;
}

/** `git <args>` from the repo root; `dubious` is true when the failure was the ownership refusal. */
export function git(args) {
  const r = tryRun("git", args);
  return { ...r, dubious: !r.ok && dubiousOwnership(r.out) };
}

/** Repo-root path helper. */
export function at(...parts) {
  return join(ROOT, ...parts);
}

/**
 * Split argv into positionals and flags, refusing unknown flags: a mistyped `--check`
 * must not fall through to a full rewrite. `valued` flags take `--f=v` or `--f v`.
 */
export function parseFlags(argv, { known = [], valued = [] } = {}) {
  const all = [...known, ...valued];
  const flags = new Map();
  const positional = [];
  const problems = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!all.includes(name)) {
      problems.push(`unknown flag: ${arg}`);
      continue;
    }
    if (!valued.includes(name)) {
      flags.set(name, true);
      continue;
    }
    // A following flag is never the value: `--only --run` is a missing value,
    // not a gate named "--run".
    const next = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
    if (!next || (eq === -1 && next.startsWith("-"))) {
      problems.push(`${name} needs a value`);
      continue;
    }
    if (eq === -1) i++;
    flags.set(name, next);
  }
  return { positional, flags, problems };
}

/** Read a UTF-8 file, or `null` when it does not exist. */
export function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Write only when the content actually changed; returns whether it wrote. */
export function writeIfChanged(path, next) {
  if (readIfExists(path) === next) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  return true;
}

/** The placeholder package name used until project personalization. */
export const PLACEHOLDER_NAME = "my-project";

/** True while package.json still carries the placeholder name. */
export function isUnrenamed(root = ROOT) {
  return readJson(join(root, "package.json"))?.name === PLACEHOLDER_NAME;
}

/** Parse a JSON file, or `null` when missing/unparseable. */
export function readJson(path) {
  const raw = readIfExists(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the body of a `>>> tooling:<name>` / `<<< tooling:<name>` managed block,
 * appending the block when absent. Everything outside the markers is preserved
 * verbatim, so regenerating never clobbers hand-written content.
 */
export function upsertManagedBlock(text, name, body, comment = "#") {
  const open = `${comment} >>> tooling:${name}`;
  const close = `${comment} <<< tooling:${name}`;
  const block = [open, String(body).trimEnd(), close].filter(Boolean).join("\n");
  const re = new RegExp(`${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`, "m");
  const base = text ?? "";
  if (re.test(base)) return base.replace(re, block);
  const sep = base.length === 0 ? "" : base.endsWith("\n\n") ? "" : base.endsWith("\n") ? "\n" : "\n\n";
  return `${base}${sep}${block}\n`;
}

/**
 * Marker pairs other tools fence their markdown regions with (`name:start`/`:end`,
 * `BEGIN X`/`END X`). Each marker must sit alone on its line, or prose that merely
 * shows the syntax is read as a block.
 */
const FOREIGN_BLOCK_PATTERNS = [
  /^[ \t]*<!--[ \t]*([A-Za-z0-9_.-]+):start[ \t]*-->[ \t]*$[\s\S]*?^[ \t]*<!--[ \t]*\1:end[ \t]*-->[ \t]*$/gm,
  /^[ \t]*<!--[ \t]*BEGIN[ \t]+([A-Za-z0-9_.\- ]+?)[ \t]*-->[ \t]*$[\s\S]*?^[ \t]*<!--[ \t]*END[ \t]+\1[ \t]*-->[ \t]*$/gm,
];

/** Regions of `text` another tool owns, in order, so a wholesale rewrite can keep them. */
export function foreignBlocks(text) {
  if (!text) return [];
  const found = [];
  for (const re of FOREIGN_BLOCK_PATTERNS) {
    for (const m of text.matchAll(re)) found.push({ name: m[1], text: m[0], index: m.index });
  }
  return found.sort((a, b) => a.index - b.index).map(({ name, text }) => ({ name, text }));
}

/** Generated content plus the foreign blocks, appended verbatim; idempotent, and unchanged when there are none. */
export function withForeignBlocks(generated, blocks) {
  // A block the generator itself emits is not foreign, or every run appends it again.
  const foreign = blocks.filter((b) => !generated.includes(b.text));
  if (!foreign.length) return generated;
  return [
    generated.trimEnd(),
    "",
    "<!-- The blocks below are managed by OTHER tools and are preserved across",
    "     `npm run agents:sync`. Edit each with the tool that owns it. -->",
    "",
    ...foreign.map((b) => b.text),
    "",
  ].join("\n");
}

export function note(msg, prefix = "") {
  process.stderr.write(`${prefix}${msg}\n`);
}
