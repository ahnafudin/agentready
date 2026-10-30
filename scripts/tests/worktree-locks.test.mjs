import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { withLock } from "../lib/worktree-state.mjs";

it("reports an abandoned recovery guard immediately and allows retry after its removal", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentready-abandoned-lock-"));
  const lock = join(dir, "task.lock");
  try {
    writeFileSync(lock, JSON.stringify({ pid: 2147483647, token: "old-owner" }));
    writeFileSync(`${lock}.reclaim`, JSON.stringify({ pid: 2147483647, token: "old-reclaimer" }));
    assert.throws(() => withLock(lock, () => assert.fail("guard was bypassed")), /recovery guard.*remove/i);
    unlinkSync(`${lock}.reclaim`);
    let entered = false;
    withLock(lock, () => { entered = true; });
    assert.equal(entered, true);
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("stale lock recovery keeps two real processes from writing concurrently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentready-lock-race-"));
  const module = new URL("../lib/worktree-state.mjs", import.meta.url).href;
  const script = join(dir, "contender.mjs");
  writeFileSync(join(dir, "task.lock"), JSON.stringify({ pid: 2147483647 }));
  writeFileSync(script, `
import fs from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
const [dir, role] = process.argv.slice(2);
const lock = join(dir, "task.lock");
const wait = (name) => {
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(join(dir, name))) {
    if (Date.now() > deadline) throw new Error("coordination timed out: " + name);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
};
if (role === "B") {
  const unlink = fs.unlinkSync;
  let paused = false;
  fs.unlinkSync = (path) => {
    if (path === lock && !paused) {
      paused = true;
      fs.writeFileSync(join(dir, "paused"), "1");
      wait("attempted");
    }
    return unlink(path);
  };
  syncBuiltinESMExports();
}
const { withLock } = await import(${JSON.stringify(module)});
try {
  withLock(lock, () => {
    if (fs.existsSync(join(dir, "writer"))) {
      fs.writeFileSync(join(dir, "overlap"), "1");
      throw new Error("concurrent writers");
    }
    fs.writeFileSync(join(dir, "writer"), role);
    if (role === "A") {
      fs.writeFileSync(join(dir, "attempted"), "1");
      wait("done");
    }
    fs.unlinkSync(join(dir, "writer"));
  });
} catch (error) {
  if (error.code !== "AGENTREADY_LOCKED") {
    process.stderr.write(error.message);
    process.exitCode = 1;
  }
} finally {
  fs.writeFileSync(join(dir, role === "A" ? "attempted" : "done"), "1");
}
`);
  const children = [];
  const start = (role) => {
    const child = spawn(process.execPath, [script, dir, role], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    return new Promise((resolve) => child.on("close", (code) => resolve({ code, error })));
  };
  try {
    const second = start("B");
    const deadline = Date.now() + 5000;
    while (!existsSync(join(dir, "paused"))) {
      if (Date.now() > deadline) throw new Error("contender never reached stale deletion");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const first = start("A");
    const outcomes = await Promise.all([first, second]);
    assert.equal(existsSync(join(dir, "overlap")), false, "two writers entered the same lock");
    for (const outcome of outcomes) assert.equal(outcome.code, 0, outcome.error);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
