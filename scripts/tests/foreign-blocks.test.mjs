// Guards that `agents:sync` owns only the generated part of a pointer file, never the whole file.
// Rules installers append their own fenced blocks to CLAUDE.md, AGENTS.md or GEMINI.md.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foreignBlocks, withForeignBlocks } from "../lib/util.mjs";
import { renderStub, sync, TARGETS } from "../sync-agents.mjs";

const OTHER = ["<!-- other-tool:start -->", "- a line the other tool manages.", "<!-- other-tool:end -->"].join("\n");
const CUSTOM = ["<!-- BEGIN CUSTOM INTEGRATION -->", "custom tool context", "<!-- END CUSTOM INTEGRATION -->"].join("\n");

describe("foreignBlocks", () => {
  it("finds a start/end block", () => {
    const found = foreignBlocks(`# Title\n\n${OTHER}\n`);
    assert.equal(found.length, 1);
    assert.equal(found[0].name, "other-tool");
    assert.equal(found[0].text, OTHER);
  });

  it("finds a BEGIN/END block", () => {
    const found = foreignBlocks(`# Title\n\n${CUSTOM}\n`);
    assert.equal(found.length, 1);
    assert.equal(found[0].text, CUSTOM);
  });

  it("keeps two tools' blocks separate, in the order they appear", () => {
    // The end marker is back-referenced to its own name, so one tool's opening
    // marker can never swallow another tool's block by closing against its end.
    const found = foreignBlocks(`${OTHER}\n\n${CUSTOM}\n`);
    assert.deepEqual(
      found.map((b) => b.text),
      [OTHER, CUSTOM],
    );
  });

  it("does not read a single line of prose as a block", () => {
    // A marker must sit ALONE on its line; prose naming both markers inline would be kept for ever.
    const prose = "A region marked <!-- name:start --> … <!-- name:end --> is preserved.";
    assert.deepEqual(foreignBlocks(prose), []);
    const trailing = ["text <!-- x:start -->", "body", "<!-- x:end --> trailing"].join("\n");
    assert.deepEqual(foreignBlocks(trailing), [], "a marker sharing its line fences nothing");
  });

  it("ignores a lone comment and an unclosed marker", () => {
    assert.deepEqual(foreignBlocks("<!-- just a comment -->"), []);
    assert.deepEqual(foreignBlocks("<!-- other-tool:start -->\nno end marker\n"), []);
  });

  it("returns nothing for an empty or missing file", () => {
    assert.deepEqual(foreignBlocks(null), []);
    assert.deepEqual(foreignBlocks(""), []);
  });
});

describe("withForeignBlocks", () => {
  it("leaves a file nobody else touched byte-identical", () => {
    // Untouched files must not churn: otherwise every `agents:sync` would show
    // seven modified files in `git status` and nobody would read the diff.
    const stub = renderStub(TARGETS[0]);
    assert.equal(withForeignBlocks(stub, []), stub);
  });

  it("appends the foreign block after the generated part", () => {
    const stub = renderStub(TARGETS[0]);
    const out = withForeignBlocks(stub, foreignBlocks(`${stub}\n${OTHER}\n`));
    assert.ok(out.includes(OTHER), "the other tool's block was dropped");
    assert.ok(out.startsWith(stub.trimEnd()), "the generated part must stay first and intact");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const stub = renderStub(TARGETS[0]);
    const once = withForeignBlocks(stub, foreignBlocks(`${stub}\n${OTHER}\n`));
    const twice = withForeignBlocks(stub, foreignBlocks(once));
    assert.equal(twice, once);
  });

  it("never treats the generator's own output as foreign", () => {
    // The stub's banner shows the marker syntax; reading it back as a block would grow the file every run.
    const stub = `${renderStub(TARGETS[0])}\n${OTHER}\n`;
    assert.equal(withForeignBlocks(stub, foreignBlocks(stub)), stub);
  });

  it("carries several tools' blocks across together", () => {
    const stub = renderStub(TARGETS[0]);
    const out = withForeignBlocks(stub, foreignBlocks(`${stub}\n${OTHER}\n\n${CUSTOM}\n`));
    assert.ok(out.includes(OTHER));
    assert.ok(out.includes(CUSTOM));
  });
});

describe("sync() on a real pointer file", () => {
  // Proves the pieces above are wired together: every piece can be right and sync() still wipe the file.
  // Runs in a scratch root: the suite runs in parallel, and other tests copy this checkout.
  it("keeps another tool's block instead of deleting it", () => {
    const root = mkdtempSync(join(tmpdir(), "sync-"));
    try {
      sync({ root });
      const path = join(root, "GEMINI.md");

      // 1. Another installer appends its block; `--check` rightly says `agents:sync` would rewrite the file.
      writeFileSync(path, `${readFileSync(path, "utf8").trimEnd()}\n\n${OTHER}\n`);
      assert.deepEqual(sync({ root, check: true }).stale, ["GEMINI.md"]);

      // 2. Running what the message says must keep the other tool's block.
      sync({ root });
      assert.ok(readFileSync(path, "utf8").includes(OTHER), "agents:sync deleted the other tool's block");

      // 3. And now it settles: the gate is green and stays green.
      assert.deepEqual(sync({ root, check: true }).stale, [], "the file never reaches a steady state");
      sync({ root });
      assert.ok(readFileSync(path, "utf8").includes(OTHER));
      assert.deepEqual(sync({ root, check: true }).stale, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
