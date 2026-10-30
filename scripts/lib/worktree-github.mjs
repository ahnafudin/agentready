import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { norm, runTool, tryRun } from "./util.mjs";
import { validateAgent, withLock } from "./worktree-state.mjs";

const MARKER = "<!-- agentready:worktree -->";
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;
const NODE_ID = /^[A-Za-z0-9_-]+$/;

export function githubOrigin(root) {
  const result = tryRun("git", ["remote", "get-url", "origin"], { cwd: root });
  if (!result.ok) return null;
  const match = result.out.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)\/?$/i);
  return match ? match[1].replace(/\.git$/i, "") : null;
}

export function githubConfigPath(stateDir) {
  return join(stateDir, "..", "github.json");
}

export function validateGitHubConfig(config, origin) {
  if (!config || !REPOSITORY.test(config.repository ?? "") || !origin || config.repository.toLowerCase() !== origin.toLowerCase()) {
    throw new Error("GitHub tracker repository does not match origin; run npm run issues:setup in this checkout.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(config.owner ?? "") || !Number.isSafeInteger(config.number) || config.number < 1 ||
      !NODE_ID.test(config.checkoutId ?? "") || !NODE_ID.test(config.id ?? "") || !NODE_ID.test(config.statusField ?? "") ||
      ["Todo", "In Progress", "Done"].some((status) => !NODE_ID.test(config.statuses?.[status] ?? ""))) {
    throw new Error("GitHub Project or Status configuration is incomplete; run npm run issues:setup again.");
  }
  return config;
}

export function runGitHub(tool, root, args, repository) {
  const result = tool("gh", args, { cwd: root, env: { ...process.env, ...(repository ? { GH_REPO: repository } : {}) } });
  if (!result.ok) throw new Error(`GitHub synchronization failed: ${result.out}`);
  return result.out ? JSON.parse(result.out) : null;
}

function issueNumber(id) {
  const match = String(id).match(/^(?:issue-)?([1-9][0-9]*)$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error("Use a GitHub issue number or issue-<number> as the task ID.");
  return Number(match[1]);
}

function ownership(comments) {
  let latest = { revision: null, agent: "", path: "", branch: "", checkout: "" };
  // A revision has one successor; comment order makes concurrent claims deterministic.
  for (const comment of [...comments].sort((a, b) => a.id - b.id)) {
    if (!Number.isSafeInteger(comment.id) || !String(comment.body ?? "").startsWith(`${MARKER}\n`)) continue;
    let value;
    try {
      value = JSON.parse(comment.body.slice(MARKER.length).trim());
    } catch {
      continue;
    }
    if (!value || value.previous !== latest.revision || !["", "claude", "codex"].includes(value.agent) ||
        typeof value.path !== "string" || typeof value.branch !== "string" || Boolean(value.agent) !== Boolean(value.path)) continue;
    latest = { revision: comment.id, agent: value.agent, path: value.path, branch: value.branch, checkout: value.checkout ?? "" };
  }
  return latest;
}

export class WorktreeGitHub {
  constructor(root, tool = runTool, stateDir) {
    this.root = root;
    this.tool = tool;
    this.stateDir = stateDir;
    const path = githubConfigPath(stateDir);
    const origin = githubOrigin(root);
    this.enabled = existsSync(path);
    this.repository = "";
    if (!this.enabled) {
      if (origin) throw new Error("Configure GitHub Issues and Projects first with npm run issues:setup.");
      return;
    }
    this.config = validateGitHubConfig(JSON.parse(readFileSync(path, "utf8")), origin);
    this.repository = this.config.repository;
  }

  run(args) {
    if (!this.enabled) throw new Error("GitHub tracking is not configured; run npm run issues:setup.");
    return runGitHub(this.tool, this.root, args, this.repository);
  }

  show(id) {
    const number = issueNumber(id);
    const endpoint = `repos/${this.repository}/issues/${number}`;
    const issue = this.run(["api", endpoint]);
    if (issue?.number !== number || issue.pull_request || !["open", "closed"].includes(issue.state)) {
      throw new Error(`GitHub returned no issue for ${id}.`);
    }
    const pages = this.run(["api", `${endpoint}/comments`, "--paginate", "--slurp"]);
    const comments = pages.flat();
    const ledger = ownership(comments);
    const metadata = {};
    if (ledger.checkout) metadata["agentready.checkout"] = ledger.checkout;
    if (ledger.path) metadata["agentready.worktree"] = ledger.path;
    if (ledger.agent) metadata["agentready.agent"] = ledger.agent;
    if (ledger.branch) metadata["agentready.branch"] = ledger.branch;
    return { id: String(id), title: issue.title, description: issue.body ?? "",
      notes: comments.filter((comment) => !String(comment.body ?? "").startsWith(MARKER)).map((comment) => comment.body).join("\n\n"),
      status: issue.state === "closed" ? "closed" : ledger.agent ? "in_progress" : "open",
      assignee: ledger.agent, metadata, revision: ledger.revision };
  }

  owned(id, agent) {
    validateAgent(agent);
    const issue = this.show(id);
    if (issue.status === "closed") throw new Error("The GitHub issue is closed; select an active issue.");
    if (issue.assignee && issue.assignee !== agent) throw new Error(`The GitHub issue is owned by ${issue.assignee}; its owner must hand it off first.`);
    this.checkout(issue);
    return issue;
  }

  checkout(issue) {
    if (issue.assignee && issue.metadata?.["agentready.checkout"] !== this.config.checkoutId) {
      throw new Error("The GitHub issue belongs to another checkout; release it from that workspace before continuing.");
    }
  }

  association(task, issue) {
    this.checkout(issue);
    const associated = issue.metadata?.["agentready.worktree"];
    if (associated && norm(associated) !== norm(task.path)) throw new Error("The GitHub issue points at another worktree; resolve that association before continuing.");
  }

  removable(task, issue) {
    this.association(task, issue);
    if (issue.assignee && issue.assignee !== task.agent) throw new Error("The GitHub issue has another owner; resolve ownership before cleanup.");
  }

  request(endpoint, payload) {
    const file = join(this.stateDir, `${randomUUID()}.json`);
    mkdirSync(this.stateDir, { recursive: true });
    try {
      writeFileSync(file, JSON.stringify(payload), { flag: "wx" });
      return this.run(["api", endpoint, "--method", "POST", "--input", file]);
    } finally {
      if (existsSync(file)) unlinkSync(file);
    }
  }

  postComment(id, body) {
    return this.request(`repos/${this.repository}/issues/${issueNumber(id)}/comments`, { body });
  }

  publish(task, issue, agent, path) {
    const posted = this.postComment(task.id, `${MARKER}\n${JSON.stringify({ previous: issue.revision, agent, path, branch: task.branch, checkout: agent ? this.config.checkoutId : "" })}`);
    const current = this.show(task.id);
    if (current.revision !== posted?.id) throw new Error("GitHub ownership changed during this operation; inspect the issue before retrying.");
    return current;
  }

  current(task, issue) {
    const current = this.show(task.id);
    this.association(task, current);
    if (current.revision !== issue.revision || current.status !== issue.status || current.assignee !== issue.assignee) {
      throw new Error("GitHub issue ownership or status changed; refresh the issue before retrying.");
    }
    return current;
  }

  assign(task, issue, { handoff = false } = {}) {
    validateAgent(task.agent);
    return withLock(join(this.stateDir, "github.lock"), () => {
      const current = this.current(task, issue);
      if (current.status === "closed") throw new Error("The GitHub issue is closed; select an active issue.");
      if (current.assignee && current.assignee !== task.agent && !handoff) throw new Error("The GitHub issue has another owner; use wt:handoff first.");
      const item = this.run(["project", "item-add", String(this.config.number), "--owner", this.config.owner,
        "--url", `https://github.com/${this.repository}/issues/${issueNumber(task.id)}`, "--format", "json"]);
      if (!item?.id) throw new Error("GitHub returned no Project item; inspect the Project before retrying.");
      const snapshot = this.request("graphql", {
        query: 'query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}}}}',
        variables: { id: item.id },
      });
      const previousStatus = snapshot.data?.node?.fieldValueByName?.optionId;
      if (!snapshot.data?.node || snapshot.errors) throw new Error("Could not read Project Status; retry after checking GitHub access.");
      const update = (option) => this.run(["project", "item-edit", "--id", item.id, "--project-id", this.config.id,
        "--field-id", this.config.statusField, ...(option ? ["--single-select-option-id", option] : ["--clear"])]);
      try {
        update(this.config.statuses["In Progress"]);
        const assigned = this.publish(task, current, task.agent, task.path);
        if (assigned.status === "closed") {
          this.publish(task, assigned, current.assignee, current.metadata["agentready.worktree"] ?? "");
          update(previousStatus);
          throw new Error("The GitHub issue closed during assignment; select an active issue.");
        }
        return assigned;
      } catch (error) {
        try {
          const latest = this.show(task.id);
          if (latest.revision === current.revision) update(previousStatus);
          else if (latest.assignee === task.agent && latest.metadata["agentready.checkout"] === this.config.checkoutId &&
              norm(latest.metadata["agentready.worktree"] ?? "") === norm(task.path)) error.retainWorktree = true;
        } catch (recoveryError) {
          error.retainWorktree = true;
          error.message += `; recovery needs a retry: ${recoveryError.message}`;
        }
        throw error;
      }
    }, { timeoutMs: 30000 });
  }

  clear(task, issue) {
    return withLock(join(this.stateDir, "github.lock"), () => {
      const current = this.current(task, issue);
      this.removable(task, current);
      return this.publish(task, current, "", "");
    }, { timeoutMs: 30000 });
  }

  comment(task, text) {
    return withLock(join(this.stateDir, "github.lock"), () => this.postComment(task.id, text), { timeoutMs: 30000 });
  }

  launchEnvironment(agent) {
    validateAgent(agent);
    return { ...process.env, GH_REPO: this.repository, AGENTREADY_AGENT: agent };
  }
}
