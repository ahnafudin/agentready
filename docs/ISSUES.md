# GitHub Issues and Projects

GitHub Issues owns bugs, tasks, follow-ups, decisions and completion evidence. The linked Project
tracks delivery Status and Priority. `docs/TASKS.md` is the phase-level roadmap.

## Connect a machine

Install GitHub CLI, add this project's GitHub repository as `origin`, then run:

```bash
gh auth login --scopes repo,project
npm run issues:setup
```

Setup finds the active Project named `<repository-name> — Development Tracker`, creates it if
missing, and links it to the repository. Existing explicit Project selections are reused on
subsequent setup runs. A missing Priority field is created with P0–P4 options. To select an existing Project explicitly:

```bash
npm run issues:setup -- --project 5 --owner your-login
```

The Project needs a Status field with Todo, In Progress and Done options. Setup validates those
options before saving `<git-common-dir>/agentready/github.json`. This file contains repository
and Project IDs plus a unique checkout identity, no credentials. Authentication stays with `gh`; copies inherit no tracker
identity. A configured GitHub origin requires successful tracker setup before managed task work.

## Select or create work

```bash
gh issue list
gh issue view 123 --comments
gh issue create --title "Describe the problem" --body-file issue.md
gh project item-add <project-number> --owner <project-owner> --url <issue-url>
```

Use the issue URL returned by creation. Add every new issue to the Project. Set Status to Todo
and select its Priority there; existing imported issues already have both. Link discovered work
to its originating issue in the description. Use native blocking or parent relationships only
when the relationship actually means blocking or parenthood.

## Execute and hand off

```bash
npm run wt:create -- issue-123 --agent codex
npm run wt:open -- issue-123
npm run wt:handoff -- issue-123 --to claude --note-file handoff.md
```

Creation validates the open issue, sets Project Status to In Progress and records agent
ownership in issue comments. These ownership records preserve human assignees and issue content;
keep them intact. Handoff notes carry decisions, verification results and remaining work.
Use `wt:handoff` to transfer ownership. Details and recovery: [WORKTREES.md](WORKTREES.md).

## Complete work

Run `npm run gate`, record the result and any remaining work, then close the issue and set its
Project Status to Done. The Project UI supports field changes. From the CLI, inspect item and
field IDs, then apply the selected Status option:

```bash
gh issue comment 123 --body-file completion.md
gh issue close 123 --reason completed
gh project item-list <project-number> --owner <project-owner> --format json
gh project field-list <project-number> --owner <project-owner> --format json
gh project item-edit --id <item-id> --project-id <project-id> --field-id <status-field-id> --single-select-option-id <done-option-id>
npm run wt:remove -- issue-123
```

Issue state and Project Status are separate: update both. Worktree removal releases only the
workspace association and retains the task branch. Commit and push code only when the owner asks.

If GitHub is unavailable, keep work and notes locally and retry synchronization. Tracked tasks
fail explicitly instead of silently switching to standalone tracking. Standalone slugs are
available only before a GitHub origin or tracker connection exists.
