# Architecture — <PROJECT_NAME>

<!-- TODO:fill. This file is the FIRST stop before inventing a new pattern
     (see AGENTS.md → "When unsure"). Keep it current: stale architecture docs
     are worse than none. -->

## Overview

<!-- One diagram-in-words paragraph: the layers and how data flows between them. -->

## Layers

| Layer | Owns | Must NOT do |
|---|---|---|
| | | |

## Key decisions

<!-- ADR-lite: one entry per irreversible/expensive decision. Newest on top.

### <date> — <decision>
- Context:
- Decision:
- Consequence:
-->

## Patterns

<!-- Named patterns agents should reuse (error envelope, repository pattern,
     event naming, IPC conventions, …). -->

## Tooling — shared task worktrees

`scripts/worktrees.mjs` parses the CLI; `scripts/lib/worktrees.mjs` owns the lifecycle.
Git discovery, path validation and locks live in `worktree-state.mjs`; `worktree-github.mjs`
owns GitHub Issues and Projects calls through authenticated `gh`. They use native Git and the
official Claude/Codex CLIs, without new dependencies.

Each task uses `.worktrees/issue-<number>/` and `task/issue-<number>`. Transient state and process
locks live in the common Git directory, so linked checkouts resolve the same registry. GitHub
Issues owns issue content and completion; Project Status and Priority own delivery tracking.
`scripts/github-setup.mjs` discovers or creates the repository's linked Project and stores its
IDs in `<git-common-dir>/agentready/github.json`. Copies inherit no tracker identity.

Each checkout has a stable random identity in its local configuration, distinguishing machines
even when their absolute paths and agent names match. Agent ownership uses immutable issue comments whose JSON references the preceding accepted
comment ID. Folding comments in ID order accepts the first successor and ignores competing
claims; operations re-read and verify their event before reporting success. Human assignees and
issue bodies remain intact. A local tracker lock serializes this checkout's mutations; a separate
worktree lock protects each foreground agent session. Pending handoff records reconcile remote
ownership transfer with local persistence; removal phases allow cleanup to resume after Git has
deregistered a worktree. Ownership comments are an audit trail; keep them intact.

Failed claims restore Project Status when ownership has not changed; uncertain remote outcomes
retain the workspace for retry. Assignment rejects issues closed during the claim.

Cleanup validates ownership and Git status, detaches the shared dependency link, removes the worktree and releases
its issue association. Branches and issue completion remain explicit. The commands never commit,
merge or push code. See [ISSUES.md](ISSUES.md) and [WORKTREES.md](WORKTREES.md).
