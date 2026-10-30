# Shared task worktrees

Use `.worktrees/<task-id>/` for new task workspaces. Each task gets a `task/<task-id>` branch,
and either Claude or Codex can continue its code. Create separate worktrees for independent
parallel tasks. Handoff transfers one task between agents after the previous session exits.

## Create and open

For a GitHub repository, run `npm run issues:setup` first. Select an existing open issue and use
`issue-<number>` as the task ID. The manager checks ownership, adds the issue to the Project,
sets Status to In Progress and records the selected agent without changing human assignees.

```powershell
gh issue list
gh issue view 123
npm run wt:create -- issue-123 --agent codex
npm run wt:open -- issue-123
```

`wt:open` runs the selected official CLI in the current terminal. Exit the CLI to release
the writer lock. Run another `wt:open` in a separate terminal for a different task. Your
normal Claude/ChatGPT authentication and permission settings apply.
Run lifecycle commands from the main checkout when the chosen base predates these scripts;
the manager uses the main checkout's GitHub tracker configuration.

Creation defaults to the main checkout's committed `HEAD`. Use `--base main` or another
Git revision to choose a different starting point. Uncommitted changes in the main checkout
remain there. Already-created `.claude/worktrees/` folders are left in place; this manager
registers the new neutral workspaces it creates.

Installed `node_modules` are linked from the main checkout, using a junction on Windows.
When changing dependencies, replace that link with a separate installation before running
an installer that would mutate the shared directory. Secrets and other ignored files are
not copied automatically; configure the task's local environment when it needs them.

## Handoff

After the previous CLI session exits, record what the next agent needs and select it:

```powershell
npm run wt:handoff -- issue-123 --to claude --note "Login fix implemented. Gate passed. Review expired-token behavior next."
npm run wt:open -- issue-123
```

For longer context, write a note and pass its path with `--note-file handoff.md` instead of
`--note`. Include the goal, decisions, remaining work, and actual test results. The manager
records a handoff request in the same GitHub issue, then publishes the ownership transfer.
If the tracker rejects the transfer, the existing local owner and workspace context remain.
If ownership transferred before local persistence failed, repair the filesystem error and
retry `wt:open`, `wt:handoff`, or `wt:remove`; the pending record reconciles the new owner and note.

The next CLI receives a prompt to read `AGENTS.md` and `.agentready-handoff.md`. That generated
note is ignored by Git, including when the selected base predates the ignore rules. Code and
uncommitted changes stay in the same workspace; the two products' conversations remain separate.

## Shared GitHub tracker

All managed worktrees use the same remote GitHub issues and linked Project. Launched CLIs receive
`GH_REPO` and `AGENTREADY_AGENT`; they use the normal authenticated `gh` executable. The manager
serializes local tracker mutations and checks an ordered ownership ledger in issue comments to
detect conflicting claims from other machines. Keep these ownership comments intact.

Configuration lives in `<git-common-dir>/agentready/github.json`, outside tracked files. It must
match the GitHub origin; missing access or configuration fails explicitly for tracked tasks.
Without a GitHub origin or configured tracker, the manager accepts standalone task slugs.
It never commits, merges or pushes code. Setup and issue completion are explicit operations.

## Inspect and clean up

```powershell
npm run wt:list
npm run wt:list -- --json
npm run wt:remove -- issue-123
```

Removal refuses active sessions and tracked or untracked changes. It retains the task branch
and leaves issue status unchanged. Run `npm run gate` in the task workspace before completing
the issue with `gh issue close <number>` and setting Project Status to Done; commit and merge only when the owner asks.

If tracker cleanup fails after Git removes a worktree, fix the tracker connection and run
`wt:remove` again to clear the remaining association. No force-delete option is provided.

Registry files and locks live in `<git-common-dir>/agentready/worktrees/`. Locks protect
foreground sessions started through this manager; independently launched apps are outside
that supervision. Locks whose process has exited can be recovered on the next operation.
An interrupted stale-lock recovery can leave a `.reclaim` guard. The error names that guard;
after confirming its recorded PID has exited, remove only the guard file and retry. A malformed
legacy lock likewise needs inspection and manual removal after all related sessions exit.
Commands work from the main checkout or a linked checkout. When cleaning up the worktree you
are currently using, invoke `wt:remove` from the main checkout.
