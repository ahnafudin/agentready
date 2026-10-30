// Guards scripts/lib/util.mjs. Load-bearing: the managed-block editor never eats hand-written lines,
// and the dubious-ownership detector stops a misleading "run git init" suggestion.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
  dubiousOwnership,
  hasShellMetachars,
  isUnrenamed,
  NEEDS_SHELL,
  PLACEHOLDER_NAME,
  norm,
  parseFlags,
  ROOT,
  runTool,
  safeDirectoryHint,
  tryRun,
  upsertManagedBlock,
} from "../lib/util.mjs";
import { validate } from "../lib/jsonschema.mjs";

describe("upsertManagedBlock", () => {
  it("appends a block to a file that has none", () => {
    const out = upsertManagedBlock("keep me\n", "stack-ignores", "dist/\n.next/");
    assert.match(out, /^keep me\n/);
    assert.match(out, /# >>> tooling:stack-ignores\ndist\/\n\.next\/\n# <<< tooling:stack-ignores\n$/);
  });

  it("replaces only the block body and preserves text on both sides", () => {
    const first = upsertManagedBlock("above\n", "stack-ignores", "old/");
    const withTail = first + "below\n";
    const second = upsertManagedBlock(withTail, "stack-ignores", "new/");
    assert.match(second, /above/);
    assert.match(second, /below/);
    assert.match(second, /new\//);
    assert.doesNotMatch(second, /old\//);
    assert.equal(second.match(/>>> tooling:stack-ignores/g).length, 1, "must not duplicate the block");
  });

  it("is idempotent", () => {
    const once = upsertManagedBlock("x\n", "b", "line");
    assert.equal(upsertManagedBlock(once, "b", "line"), once);
  });

  it("keeps blocks with different names independent", () => {
    let out = upsertManagedBlock("", "a", "1");
    out = upsertManagedBlock(out, "b", "2");
    out = upsertManagedBlock(out, "a", "3");
    assert.match(out, /# >>> tooling:a\n3\n# <<< tooling:a/);
    assert.match(out, /# >>> tooling:b\n2\n# <<< tooling:b/);
  });

  it("honours a different comment marker", () => {
    assert.match(upsertManagedBlock("", "x", "y", "//"), /\/\/ >>> tooling:x/);
  });
});

describe("dubiousOwnership", () => {
  it("recognises git's refusal so callers do not blame a missing repo", () => {
    const real = [
      "fatal: detected dubious ownership in repository at 'D:/code/project'",
      "'D:/code/project/.git' is owned by:",
      "\t(inconvertible) (S-1-5-21-1)",
      "but the current user is:",
      "\tHOST/user (S-1-5-21-2)",
    ].join("\n");
    assert.equal(dubiousOwnership(real), true);
  });

  it("does not fire on an ordinary not-a-repo error", () => {
    assert.equal(dubiousOwnership("fatal: not a git repository (or any of the parent directories): .git"), false);
    assert.equal(dubiousOwnership(""), false);
    assert.equal(dubiousOwnership(undefined), false);
  });

  it("hands back a runnable remedy", () => {
    const hint = safeDirectoryHint("/tmp/some project");
    assert.match(hint, /^git config --global --add safe\.directory "/);
    assert.doesNotMatch(hint, /\\/, "the path must use forward slashes — git rejects backslashes here");
  });
});

describe("norm", () => {
  it("normalises separators so path comparisons survive Windows", () => {
    assert.ok(!norm("a/b").includes("\\"));
  });

  it("sees a symlinked directory as its target, as git does", () => {
    const base = mkdtempSync(join(tmpdir(), "tooling-norm-"));
    try {
      const target = join(base, "real");
      mkdirSync(target);
      symlinkSync(target, join(base, "link"), "junction"); // "junction" needs no admin rights on Windows
      assert.equal(norm(join(base, "link")), norm(target));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("expands a Windows 8.3 short name, as git does", (t) => {
    if (process.platform !== "win32" || !existsSync("C:\\PROGRA~1")) return t.skip("needs a Windows short name");
    assert.equal(norm("C:\\PROGRA~1"), norm("C:\\Program Files"));
  });
});

describe("isMain", () => {
  it("recognises the script node runs, also through a symlinked path", () => {
    const base = mkdtempSync(join(tmpdir(), "tooling-main-"));
    try {
      const real = join(base, "real");
      mkdirSync(real);
      const util = pathToFileURL(join(ROOT, "scripts", "lib", "util.mjs")).href;
      writeFileSync(join(real, "main.mjs"), `import { isMain } from ${JSON.stringify(util)};\nprocess.stdout.write(String(isMain(import.meta.url)));\n`);
      symlinkSync(real, join(base, "link"), "junction");
      for (const dir of [real, join(base, "link")]) {
        const r = spawnSync(process.execPath, [join(dir, "main.mjs")], { encoding: "utf8" });
        assert.equal(r.stdout, "true", `${dir}: ${r.stderr}`);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});


describe("jsonschema (the subset used to police stacks.json)", () => {
  const schema = {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", pattern: "^[a-z-]+$" },
      tier: { enum: ["language", "framework"] },
      gates: { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "null" }] } },
      list: { type: "array", items: { type: "string" }, minItems: 1 },
    },
    additionalProperties: false,
  };

  it("accepts a valid object", () => {
    assert.deepEqual(validate({ id: "laravel", tier: "framework", gates: { test: "x", lint: null } }, schema), []);
  });

  it("reports missing required keys, bad enums, patterns and unknown keys", () => {
    const errors = validate({ tier: "nope", oops: 1 }, schema);
    assert.ok(errors.some((e) => /missing required key "id"/.test(e)));
    assert.ok(errors.some((e) => /must be one of/.test(e)));
    assert.ok(errors.some((e) => /unknown key "oops"/.test(e)));
  });

  it("checks nested items and reports the path", () => {
    const errors = validate({ id: "x", list: [1] }, schema);
    assert.ok(errors.some((e) => e.startsWith("list[0]")), errors.join("; "));
  });

  it("resolves local $ref", () => {
    const root = { definitions: { name: { type: "string" } }, properties: { a: { $ref: "#/definitions/name" } } };
    assert.deepEqual(validate({ a: "ok" }, root, root), []);
    assert.equal(validate({ a: 5 }, root, root).length, 1);
  });
});

describe("tryRun", () => {
  const node = process.execPath;

  it("surfaces stderr even on SUCCESS", () => {
    // The whole point: our scripts report progress on stderr, and a runner that
    // only returned stdout reduced every step of `npm run setup` to "done".
    const r = tryRun(node, ["-e", "process.stderr.write('progress here')"]);
    assert.equal(r.ok, true);
    assert.equal(r.err, "progress here");
  });

  it("keeps stdout clean, so a caller can read a value out of it", () => {
    const r = tryRun(node, ["-e", "process.stderr.write('noise'); process.stdout.write('https://example.com/x.git')"]);
    assert.equal(r.out, "https://example.com/x.git", "stderr must not leak into a value");
  });

  it("reports a non-zero exit with both streams in `out`", () => {
    const r = tryRun(node, ["-e", "process.stderr.write('boom'); process.exit(3)"]);
    assert.equal(r.ok, false);
    assert.match(r.out, /boom/);
  });

  it("does not throw when the command does not exist", () => {
    const r = tryRun("definitely-not-a-real-binary-xyz", []);
    assert.equal(r.ok, false);
    assert.ok(r.out.length > 0);
  });
});

describe("hasShellMetachars / runTool", () => {
  it("flags what a shell would reinterpret and allows a normal URL", () => {
    for (const bad of ['a"b', "a`b", "a$b", "a&b", "a|b", "a;b", "a>b", "a\nb", "a(b)"]) {
      assert.equal(hasShellMetachars(bad), true, `should flag ${JSON.stringify(bad)}`);
    }
    assert.equal(hasShellMetachars("https://github.com/owner/repo.git"), false);
    assert.equal(hasShellMetachars("git@github.com:owner/repo.git"), false);
  });

  it("refuses a dangerous argument rather than quoting and hoping (Windows only)", (t) => {
    if (!NEEDS_SHELL) return t.skip("no shell is involved on this platform");
    const r = runTool("gh", ["repo", "view", "https://x/y$(whoami)"]);
    assert.equal(r.ok, false);
    assert.match(r.out, /refusing to pass this through a Windows shell/);
  });

  it("still runs an ordinary command with plain arguments", () => {
    // Plain args on purpose: the guard is strict and must refuse a `-e` script full of quotes and parens.
    const r = runTool(process.execPath, ["--version"]);
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, /^v\d+\./);
  });
});

describe("isUnrenamed", () => {
  const dirs = [];
  after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const withName = (name) => {
    const dir = mkdtempSync(join(tmpdir(), "tooling-name-"));
    dirs.push(dir);
    if (name !== null) writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.1.0" }));
    return dir;
  };

  it("is true while package.json still carries the placeholder", () => {
    assert.equal(isUnrenamed(withName(PLACEHOLDER_NAME)), true);
  });

  it("is false once the project has a real name", () => {
    assert.equal(isUnrenamed(withName("acme-invoices")), false);
  });

  it("is false when there is no package.json to read", () => {
    // Never block a non-JS project that has not created the tooling manifest yet.
    assert.equal(isUnrenamed(withName(null)), false);
  });

  it("guards THIS repo — agentready keeps the personalization placeholder", (t) => {
    // Only meaningful in agentready: a derived project has a real name, and this suite travels with it.
    if (!isUnrenamed()) return t.skip("not agentready — this project has been renamed");
    assert.equal(isUnrenamed(), true, "package.json here must keep the placeholder name");
  });
});

describe("parseFlags", () => {
  // A flag typo must never fall through to the default branch, the dangerous one for a flag that does less.
  it("separates positional arguments from flags", () => {
    const r = parseFlags(["dir", "id", "--run"], { known: ["--run"] });
    assert.deepEqual(r.positional, ["dir", "id"]);
    assert.equal(r.flags.get("--run"), true);
    assert.deepEqual(r.problems, []);
  });

  it("refuses a flag it was not told about", () => {
    const r = parseFlags(["--chek"], { known: ["--check"] });
    assert.deepEqual(r.problems, ["unknown flag: --chek"]);
    assert.equal(r.flags.has("--check"), false, "a typo must never satisfy the real flag");
  });

  it("takes a value as --f=v or --f v", () => {
    for (const argv of [["--only=lint,test"], ["--only", "lint,test"]]) {
      assert.equal(parseFlags(argv, { valued: ["--only"] }).flags.get("--only"), "lint,test");
    }
  });

  it("does not swallow a following flag as a value", () => {
    // `--only --run` is a missing value, not a gate called "--run".
    const r = parseFlags(["--only", "--run"], { known: ["--run"], valued: ["--only"] });
    assert.deepEqual(r.problems, ["--only needs a value"]);
  });

  it("reports a value flag left empty", () => {
    assert.deepEqual(parseFlags(["--only="], { valued: ["--only"] }).problems, ["--only needs a value"]);
    assert.deepEqual(parseFlags(["--only"], { valued: ["--only"] }).problems, ["--only needs a value"]);
  });

  it("collects every problem, so one run reports them all", () => {
    const r = parseFlags(["--a", "--b"], { known: [] });
    assert.deepEqual(r.problems, ["unknown flag: --a", "unknown flag: --b"]);
  });
});
