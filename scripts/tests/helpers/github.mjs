import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorktreeGitHub } from "../../lib/worktree-github.mjs";

export const CONFIG = { repository: "octocat/example", owner: "octocat", number: 5, id: "PVT_project", checkoutId: "checkout-a",
  statusField: "PVTSSF_status", statuses: { Todo: "todo", "In Progress": "doing", Done: "done" } };
const MARKER = "<!-- agentready:worktree -->";
export const event = (id, previous, agent, path, branch = "task/issue-12") => ({ id,
  body: `${MARKER}\n${JSON.stringify({ previous, agent, path, branch, checkout: agent ? CONFIG.checkoutId : "" })}`, user: { login: "octocat" } });

export function githubFixture({ root: givenRoot, config = CONFIG, origin = "https://github.com/octocat/example.git" } = {}) {
  const root = givenRoot ?? mkdtempSync(join(tmpdir(), "agentready github "));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  if (!existsSync(join(root, ".git"))) git("init", "-q");
  if (origin) git("remote", "add", "origin", origin);
  const stateDir = join(root, ".git", "agentready", "worktrees");
  const configFile = join(stateDir, "..", "github.json");
  mkdirSync(stateDir, { recursive: true });
  if (config) writeFileSync(configFile, JSON.stringify(config));
  const issue = { id: 100, node_id: "I_issue", number: 12, title: "Fix login", body: "Preserve this body",
    state: "open", state_reason: null, html_url: "https://github.com/octocat/example/issues/12",
    assignees: [{ login: "human-maintainer", id: 42 }], labels: [{ name: "bug" }] };
  const comments = [{ id: 1, body: "Check expired tokens", user: { login: "human-maintainer" } }];
  const project = { id: "PVT_project", number: 5, title: "example — Development Tracker", closed: false,
    url: "https://github.com/users/octocat/projects/5", owner: { login: "octocat", type: "User" } };
  const fields = { fields: [{ id: "PVTF_title", name: "Title", type: "ProjectV2Field" },
    { id: "PVTSSF_status", name: "Status", type: "ProjectV2SingleSelectField", options: [
      { id: "todo", name: "Todo" }, { id: "doing", name: "In Progress" }, { id: "done", name: "Done" },
    ] }], totalCount: 2 };
  let nextId = 10, fail = "", beforeComment, status = "Todo", projects = [project];
  const mutations = [];
  const tool = (command, args, options) => {
    assert.equal(command, "gh");
    assert.equal(options.cwd, root);
    if (fail && args.includes(fail) && (fail !== "--input" || args.some((value) => value.endsWith("/comments")))) return { ok: false, out: "API unavailable", err: "" };
    const result = (value) => ({ ok: true, out: JSON.stringify(value), err: "" });
    const flag = (name) => args[args.indexOf(name) + 1];
    if (args[0] === "repo") return result({ name: "example", nameWithOwner: "octocat/example",
      owner: { login: "octocat" }, url: "https://github.com/octocat/example" });
    if (args[0] === "api") {
      if (args[1] === "graphql") return result({ data: { node: { fieldValueByName: status ? {
        optionId: { Todo: "todo", "In Progress": "doing", Done: "done" }[status],
      } : null } } });
      const endpoint = args.find((value) => value.startsWith("repos/"));
      if (endpoint === "repos/octocat/example/issues/12") return result(issue);
      if (endpoint === "repos/octocat/example/issues/12/comments") {
        if (args.includes("--input")) {
          const input = JSON.parse(readFileSync(flag("--input"), "utf8"));
          if (beforeComment) { const action = beforeComment; beforeComment = null; action(); }
          const posted = { id: nextId++, body: input.body, user: { login: "octocat" } };
          comments.push(posted);
          mutations.push({ endpoint, input });
          return result(posted);
        }
        assert.ok(args.includes("--paginate") && args.includes("--slurp"));
        return result([comments.slice(0, 1), comments.slice(1)]);
      }
      return { ok: false, out: "HTTP 404: Not Found", err: "" };
    }
    if (args[0] === "project") {
      if (args[1] === "list") return result({ projects, totalCount: projects.length });
      if (args[1] === "view") return result(project);
      if (args[1] === "create") { mutations.push({ create: true }); return result(project); }
      if (args[1] === "link") { mutations.push({ link: true }); return result({}); }
      if (args[1] === "field-list") return result(fields);
      if (args[1] === "field-create") {
        const field = { id: "PVTSSF_priority", name: "Priority", type: "ProjectV2SingleSelectField", options: [] };
        fields.fields.push(field);
        fields.totalCount++;
        return result(field);
      }
      if (args[1] === "item-add") return result({ id: "PVTI_item", type: "ISSUE", title: issue.title,
        content: { id: "I_issue", number: 12, repository: "octocat/example", type: "Issue", url: issue.html_url } });
      if (args[1] === "item-edit") {
        assert.equal(flag("--id"), "PVTI_item");
        assert.equal(flag("--project-id"), "PVT_project");
        assert.equal(flag("--field-id"), "PVTSSF_status");
        const option = args.includes("--clear") ? null : flag("--single-select-option-id");
        assert.ok(option === null || ["todo", "doing", "done"].includes(option));
        status = { todo: "Todo", doing: "In Progress", done: "Done" }[option] ?? "";
        return result({});
      }
    }
    assert.fail(`Unexpected gh command: ${args.join(" ")}`);
  };
  return { root, stateDir, configFile, issue, comments, fields, mutations, tool, git,
    task: { id: "issue-12", agent: "codex", path: join(root, ".worktrees", "issue-12"), branch: "task/issue-12" },
    tracker: () => new WorktreeGitHub(root, tool, stateDir),
    fail: (value) => { fail = value; }, beforeComment: (action) => { beforeComment = action; },
    status: () => status, projects: (value) => { projects = value; },
  };
}
