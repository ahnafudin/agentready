#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isMain, parseFlags } from "./lib/util.mjs";
import { createWorktreeManager } from "./lib/worktrees.mjs";

const USAGE = `usage: worktrees.mjs <command> [task-id] [options]
  create  <task-id> --agent claude|codex [--base main]
  open    <task-id> [--agent claude|codex]
  handoff <task-id> --to claude|codex --note "context"
                    (or --note-file path)
  list    [--json]
  remove  <task-id>
`;

export function main(argv) {
  const [command, ...args] = argv;
  const options = {
    create: { valued: ["--agent", "--base"] },
    open: { valued: ["--agent"] },
    handoff: { valued: ["--to", "--note", "--note-file"] },
    list: { known: ["--json"] },
    remove: {},
  };
  if (command === "--help" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!Object.hasOwn(options, command ?? "")) {
    process.stderr.write(`Unknown worktree command: ${command ?? "(missing)"}\n${USAGE}`);
    return 2;
  }
  const { positional, flags, problems } = parseFlags(args, options[command]);
  if (positional.length !== (command === "list" ? 0 : 1)) problems.push("provide exactly one task ID (none for list)");
  if (command === "handoff" && Number(flags.has("--note")) + Number(flags.has("--note-file")) !== 1) {
    problems.push("provide either --note or --note-file");
  }
  if (problems.length) {
    process.stderr.write(`[worktrees] ${problems.join("; ")}\n${USAGE}`);
    return 2;
  }
  try {
    const manager = createWorktreeManager();
    const id = positional[0];
    if (command === "list") {
      const tasks = manager.list();
      process.stdout.write(flags.has("--json") ? `${JSON.stringify(tasks, null, 2)}\n` :
        tasks.length ? tasks.map((task) => `${task.id}\t${task.agent}\t${task.active ? "active" : task.pending ? "pending" : task.phase === "removing" ? "removing" : task.missing ? "missing" : "idle"}\t${task.path}`).join("\n") + "\n" : "No managed worktrees.\n");
      return 0;
    }
    let task;
    if (command === "create") task = manager.create(id, { agent: flags.get("--agent"), base: flags.get("--base") });
    if (command === "open") task = manager.open(id, { agent: flags.get("--agent") });
    if (command === "handoff") task = manager.handoff(id, {
      to: flags.get("--to"), note: flags.has("--note-file") ? readFileSync(flags.get("--note-file"), "utf8") : flags.get("--note"),
    });
    if (command === "remove") task = manager.remove(id);
    process.stdout.write(`[worktrees] ${command}: ${task.id} (${task.agent})\n${task.path}\n`);
    if (command === "remove") process.stdout.write(`Branch retained: ${task.branch}; GitHub issue status unchanged.\n`);
    if (command === "create" && !task.githubRepository) process.stdout.write("No GitHub origin configured; this worktree uses a standalone task ID.\n");
    return 0;
  } catch (error) {
    process.stderr.write(`[worktrees] ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
