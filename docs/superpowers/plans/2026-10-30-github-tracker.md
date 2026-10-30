# GitHub Tracker Migration Implementation Plan

> **For agentic workers:** Execute inline with independent migration verification. Preserve existing uncommitted work. Commit and push code only when the owner asks.

**Goal:** Make GitHub Issues and Projects authoritative, then retire the verified legacy tracker.

**Architecture:** Export all source records and independently inspect the remote snapshot. Import
issues and metadata into the repository's linked private Project. Replace local database calls
with authenticated GitHub CLI calls and machine-local Project configuration.

**Tech Stack:** Node standard library, Git, GitHub CLI, GitHub Issues and Projects.

**Spec:** User request: migrate everything successfully before fully removing the old tracker.

## Constraints

- Preserve closed issues, comments, typed relationships, priority and historical dates.
- Preserve human assignees, existing worktree safety and uncommitted owner changes.
- Keep recovery copies outside the repository; ship no repository-specific tracker identity.
- Retire the source only after remote read-back verification succeeds.

## Execution

- [x] Export all local records and back up the database, remote ref and existing diffs.
- [x] Create/link the private Project, import records and read back all migrated fields.
- [x] Inspect an isolated clone of the remote snapshot and reconcile every source ID.
- [x] Write failing GitHub lifecycle tests; implement the adapter and setup command.
- [x] Pass lifecycle tests for claim, handoff, recovery, ownership conflicts and cleanup.
- [x] Replace setup, hooks, generated instructions and workflow documentation.
- [x] Remove verified legacy database, wrappers, configuration and remote sync ref.
- [x] Run the live GitHub lifecycle and full `npm run gate`; record final evidence.

## Review focus

Check conflicting claims, API failure rollback, remote-transfer/local-save recovery, human
assignment preservation and tracker configuration isolation in derived projects.
