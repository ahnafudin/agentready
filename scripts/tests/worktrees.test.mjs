import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { githubFixture, event } from "./helpers/github.mjs";
import { norm, runTool } from "../lib/util.mjs";

let createWorktreeManager;
try {
  ({ createWorktreeManager } = await import("../lib/worktrees.mjs"));
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const trash = [];
after(() => trash.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixture({ github = false, legacyBase = false, launch = () => ({ ok: true, out: "", err: "" }) } = {}) {
  assert.equal(typeof createWorktreeManager, "function", "the shared worktree manager is missing");
  const root = mkdtempSync(join(tmpdir(), "agentready worktrees "));
  trash.push(root);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Worktree test");
  git("config", "user.email", "worktrees@example.invalid");
  git("config", "core.hooksPath", ".git/no-hooks");
  git("config", "core.autocrlf", "false");
  const ignores = "/.worktrees/\n/.agentready-handoff.md\nnode_modules/\n.cache/\n";
  writeFileSync(join(root, ".gitignore"), legacyBase ? "node_modules/\n" : ignores);
  writeFileSync(join(root, "code.txt"), "committed\n");
  git("add", ".");
  git("commit", "-qm", "initial fixture");
  if (legacyBase) writeFileSync(join(root, ".gitignore"), ignores);
  const tracking = github ? githubFixture({ root }) : null;
  const tool = (command, args = [], options = {}) => command === "gh"
    ? tracking.tool(command, args, options) : launch(command, args, options);
  return {
    root, git, tool, tracking, manager: createWorktreeManager({ cwd: root, tool }),
    issue: tracking?.issue, comments: tracking?.comments,
    failUpdates: () => tracking.fail("--input"),
  };
}

describe("shared worktree lifecycle", () => {
  it("isolates committed code by task and resolves the same main checkout from a linked tree", () => {
    const { root, git, manager, tool } = fixture();
    writeFileSync(join(root, "code.txt"), "local changes\n");
    const task = manager.create("task-1", { agent: "codex" });
    assert.equal(norm(task.path), norm(join(root, ".worktrees", "task-1")));
    assert.equal(readFileSync(join(task.path, "code.txt"), "utf8"), "committed\n");
    assert.equal(git("branch", "--show-current"), "main");
    assert.equal(task.branch, "task/task-1");
    const nested = createWorktreeManager({ cwd: task.path, tool });
    assert.equal(norm(nested.list()[0].path), norm(task.path));
    assert.throws(() => nested.create("task-1", { agent: "claude" }), /already exists/);
  });

  it("refuses invalid paths and agent names before creating a worktree", () => {
    const { root, git, manager } = fixture();
    for (const id of ["../outside", "task..1", "CON", "nul.txt", "--option", "task/other"]) {
      assert.throws(() => manager.create(id, { agent: "codex" }), /task ID/);
    }
    assert.throws(() => manager.create("task-1", { agent: "unknown" }), /agent/);
    assert.equal(existsSync(join(root, ".worktrees")), false);
    assert.equal(git("worktree", "list", "--porcelain").match(/^worktree /gm).length, 1);
  });

  it("requires an ignored neutral directory and refuses a redirected worktree parent", () => {
    const { root, manager } = fixture();
    writeFileSync(join(root, ".gitignore"), "");
    assert.throws(() => manager.create("task-1", { agent: "codex" }), /gitignore|ignored/);
    writeFileSync(join(root, ".gitignore"), "/.worktrees/\n");
    const outside = mkdtempSync(join(tmpdir(), "agentready-outside-"));
    trash.push(outside);
    writeFileSync(join(outside, "keep.txt"), "keep");
    symlinkSync(outside, join(root, ".worktrees"), "junction");
    assert.throws(() => manager.create("task-1", { agent: "codex" }), /outside|symlink|junction/);
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep");
  });

  it("shares installed dependencies and keeps them intact when removing a clean worktree", () => {
    const { root, git, manager } = fixture();
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "keep.txt"), "main dependency");
    const task = manager.create("task-1", { agent: "codex" });
    assert.equal(readFileSync(join(task.path, "node_modules", "keep.txt"), "utf8"), "main dependency");
    manager.remove("task-1");
    assert.equal(existsSync(task.path), false, existsSync(task.path) ? `remaining entries: ${readdirSync(task.path).join(", ")}` : "");
    assert.equal(readFileSync(join(root, "node_modules", "keep.txt"), "utf8"), "main dependency");
    assert.equal(git("show-ref", "--verify", "refs/heads/task/task-1").length > 0, true);
    assert.deepEqual(manager.list(), []);
  });

  it("preserves modified and untracked work instead of forcing cleanup", () => {
    const { manager } = fixture();
    const task = manager.create("task-1", { agent: "claude" });
    writeFileSync(join(task.path, "code.txt"), "unfinished");
    assert.throws(() => manager.remove("task-1"), /changes|dirty/);
    writeFileSync(join(task.path, "code.txt"), "committed\n");
    writeFileSync(join(task.path, "untracked.txt"), "keep");
    assert.throws(() => manager.remove("task-1"), /changes|dirty/);
    assert.equal(readFileSync(join(task.path, "untracked.txt"), "utf8"), "keep");
  });

  it("cleans additional ignored junctions without following their targets", (t) => {
    if (process.platform !== "win32") return t.skip("Windows Git leaves ignored directory junctions");
    const { manager } = fixture();
    const outside = mkdtempSync(join(tmpdir(), "agentready-cache-"));
    trash.push(outside);
    writeFileSync(join(outside, "keep.txt"), "keep");
    const task = manager.create("task-1", { agent: "codex" });
    symlinkSync(outside, join(task.path, ".cache"), "junction");
    manager.remove("task-1");
    assert.equal(existsSync(task.path), false);
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep");
    assert.deepEqual(manager.list(), []);
  });

  it("keeps generated context untracked even when the selected base predates these ignore rules", () => {
    const { manager } = fixture({ github: true, legacyBase: true });
    const task = manager.create("issue-12", { agent: "codex" });
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: task.path, encoding: "utf8" });
    assert.equal(status.stdout, "");
    manager.remove("issue-12");
    assert.equal(existsSync(task.path), false);
  });

  it("blocks a second writer and handoff or cleanup while an agent is running", () => {
    let other;
    const context = fixture({ launch: () => {
      assert.throws(() => other.open("task-1"), /active|running|locked/);
      assert.throws(() => other.handoff("task-1", { to: "claude", note: "Continue review" }), /active|running|locked/);
      assert.throws(() => other.remove("task-1"), /active|running|locked/);
      assert.equal(other.list()[0].active, true);
      return { ok: true, out: "", err: "" };
    } });
    context.manager.create("task-1", { agent: "codex" });
    other = createWorktreeManager({ cwd: context.root, tool: context.tool });
    context.manager.open("task-1");
    assert.equal(other.list()[0].active, false);
    other.handoff("task-1", { to: "claude", note: "Continue review" });
  });

  it("recovers an exited manager lock and releases the writer after a launch failure", () => {
    const { root, manager } = fixture({ launch: () => ({ ok: false, out: "CLI not installed", err: "" }) });
    manager.create("task-1", { agent: "codex" });
    writeFileSync(join(root, ".git", "agentready", "worktrees", "task-1.lock"), JSON.stringify({ pid: 2147483647 }));
    assert.throws(() => manager.open("task-1"), /CLI not installed/);
    manager.handoff("task-1", { to: "claude", note: "Use the installed CLI" });
    assert.equal(manager.list()[0].agent, "claude");
  });
});

describe("worktree CLI", () => {
  it("supports creation, JSON listing, file-based handoff and cleanup from a linked directory", () => {
    const { root } = fixture();
    const script = fileURLToPath(new URL("../worktrees.mjs", import.meta.url));
    const run = (args, cwd = root) => {
      const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    run(["create", "task-1", "--agent", "codex"]);
    const [task] = JSON.parse(run(["list", "--json"]));
    const note = join(root, "handoff.txt");
    writeFileSync(note, 'Review the "token" behavior; all existing tests pass.');
    run(["handoff", "task-1", "--to", "claude", "--note-file", note], task.path);
    assert.equal(JSON.parse(run(["list", "--json"]))[0].agent, "claude");
    run(["remove", "task-1"]);
    assert.deepEqual(JSON.parse(run(["list", "--json"])), []);
  });
});

describe("worktree GitHub integration", () => {
  it("links the issue while preserving human assignment and issue content", () => {
    const { manager, tracking, issue } = fixture({ github: true });
    const before = JSON.stringify(issue);
    const task = manager.create("issue-12", { agent: "codex" });
    const owned = tracking.tracker().show("issue-12");
    assert.equal(task.githubRepository, "octocat/example");
    assert.equal(owned.status, "in_progress");
    assert.equal(owned.assignee, "codex");
    assert.equal(owned.metadata["agentready.worktree"], task.path);
    assert.equal(JSON.stringify(issue), before);
  });

  it("refuses missing, closed, and already claimed issues before creating a tree", () => {
    const { root, manager, issue, tracking } = fixture({ github: true });
    assert.throws(() => manager.create("issue-999", { agent: "codex" }), /404|issue/i);
    issue.state = "closed";
    assert.throws(() => manager.create("issue-12", { agent: "codex" }), /closed/);
    issue.state = "open";
    tracking.comments.push(event(2, null, "claude", "/other/worktree"));
    assert.throws(() => manager.create("issue-12", { agent: "codex" }), /owner/);
    assert.equal(existsSync(join(root, ".worktrees", "issue-12")), false);
  });

  it("rolls back a new tree and branch when GitHub rejects the claim", () => {
    const { root, git, manager, failUpdates, tracking } = fixture({ github: true, legacyBase: true });
    failUpdates();
    assert.throws(() => manager.create("issue-12", { agent: "codex" }), /API unavailable/);
    assert.equal(existsSync(join(root, ".worktrees", "issue-12")), false);
    assert.equal(git("branch", "--list", "task/issue-12"), "");
    assert.equal(tracking.tracker().show("issue-12").assignee, "");
    assert.deepEqual(manager.list(), []);
  });

  it("preserves a recoverable worktree when remote claim confirmation is unavailable", () => {
    const { root, manager, tracking } = fixture({ github: true });
    tracking.beforeComment(() => tracking.fail("repos/octocat/example/issues/12"));
    assert.throws(() => manager.create("issue-12", { agent: "codex" }), /retained/);
    assert.equal(existsSync(join(root, ".worktrees", "issue-12")), true);
    assert.equal(manager.list().length, 1);
    tracking.fail("");
    manager.open("issue-12");
    assert.equal(tracking.tracker().show("issue-12").assignee, "codex");
    manager.remove("issue-12");
  });

  it("hands over ownership and multiline context while keeping the note untracked", () => {
    const { root, manager, tracking, comments, tool } = fixture({ github: true });
    const task = manager.create("issue-12", { agent: "codex" });
    const note = 'Review "expired tokens".\nRun npm run gate.';
    const nested = createWorktreeManager({ cwd: task.path, tool });
    nested.handoff("issue-12", { to: "claude", note });
    assert.equal(tracking.tracker().show("issue-12").assignee, "claude");
    assert.ok(comments.some((comment) => comment.body.includes(note)));
    assert.ok(readFileSync(join(task.path, ".agentready-handoff.md"), "utf8").includes(note));
    assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: task.path, encoding: "utf8" }).stdout, "");
    assert.equal(norm(nested.list()[0].path), norm(join(root, ".worktrees", "issue-12")));
  });

  it("keeps previous ownership and local context after a rejected handoff", () => {
    const { manager, tracking, failUpdates } = fixture({ github: true });
    const task = manager.create("issue-12", { agent: "codex" });
    const previous = readFileSync(join(task.path, ".agentready-handoff.md"), "utf8");
    failUpdates();
    assert.throws(() => manager.handoff("issue-12", { to: "claude", note: "Review the change" }), /API unavailable/);
    assert.equal(tracking.tracker().show("issue-12").assignee, "codex");
    assert.equal(manager.list()[0].agent, "codex");
    assert.equal(readFileSync(join(task.path, ".agentready-handoff.md"), "utf8"), previous);
  });

  it("recovers handoff after remote ownership changes and local persistence fails", () => {
    const { root, manager, tracking } = fixture({ github: true, launch: (command) => {
      assert.equal(command, "claude");
      return { ok: true, out: "", err: "" };
    } });
    const task = manager.create("issue-12", { agent: "codex" });
    const registry = join(root, ".git", "agentready", "worktrees", "issue-12.json");
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === registry) throw Object.assign(new Error("registry is read-only"), { code: "EPERM" });
      return rename(from, to);
    };
    syncBuiltinESMExports();
    try {
      assert.throws(() => manager.handoff("issue-12", { to: "claude", note: "Review expired-token handling" }), /read-only/);
    } finally {
      fs.renameSync = rename;
      syncBuiltinESMExports();
    }
    assert.equal(tracking.tracker().show("issue-12").assignee, "claude");
    manager.open("issue-12");
    assert.equal(manager.list()[0].agent, "claude");
    assert.match(readFileSync(join(task.path, ".agentready-handoff.md"), "utf8"), /Review expired-token handling/);
  });

  it("can clean up after an issue closes during handoff publication", () => {
    const { manager, tracking, issue } = fixture({ github: true });
    const task = manager.create("issue-12", { agent: "codex" });
    tracking.beforeComment(() => tracking.beforeComment(() => { issue.state = "closed"; }));
    assert.throws(() => manager.handoff("issue-12", { to: "claude", note: "Review the change" }), /closed/);
    assert.equal(tracking.tracker().show("issue-12").assignee, "codex");
    manager.remove("issue-12");
    assert.equal(existsSync(task.path), false);
    assert.deepEqual(manager.list(), []);
  });

  it("launches the chosen CLI with GitHub context and no PATH wrappers", () => {
    let launched = 0;
    const { root, manager } = fixture({ github: true, launch: (command, args, options) => {
      assert.equal(command, "claude");
      assert.equal(norm(options.cwd), norm(join(root, ".worktrees", "issue-12")));
      assert.equal(options.env.GH_REPO, "octocat/example");
      assert.equal(options.env.AGENTREADY_AGENT, "claude");
      assert.equal(options.stdio, "inherit");
      assert.equal(args.includes("--worktree"), false);
      launched++;
      return { ok: true, out: "", err: "" };
    } });
    manager.create("issue-12", { agent: "claude" });
    manager.open("issue-12");
    assert.equal(launched, 1);
  });

  it("requires explicit handoff and refuses ownership drift", () => {
    const { manager, tracking } = fixture({ github: true });
    manager.create("issue-12", { agent: "codex" });
    assert.throws(() => manager.open("issue-12", { agent: "claude" }), /handoff/);
    const previous = tracking.tracker().show("issue-12").revision;
    tracking.comments.push(event(100, previous, "claude", tracking.task.path));
    assert.throws(() => manager.open("issue-12"), /owner/);
    assert.throws(() => manager.handoff("issue-12", { to: "claude", note: "Take over" }), /owner/);
  });

  it("refuses ownership drift before cleanup can delete the worktree", () => {
    const { manager, tracking } = fixture({ github: true });
    const task = manager.create("issue-12", { agent: "codex" });
    const previous = tracking.tracker().show("issue-12").revision;
    tracking.comments.push(event(100, previous, "claude", task.path));
    assert.throws(() => manager.remove("issue-12"), /owner/);
    assert.equal(existsSync(task.path), true);
    assert.equal(manager.list()[0].phase, undefined);
  });

  it("releases the worktree without completing the issue or changing human assignment", () => {
    const { manager, tracking, issue } = fixture({ github: true });
    manager.create("issue-12", { agent: "codex" });
    issue.state = "closed";
    manager.remove("issue-12");
    assert.equal(issue.state, "closed");
    assert.deepEqual(issue.assignees, [{ login: "human-maintainer", id: 42 }]);
    assert.equal(tracking.tracker().show("issue-12").metadata["agentready.worktree"], undefined);
  });
});

describe("external tool working directory", () => {
  it("passes directory and tracker environment to an actual child process", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentready tool "));
    trash.push(dir);
    const script = join(dir, "context.mjs");
    writeFileSync(script, "process.stdout.write(JSON.stringify({ cwd: process.cwd(), tracker: process.env.GH_REPO }));\n");
    const result = runTool(process.execPath, [script], { cwd: dir, env: { ...process.env, GH_REPO: "octocat/example" } });
    assert.equal(result.ok, true, result.out);
    const output = JSON.parse(result.out);
    assert.equal(norm(output.cwd), norm(dir));
    assert.equal(output.tracker, "octocat/example");
  });
});
