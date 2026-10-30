# CLAUDE.md — <PROJECT_NAME>

**The project's working rules live in [`AGENTS.md`](AGENTS.md) — that file is canonical for every
agent, and Claude Code loads it through the import below.** Do not copy rules into this file: put
them in `AGENTS.md` and run `npm run agents:sync`. What belongs HERE is only what is specific to
Claude Code.

@AGENTS.md

> If that import ever fails to expand, read `AGENTS.md` yourself before doing anything else —
> it carries the docs-routing map, the `npm run gate` contract, the archive contract and the
> no-auto-push rule.

---

## Claude Code specifics

These use Claude Code features other agents do not have. Everything else is in `AGENTS.md`.

- **Worktrees:** when launched through `wt:open`, work directly in the current managed checkout.
  `EnterWorktree` creates another Claude-managed checkout; the shared task lifecycle is defined
  in `AGENTS.md` and `docs/WORKTREES.md`.
- **Parallel subagents:** run independent subtasks with the Agent tool when the work genuinely
  splits; keep shared-state work in a single agent.
- **Session narration:** Claude Code auto-titles the conversation; ADDITIONALLY mark a chapter
  (`mark_chapter`, when the session tool is available) at every major phase change —
  exploration → implementation → verification → wrap-up — so the transcript's table of contents
  shows what the session is doing at a glance.
- **Memory:** Claude Code's auto-memory does NOT sync between machines. Anything
  cross-machine-critical belongs in `AGENTS.md` or `docs/` — which is the whole point of
  agentready.
- **Hooks:** `.claude/settings.json` installs native Git hooks on SessionStart.
- **Read guard:** a PreToolUse hook (`scripts/read-guard.mjs`) denies a Read with no
  offset/limit of a file over 400 lines. Grep for what you need and Read that window; pass
  `offset: 1, limit: N` when you truly need all of it. `READ_GUARD_MAX_LINES` moves the line.
- **Slop guard:** after every Edit or Write, `scripts/slop-guard.mjs` names any comment block over
  the limit in that file. Shorten it right away — `npm run gate` fails on the same check.
- **`/anti-slop`:** reviews the current diff against `docs/anti-slop/` and lists what to fix.
