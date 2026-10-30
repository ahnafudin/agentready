import { randomUUID } from "node:crypto";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { norm, tryRun } from "./util.mjs";

export function gitAt(cwd, args) {
  const result = tryRun("git", args, { cwd });
  if (!result.ok) throw new Error(`Git failed: ${result.out}`);
  return result.out;
}

export function gitWorktrees(cwd) {
  return gitAt(cwd, ["worktree", "list", "--porcelain", "-z"])
    .split("\0\0").filter(Boolean).map((block) => {
      const fields = Object.fromEntries(block.split("\0").filter(Boolean).map((line) => {
        const space = line.indexOf(" ");
        return space < 0 ? [line, true] : [line.slice(0, space), line.slice(space + 1)];
      }));
      return { path: fields.worktree, branch: fields.branch, bare: fields.bare };
    });
}

export function repository(cwd) {
  const common = gitAt(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const main = gitWorktrees(cwd)[0];
  if (!main?.path || main.bare) throw new Error("Worktree management requires a non-bare main checkout.");
  return { root: resolve(main.path), commonDir: common, stateDir: join(common, "agentready", "worktrees") };
}

export function validateTaskId(id) {
  if (typeof id !== "string" || id.length > 80 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) {
    throw new Error("Invalid task ID; use a lowercase issue ID or slug without path separators.");
  }
  return id;
}

export function validateAgent(agent) {
  if (!["claude", "codex"].includes(agent)) throw new Error("Choose an agent: claude or codex.");
  return agent;
}

export function taskPath(root, id) {
  validateTaskId(id);
  const parent = join(root, ".worktrees");
  const path = join(parent, id);
  for (const candidate of [parent, path]) {
    if (existsSync(candidate) && (lstatSync(candidate).isSymbolicLink() || norm(dirname(candidate)) !== norm(candidate === parent ? root : parent))) {
      throw new Error("A worktree path is a symlink or junction outside the managed directory.");
    }
  }
  return path;
}

export function writeState(path, state) {
  writeAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function writeAtomic(path, content, { mode = 0o666 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: "wx", mode });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function lockActive(path) {
  if (!existsSync(path)) return false;
  let owner;
  try {
    owner = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return true; // A process may still be writing the newly acquired lock.
  }
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

export function withLock(path, action, { timeoutMs = 0 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const owner = { pid: process.pid, token: randomUUID() };
  const temporary = `${path}.${owner.token}.owner`;
  writeFileSync(temporary, JSON.stringify(owner), { flag: "wx" });
  const busy = () => Object.assign(new Error(`Worktree or tracker is locked by an active agent or operation: ${path}`), { code: "AGENTREADY_LOCKED" });
  const publish = (target) => {
    try {
      linkSync(temporary, target); // The exclusive lock is published with its owner already initialized.
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw busy();
    }
  };
  const release = (target) => {
    const actual = JSON.parse(readFileSync(target, "utf8"));
    if (actual.token !== owner.token) throw new Error("Lock ownership changed; refusing to release another process's lock.");
    unlinkSync(target);
  };
  const acquire = () => {
    try {
      publish(path);
    } catch (error) {
      if (error.code !== "AGENTREADY_LOCKED" || lockActive(path)) throw error;
      const reclaim = `${path}.reclaim`;
      try {
        publish(reclaim);
      } catch (reclaimError) {
        if (reclaimError.code === "AGENTREADY_LOCKED" && !lockActive(reclaim)) {
          throw new Error(`An exited process left recovery guard ${reclaim}; verify its PID has exited, remove only that guard file, and retry.`);
        }
        throw reclaimError;
      }
      try {
        if (lockActive(path)) throw busy();
        if (existsSync(path)) unlinkSync(path);
        publish(path);
      } finally {
        release(reclaim);
      }
    }
  };
  let acquired = false;
  try {
    const deadline = Date.now() + timeoutMs;
    while (!acquired) {
      try {
        acquire();
        acquired = true;
      } catch (error) {
        if (error.code !== "AGENTREADY_LOCKED" || Date.now() >= deadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
      }
    }
    return action();
  } finally {
    if (acquired) release(path);
    unlinkSync(temporary);
  }
}
