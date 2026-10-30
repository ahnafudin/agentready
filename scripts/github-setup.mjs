#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { isMain, parseFlags, readJson, runTool } from "./lib/util.mjs";
import { githubConfigPath, githubOrigin, runGitHub, validateGitHubConfig } from "./lib/worktree-github.mjs";
import { repository, withLock, writeState } from "./lib/worktree-state.mjs";
import { join } from "node:path";

export function configureGitHub({ root, stateDir, tool = runTool, project, owner } = {}) {
  return withLock(join(stateDir, "github.lock"), () => {
    const origin = githubOrigin(root);
    if (!origin) throw new Error("Add this repository's GitHub origin before running npm run issues:setup.");
    const run = (args) => runGitHub(tool, root, args, origin);
    const repo = run(["repo", "view", origin, "--json", "name,nameWithOwner,owner,url"]);
    if (!repo?.name || repo.nameWithOwner?.toLowerCase() !== origin.toLowerCase()) throw new Error("GitHub repository does not match origin; check its URL and authentication.");
    const stored = readJson(githubConfigPath(stateDir));
    const saved = stored?.repository?.toLowerCase() === origin.toLowerCase() ? stored : null;
    const login = owner ?? saved?.owner ?? repo.owner?.login;
    const selectedNumber = project ?? (owner === undefined || owner === saved?.owner ? saved?.number : undefined);
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(login ?? "")) throw new Error("Choose a valid GitHub Project owner with --owner.");
    let selected;
    if (selectedNumber !== undefined) {
      if (!/^[1-9][0-9]*$/.test(String(selectedNumber)) || !Number.isSafeInteger(Number(selectedNumber))) throw new Error("Choose a positive Project number with --project.");
      selected = run(["project", "view", String(selectedNumber), "--owner", login, "--format", "json"]);
    } else {
      const title = `${repo.name} — Development Tracker`;
      const existing = run(["project", "list", "--owner", login, "--limit", "1000", "--format", "json"]);
      const matches = existing.projects.filter((entry) => entry.title === title && !entry.closed);
      if (matches.length > 1) throw new Error("Several Projects have the tracker title; select one with --project.");
      if (existing.totalCount > existing.projects.length) throw new Error("Project discovery was incomplete; choose the tracker with --project.");
      selected = matches[0] ?? run(["project", "create", "--owner", login, "--title", title, "--format", "json"]);
    }
    if (!selected?.id || !Number.isSafeInteger(selected.number) || selected.closed) throw new Error("GitHub returned no active Project; choose one with --project.");
    run(["project", "link", String(selected.number), "--owner", login, "--repo", repo.nameWithOwner]);
    const fields = run(["project", "field-list", String(selected.number), "--owner", login, "--limit", "100", "--format", "json"]);
    const status = fields.fields.find((field) => field.name === "Status");
    const statuses = Object.fromEntries((status?.options ?? []).map((option) => [option.name, option.id]));
    const config = validateGitHubConfig({ repository: repo.nameWithOwner, owner: login, number: selected.number,
      id: selected.id, checkoutId: saved?.checkoutId || randomUUID(), statusField: status?.id, statuses: Object.fromEntries(["Todo", "In Progress", "Done"].map((name) => [name, statuses[name]])) }, origin);
    if (!fields.fields.some((field) => field.name === "Priority")) {
      run(["project", "field-create", String(selected.number), "--owner", login, "--name", "Priority",
        "--data-type", "SINGLE_SELECT", "--single-select-options", "P0,P1,P2,P3,P4", "--format", "json"]);
    }
    writeState(githubConfigPath(stateDir), config);
    return config;
  }, { timeoutMs: 30000 });
}

export function main(argv) {
  const { flags, positional, problems } = parseFlags(argv, { valued: ["--project", "--owner"], known: ["--help"] });
  if (positional.length) problems.push("unexpected positional argument");
  if (problems.length) {
    process.stderr.write(`[issues] ${problems.join("; ")}\n`);
    return 2;
  }
  if (flags.has("--help")) {
    process.stdout.write("usage: github-setup.mjs [--project number] [--owner login]\n");
    return 0;
  }
  try {
    const { root, stateDir } = repository(process.cwd());
    const config = configureGitHub({ root, stateDir, project: flags.get("--project"), owner: flags.get("--owner") });
    process.stdout.write(`[issues] ${config.repository} → Project ${config.owner}/${config.number}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`[issues] ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
