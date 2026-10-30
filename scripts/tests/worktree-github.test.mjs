import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { githubFixture, CONFIG, event } from "./helpers/github.mjs";

let WorktreeGitHub, configureGitHub;
try {
  ({ WorktreeGitHub } = await import("../lib/worktree-github.mjs"));
  ({ configureGitHub } = await import("../github-setup.mjs"));
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const MARKER = "<!-- agentready:worktree -->";
const trash = [];
after(() => trash.forEach((path) => rmSync(path, { recursive: true, force: true })));
const fixture = (options) => {
  const context = githubFixture(options);
  trash.push(context.root);
  return context;
};

describe("GitHub worktree tracking", () => {
  it("requires local setup for a GitHub origin and rejects another repository's config", () => {
    const missing = fixture({ config: null });
    assert.throws(() => missing.tracker(), /issues:setup/);
    const mismatch = fixture({ config: { ...CONFIG, repository: "someone/else" } });
    assert.throws(() => mismatch.tracker(), /origin|repository/i);
    assert.equal(fixture({ config: null, origin: null }).tracker().enabled, false);
  });

  it("claims an issue through the Project and ledger without changing human issue data", () => {
    const f = fixture(), tracker = f.tracker();
    assert.equal(tracker.enabled, true);
    assert.equal(tracker.repository, "octocat/example");
    const before = JSON.stringify(f.issue);
    tracker.assign(f.task, tracker.owned("issue-12", "codex"));
    const issue = tracker.show(12);
    assert.equal(issue.id, "12");
    assert.equal(issue.status, "in_progress");
    assert.equal(issue.assignee, "codex");
    assert.equal(issue.metadata["agentready.worktree"], f.task.path);
    assert.equal(issue.metadata["agentready.branch"], "task/issue-12");
    assert.equal(f.status(), "In Progress");
    assert.equal(JSON.stringify(f.issue), before);
    const env = tracker.launchEnvironment("claude");
    assert.equal(env.GH_REPO, "octocat/example");
    assert.equal(env.AGENTREADY_AGENT, "claude");
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH");
    assert.equal(env[pathKey], process.env[pathKey]);
    assert.equal(existsSync(join(f.stateDir, "bin")), false);
  });

  it("refuses missing, closed, foreign-owned, and differently associated issues", () => {
    const f = fixture(), tracker = f.tracker();
    assert.throws(() => tracker.show("issue-999"), /404|not found/i);
    assert.throws(() => tracker.show("../12"), /issue|number/i);
    f.issue.state = "closed";
    assert.throws(() => tracker.owned("12", "codex"), /closed/);
    f.issue.state = "open";
    f.comments.push(event(2, null, "claude", "/other/worktree"));
    assert.throws(() => tracker.owned("12", "codex"), /owner|assigned/);
    assert.throws(() => tracker.association(f.task, tracker.show("12")), /another worktree/);
  });

  it("rejects the same agent and path owned by a different checkout", () => {
    const f = fixture(), tracker = f.tracker();
    f.comments.push({ id: 2, body: `${MARKER}\n${JSON.stringify({ previous: null, agent: "codex", path: f.task.path, branch: f.task.branch, checkout: "another-checkout" })}` });
    assert.throws(() => tracker.owned("12", "codex"), /checkout|workspace/i);
    assert.throws(() => tracker.association(f.task, tracker.show("12")), /checkout|workspace/i);
  });

  it("accepts the first event for a revision and rejects a competing claim", () => {
    const f = fixture(), tracker = f.tracker(), issue = tracker.show("12");
    f.beforeComment(() => f.comments.push(event(9, null, "claude", "/competing/worktree")));
    assert.throws(() => tracker.assign(f.task, issue), /ownership|changed|conflict/i);
    assert.equal(tracker.show("12").assignee, "claude");
    assert.equal(tracker.show("12").revision, 9);
    assert.equal(f.status(), "In Progress");
  });

  it("refuses stale ownership before mutating and keeps state on API failure", () => {
    const f = fixture(), tracker = f.tracker(), issue = tracker.show("12");
    f.comments.push(event(2, null, "claude", f.task.path));
    assert.throws(() => tracker.assign(f.task, issue), /ownership|changed|conflict/i);
    assert.equal(f.mutations.length, 0);
    f.comments.pop();
    f.fail("item-edit");
    assert.throws(() => tracker.assign(f.task, issue), /API unavailable/);
    assert.equal(tracker.show("12").assignee, "");
    assert.equal(f.mutations.length, 0);
  });

  it("hands off, preserves multiline notes, and releases without closing the issue", () => {
    const f = fixture(), tracker = f.tracker();
    tracker.assign(f.task, tracker.show("12"));
    const note = 'Review "expired tokens".\nRun npm run gate; preserve $literal and `code`.';
    tracker.comment(f.task, note, f.stateDir);
    tracker.assign({ ...f.task, agent: "claude" }, tracker.show("12"), { handoff: true });
    const owned = tracker.show("12");
    assert.equal(owned.assignee, "claude");
    assert.ok(owned.notes.includes(note));
    tracker.clear({ ...f.task, agent: "claude" }, owned);
    const released = tracker.show("12");
    assert.equal(released.assignee, "");
    assert.equal(released.metadata["agentready.worktree"], undefined);
    assert.equal(released.status, "open");
    assert.equal(f.issue.state, "open");
    assert.deepEqual(f.issue.assignees, [{ login: "human-maintainer", id: 42 }]);
  });

  it("releases a claim when the issue closes during assignment", () => {
    const f = fixture(), tracker = f.tracker();
    f.beforeComment(() => { f.issue.state = "closed"; });
    assert.throws(() => tracker.assign(f.task, tracker.show("12")), /closed/);
    assert.equal(tracker.show("12").assignee, "");
    assert.equal(f.status(), "Todo");
  });

  it("folds paginated events in numeric order and ignores malformed or losing branches", () => {
    const f = fixture(), tracker = f.tracker();
    f.comments.push(event(4, 2, "claude", f.task.path), event(2, null, "codex", f.task.path),
      event(3, null, "claude", "/losing/claim"), { id: 5, body: `${MARKER}\nnot JSON` });
    assert.equal(tracker.show("12").assignee, "claude");
    assert.equal(tracker.show("12").revision, 4);
  });

  it("leaves ownership unchanged and removes temporary payloads after a rejected comment", () => {
    const f = fixture(), tracker = f.tracker();
    f.fail("--input");
    assert.throws(() => tracker.assign(f.task, tracker.show("12")), /API unavailable/);
    assert.equal(tracker.show("12").revision, null);
    assert.equal(f.status(), "Todo");
    assert.deepEqual(readdirSync(f.stateDir), []);
  });
});

describe("GitHub tracker setup", () => {
  it("reuses the exact development Project and saves machine-local configuration", () => {
    assert.equal(typeof configureGitHub, "function", "GitHub setup is missing");
    const f = fixture({ config: null });
    const result = configureGitHub({ root: f.root, stateDir: f.stateDir, tool: f.tool });
    assert.deepEqual({ ...result, checkoutId: CONFIG.checkoutId }, CONFIG);
    assert.match(result.checkoutId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(JSON.parse(readFileSync(f.configFile, "utf8")), result);
    const repeated = configureGitHub({ root: f.root, stateDir: f.stateDir, tool: f.tool });
    assert.equal(repeated.checkoutId, result.checkoutId);
    assert.equal(f.mutations.some((mutation) => mutation.create), false);
    assert.equal(f.mutations.some((mutation) => mutation.link), true);
    assert.equal(f.git("ls-files"), "");
  });

  it("preserves an explicitly selected Project when setup is rerun without flags", () => {
    const f = fixture({ config: { ...CONFIG, owner: "another-owner" } });
    f.projects([]);
    const result = configureGitHub({ root: f.root, stateDir: f.stateDir, tool: f.tool });
    assert.equal(result.owner, "another-owner");
    assert.equal(f.mutations.some((mutation) => mutation.create), false);
  });

  it("creates a missing Project and never writes config after an incomplete setup", () => {
    const f = fixture({ config: null });
    f.projects([]);
    configureGitHub({ root: f.root, stateDir: f.stateDir, tool: f.tool });
    assert.equal(f.mutations.some((mutation) => mutation.create), true);
    const broken = fixture({ config: null });
    broken.fields.fields[1].options = [{ id: "todo", name: "Todo" }];
    assert.throws(() => configureGitHub({ root: broken.root, stateDir: broken.stateDir, tool: broken.tool }), /Status|In Progress/);
    assert.equal(existsSync(broken.configFile), false);
  });

  it("keeps setup incomplete if a missing Priority field cannot be created", () => {
    const f = fixture({ config: null });
    f.fail("field-create");
    assert.throws(() => configureGitHub({ root: f.root, stateDir: f.stateDir, tool: f.tool }), /API unavailable/);
    assert.equal(existsSync(f.configFile), false);
  });

  it("supports an explicit Project owner and preserves the previous config if linking fails", () => {
    const f = fixture();
    f.projects([]);
    const config = configureGitHub({ root: f.root, stateDir: f.stateDir, tool: f.tool, project: 5, owner: "another-owner" });
    assert.equal(config.owner, "another-owner");
    assert.equal(f.mutations.some((mutation) => mutation.create), false);
    f.fail("link");
    assert.throws(() => configureGitHub({ root: f.root, stateDir: f.stateDir, tool: f.tool }), /API unavailable/);
    assert.deepEqual(JSON.parse(readFileSync(f.configFile, "utf8")), config);
  });
});
