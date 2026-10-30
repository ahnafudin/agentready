// Guards that every CLI refuses an unknown flag, by spawning each one for real.
// A typo must never fall through to the default branch, which is the dangerous one for a flag that does LESS.
// A bogus flag is safe to run: refusal happens before any work.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

const CASES = [
  { name: "gate.mjs", argv: ["--lst"] },
  { name: "check-version-sync.mjs", argv: ["--chek"] },
  { name: "sync-agents.mjs", argv: ["--chek"] },
  { name: "personalize.mjs", argv: ["--forse"] },
  { name: "stacks.mjs", argv: ["apply", "--forse"] },
  { name: "verify-stack.mjs", argv: [".", "node", "--onyl=lint"] },
  { name: "install-hooks.mjs", argv: ["--chek"] },
  { name: "check-attribution.mjs", argv: ["--rnge=a..b"] },
];

describe("CLI flag handling", () => {
  for (const { name, argv } of CASES) {
    it(`${name} refuses ${argv.at(-1)}`, () => {
      const r = spawnSync(process.execPath, [script(name), ...argv], { encoding: "utf8" });
      assert.notEqual(r.status, 0, `${name} accepted a flag it does not know:\n${r.stdout}${r.stderr}`);
      assert.match(
        r.stderr,
        /unknown flag/,
        `${name} must SAY which flag it did not understand, not just fail`,
      );
    });
  }

  it("still accepts the flags that are real", () => {
    const r = spawnSync(process.execPath, [script("gate.mjs"), "--list"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /source:/, "--list must still list");
  });

  it("names every stacks.mjs command in its usage line", () => {
    const commands = [...readFileSync(script("stacks.mjs"), "utf8").matchAll(/case "([a-z]+)":/g)].map((m) => m[1]);
    const usage = spawnSync(process.execPath, [script("stacks.mjs")], { encoding: "utf8" }).stderr;
    for (const command of commands) assert.match(usage, new RegExp(`\\b${command}\\b`), `usage omits ${command}`);
  });
});
