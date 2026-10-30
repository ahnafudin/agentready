import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { at } from "../lib/util.mjs";

const tmp = mkdtempSync(join(tmpdir(), "tooling-hooks-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
function repo() {
  const dir = mkdtempSync(join(tmp, "repo-"));
  cpSync(at(".githooks"), join(dir, ".githooks"), { recursive: true });
  cpSync(at("scripts", "lib"), join(dir, "scripts", "lib"), { recursive: true });
  cpSync(at("scripts", "install-hooks.mjs"), join(dir, "scripts", "install-hooks.mjs"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
const install = (dir, ...args) => spawnSync(process.execPath, [join(dir, "scripts", "install-hooks.mjs"), ...args], { cwd: dir, encoding: "utf8" });
const hooksPath = (dir) => spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: dir, encoding: "utf8" }).stdout.trim();

describe("native Git hook installation", () => {
  it("checks without configuring, then installs the repository hooks idempotently", () => {
    const dir = repo();
    assert.equal(install(dir, "--check").status, 0);
    assert.equal(hooksPath(dir), "");
    assert.equal(install(dir).status, 0);
    assert.equal(hooksPath(dir), ".githooks");
    assert.equal(install(dir).status, 0);
    assert.equal(hooksPath(dir), ".githooks");
  });

  it("preserves another hook manager and its hook content", () => {
    const dir = repo();
    const foreign = "#!/bin/sh\necho another tool\n";
    mkdirSync(join(dir, ".custom-hooks"));
    writeFileSync(join(dir, ".custom-hooks", "commit-msg"), foreign);
    spawnSync("git", ["config", "core.hooksPath", ".custom-hooks"], { cwd: dir });
    assert.equal(install(dir).status, 0);
    assert.equal(hooksPath(dir), ".custom-hooks");
    assert.equal(readFileSync(join(dir, ".custom-hooks", "commit-msg"), "utf8"), foreign);
  });
});
