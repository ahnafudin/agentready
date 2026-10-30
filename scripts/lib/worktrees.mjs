import { existsSync, lstatSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { norm, readIfExists, readJson, runTool, tryRun, upsertManagedBlock, writeIfChanged } from "./util.mjs";
import { WorktreeGitHub } from "./worktree-github.mjs";
import { gitAt, gitWorktrees, lockActive, repository, taskPath, validateAgent, validateTaskId, withLock, writeState } from "./worktree-state.mjs";

function handoffDocument(task) {
  return `# Worktree handoff — ${task.id}\n\nAgent: ${task.agent}\nBranch: ${task.branch}\nMain checkout: ${task.root}\n\nThis checkout is already isolated; keep code edits here. Run lifecycle commands from the main checkout. Use gh for GitHub issue and Project access.\n\n${task.handoff}\n`;
}

export function createWorktreeManager({ cwd = process.cwd(), tool = runTool } = {}) {
  const { root, commonDir, stateDir } = repository(cwd);
  const tracker = new WorktreeGitHub(root, tool, stateDir);
  const stateFile = (id) => join(stateDir, `${validateTaskId(id)}.json`);
  const lockFile = (id) => join(stateDir, `${validateTaskId(id)}.lock`);
  const pendingFile = (id) => join(stateDir, `${validateTaskId(id)}.pending`);
  const git = (args) => gitAt(root, args);

  function installContextIgnores() {
    const exclude = join(commonDir, "info", "exclude");
    writeIfChanged(exclude, upsertManagedBlock(readIfExists(exclude), "worktree-context", "/.agentready-handoff.md"));
  }

  function cleanResidual(path) {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) unlinkSync(child);
      else if (stat.isDirectory()) cleanResidual(child);
      else throw new Error(`Git left a file at ${child}; preserve or remove it before retrying wt:remove.`);
    }
    rmdirSync(path);
  }

  function removeTree(path) {
    const dependencies = join(path, "node_modules");
    const shared = existsSync(dependencies) && lstatSync(dependencies).isSymbolicLink() &&
      norm(dependencies) === norm(join(root, "node_modules"));
    if (shared) unlinkSync(dependencies);
    try {
      git(["worktree", "remove", path]);
    } catch (error) {
      if (shared && existsSync(path)) symlinkSync(join(root, "node_modules"), dependencies, process.platform === "win32" ? "junction" : "dir");
      throw error;
    }
    if (existsSync(path)) cleanResidual(path);
  }

  function getTask(id) {
    const task = readJson(stateFile(id));
    if (!task) throw new Error(`No managed worktree for ${id}; create it first.`);
    const expected = taskPath(root, id);
    if (task.id !== id || norm(task.path) !== norm(expected) || norm(task.root) !== norm(root) || task.branch !== `task/${id}` ||
        (task.githubRepository && task.githubRepository !== tracker.repository)) {
      throw new Error("Worktree state does not match the managed location; inspect it before continuing.");
    }
    validateAgent(task.agent);
    return task;
  }

  function requireTree(task) {
    const found = gitWorktrees(root).find((entry) => norm(entry.path) === norm(task.path));
    if (!existsSync(task.path) || found?.branch !== `refs/heads/${task.branch}`) {
      throw new Error("The managed worktree is missing or its branch changed; restore it before opening or handing it off.");
    }
    const note = join(task.path, ".agentready-handoff.md");
    if (existsSync(note) && lstatSync(note).isSymbolicLink()) throw new Error("The handoff note is a symlink; restore a regular file before continuing.");
    if (tryRun("git", ["ls-files", "--error-unmatch", "--", ".agentready-handoff.md"], { cwd: task.path }).ok) {
      throw new Error("The selected branch tracks the reserved .agentready-handoff.md file; rename it before continuing.");
    }
  }

  function save(task) {
    installContextIgnores();
    writeState(stateFile(task.id), task);
    writeFileSync(join(task.path, ".agentready-handoff.md"), handoffDocument(task));
    return task;
  }

  function trackedIssue(task) {
    if (!task.githubRepository) return null;
    if (!tracker.enabled) throw new Error("GitHub tracking is not configured; run npm run issues:setup before continuing.");
    return tracker.show(task.id);
  }

  function recoverTask(id) {
    const task = getTask(id);
    const pending = readJson(pendingFile(id));
    if (!pending) return task;
    if (pending.id !== id || norm(pending.path) !== norm(task.path) || pending.branch !== task.branch) {
      throw new Error("Pending handoff does not match this worktree; inspect the registry before continuing.");
    }
    validateAgent(pending.agent);
    requireTree(task);
    const issue = trackedIssue(task);
    if (issue) {
      tracker.association(task, issue);
      if (issue.assignee === task.agent && issue.metadata?.["agentready.agent"] === task.agent && task.agent !== pending.agent) {
        unlinkSync(pendingFile(id));
        return task;
      }
      if (issue.assignee !== pending.agent || issue.metadata?.["agentready.agent"] !== pending.agent) {
        throw new Error("Pending handoff conflicts with GitHub ownership; resolve the tracker assignment before retrying.");
      }
    }
    save(pending);
    unlinkSync(pendingFile(id));
    return pending;
  }

  return {
    create(id, { agent, base = "HEAD" } = {}) {
      validateTaskId(id);
      validateAgent(agent);
      const path = taskPath(root, id);
      if (existsSync(stateFile(id)) || existsSync(path)) throw new Error(`A worktree for ${id} already exists; use wt:open.`);
      if (!tryRun("git", ["check-ignore", "--quiet", "--no-index", path], { cwd: root }).ok) {
        throw new Error("Add /.worktrees/ to .gitignore before creating a worktree.");
      }
      const commit = git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
      return withLock(lockFile(id), () => {
        if (existsSync(stateFile(id)) || existsSync(path)) throw new Error(`A worktree for ${id} already exists; use wt:open.`);
        const githubRepository = tracker.enabled ? tracker.repository : null;
        const issue = githubRepository ? tracker.owned(id, agent) : null;
        const task = {
          id, agent, path, root, branch: `task/${id}`, base: commit, githubRepository,
          createdAt: new Date().toISOString(),
          handoff: issue
            ? `Task: ${issue.title}\n\n${issue.description ?? ""}\n\n${issue.notes ?? ""}`.trim()
            : `Continue task ${id}; read AGENTS.md and inspect the Git diff before editing.`,
        };
        if (issue) tracker.association(task, issue);
        installContextIgnores();
        git(["worktree", "add", "-b", task.branch, path, commit]);
        try {
          writeState(stateFile(id), task);
          requireTree(task);
          const dependencies = join(root, "node_modules");
          if (existsSync(dependencies)) symlinkSync(dependencies, join(path, "node_modules"), process.platform === "win32" ? "junction" : "dir");
          if (issue) tracker.assign(task, issue);
        } catch (error) {
          if (error.retainWorktree) {
            throw new Error(`${error.message}; workspace retained, retry wt:open or wt:remove for ${id}.`);
          }
          try {
            removeTree(path);
            git(["update-ref", "-d", `refs/heads/${task.branch}`, commit]);
            if (existsSync(stateFile(id))) unlinkSync(stateFile(id));
          } catch (cleanupError) {
            throw new Error(`${error.message}; rollback also failed: ${cleanupError.message}`);
          }
          throw error;
        }
        return save(task);
      });
    },

    list() {
      if (!existsSync(stateDir)) return [];
      return readdirSync(stateDir).filter((name) => name.endsWith(".json")).sort().map((name) => {
        const task = getTask(name.slice(0, -5));
        return { ...task, active: lockActive(lockFile(task.id)), missing: !existsSync(task.path), pending: existsSync(pendingFile(task.id)) };
      });
    },

    open(id, { agent } = {}) {
      return withLock(lockFile(id), () => {
        const task = recoverTask(id);
        requireTree(task);
        if (task.phase === "removing") throw new Error("Cleanup is in progress; finish wt:remove before reopening this task.");
        if (agent && validateAgent(agent) !== task.agent) throw new Error(`Use wt:handoff to switch ${task.agent} to ${agent} first.`);
        if (task.githubRepository) {
          const issue = tracker.owned(id, task.agent);
          tracker.association(task, issue);
          tracker.assign(task, issue);
        }
        const environment = task.githubRepository ? tracker.launchEnvironment(task.agent) : { ...process.env };
        save(task);
        const result = tool(task.agent, ["Read AGENTS.md and .agentready-handoff.md before editing. Stay in this isolated checkout and continue the task described there."], {
          cwd: task.path, env: environment, stdio: "inherit",
        });
        if (!result.ok) throw new Error(`Could not open ${task.agent}: ${result.out}`);
        return task;
      });
    },

    handoff(id, { to, note } = {}) {
      validateAgent(to);
      if (typeof note !== "string" || !note.trim()) throw new Error("A handoff needs a note describing decisions, test results, and next steps.");
      return withLock(lockFile(id), () => {
        const task = recoverTask(id);
        requireTree(task);
        if (task.phase === "removing") throw new Error("Cleanup is in progress; finish wt:remove before handing off this task.");
        const next = { ...task, agent: to, handoff: note.trim(), updatedAt: new Date().toISOString() };
        writeState(pendingFile(id), next);
        if (task.githubRepository) {
          const issue = tracker.owned(id, task.agent);
          tracker.comment(task, `Handoff request: ${task.agent} → ${to}\n\n${next.handoff}`, stateDir);
          tracker.assign(next, issue, { handoff: true });
        }
        save(next);
        unlinkSync(pendingFile(id));
        return next;
      });
    },

    remove(id) {
      return withLock(lockFile(id), () => {
        const task = recoverTask(id);
        const issue = trackedIssue(task);
        if (issue) tracker.removable(task, issue);
        if (existsSync(task.path)) {
          const registered = gitWorktrees(root).find((entry) => norm(entry.path) === norm(task.path));
          if (task.phase === "removing" && !registered) cleanResidual(task.path);
          else {
            requireTree(task);
            const changes = gitAt(task.path, ["status", "--porcelain", "--untracked-files=all"]);
            if (changes) throw new Error("This worktree has changes; commit or preserve them before cleanup.");
            writeState(stateFile(id), { ...task, phase: "removing" });
            removeTree(task.path);
          }
        }
        if (issue) tracker.clear(task, issue);
        unlinkSync(stateFile(id));
        return task;
      });
    },
  };
}
