# SETUP

## First machine (new project from agentready)

```bash
npm install          # activates the auto-version git hook (postinstall)
npm run setup        # hooks → framework detection → agent docs → GitHub Project
```

Setup detects your framework and writes three things for you: `package.json` → `tooling.gates`,
the `.gitignore` managed block, and `docs/STACK.md`. **Read `docs/STACK.md` first** — if it named
the wrong framework, or a gate command is wrong, fix it now:

```bash
npm run stack:detect            # what matched, and how strongly
npm run stack:list              # every framework in the registry
npm run stack:reapply           # re-derive tooling.gates from the registry (overwrites hand edits)
npm run gate:list               # exactly what `npm run gate` will run
npm run gate                    # run it
```

If your framework is missing, add one entry to `scripts/stacks.json` (see the example in
`README.md`) and run `npm run stack:validate`. No code change is needed — and please keep
`"verified": false` until you have actually run the commands.

> agentready ships `tooling.gates` marked `"pristine": true` — those are the commands
> agentready uses to maintain itself. The first `npm run stack:apply` in a renamed project replaces
> them with your framework's and drops the marker. After that they are yours: nothing overwrites
> them again unless you ask (`npm run stack:reapply`).

Then fill the placeholders — search for `TODO:fill`:

- [ ] `AGENTS.md` — project name · Project summary · Stack table · Layer responsibilities ·
      Naming conventions · Conventions · Commands · design-token pointer in the
      "No AI slop" rule
- [ ] `package.json` → `tooling.slop.ignore` — globs for vendored or generated code the comment check
      should skip (`npm run slop` lists what it would flag today); `maxDocCommentLines` if your API
      docs (`/**`, `///`) need more than three lines
- [ ] `CLAUDE.md` — project name only (everything else is imported from `AGENTS.md`; **do not copy
      rules here**)
- [ ] `package.json` — **`name` first, before anything else.** While it is `my-project`,
      the scripts treat the copy as agentready itself. Tracker setup follows the GitHub origin,
      and its machine-local configuration stays outside versioned files.
      Non-JS project? Keep this file anyway — it is the TOOLING
      manifest (setup, gates, versioning); add your language's real manifest beside it
      (`composer.json`, `pyproject.toml`, `go.mod` + a root `VERSION` file — all auto-synced,
      see `docs/VERSIONING.md`)
- [ ] `README.md` — `npm run setup` replaces agentready's README with a stub about your project
      (agentready's own is kept at `docs/TOOLING.md`); fill in the description
- [ ] `.env.example` — every variable the app reads (values stay empty; it is the contract)
- [ ] `.github/workflows/gate.yml` — add your language toolchain step
- [ ] `docs/PRD.md` — problem, goals, scope, risks, guardrails
- [ ] `docs/ARCHITECTURE.md` — layers + first decisions
- [ ] `docs/TASKS.md` — phase 1 checklist
- [ ] `DESIGN.md` — if the project has a UI: the tokens and the eight sections, before the first
      screen; move each token group out of `omitted` as you define it (`npm run design` checks it)
- [ ] A `LICENSE` file for your project — `npm run setup` moves agentready's MIT licence to
      `docs/TOOLING-LICENSE` (it covers the copied tooling), so the root is yours to choose
- [ ] Delete the SETUP NOTE at the top of `AGENTS.md`

Prerequisites: Node ≥ 22 and git. For issue tracking, install GitHub CLI and authenticate:

```bash
gh auth login --scopes repo,project
npm run issues:setup
```

Without a GitHub origin, local setup and quality gates still work. Add your own origin before
connecting the tracker. See [docs/ISSUES.md](docs/ISSUES.md).

## Editing the rules

`AGENTS.md` is canonical. `CLAUDE.md` imports it (`@AGENTS.md`) and adds Claude-Code-only notes;
every other tool file is **generated**:

```bash
npm run agents:sync     # regenerate the pointer files after editing AGENTS.md
npm run agents:check    # CI/gate check: are they stale? (part of `npm run gate`)
```

Never hand-edit `GEMINI.md`, `CONVENTIONS.md`, `.cursor/rules/`, `.windsurf/rules/`, `.clinerules/`,
`.junie/` or `.github/copilot-instructions.md` — your changes are overwritten on the next sync.
Commit the generated files: a fresh clone opened in Cursor must already have them.

## Working on agentready itself (not a project made from it)

Leave `package.json`'s `name` as `my-project`. GitHub tracker setup uses the repository's origin;
it does not use the placeholder package name. The connection is saved only in the common Git
directory, so copies of the template inherit no Project IDs or local tracker data.

## Keeping AI agents out of your contributor list

Three layers, because a hook cannot run before it is installed:

- **Per tool.** `.claude/settings.json` here (and `~/.claude/settings.json` for every project)
  sets `attribution: { commit: "", pr: "", sessionUrl: false }` plus the older
  `includeCoAuthoredBy: false`, so Claude Code adds no `Co-Authored-By`, no
  "Generated with Claude Code" line and no session link. Other tools each have their own
  switch — Cursor, Copilot and the rest are NOT covered by this file.
- **For every tool at once.** `.githooks/commit-msg` removes every `Co-authored-by` line, session
  link and "Generated with" line, whatever wrote it. The rule is one author per commit: a list of
  bot addresses always falls behind, and matching names deletes real people.
- **In CI.** `.github/workflows/attribution.yml` fails the build if a commit carries one anyway —
  the layer that covers a fresh clone where no hook is installed yet.

Credit a collaborator in the commit body instead. A body that merely discusses attribution is left
alone; `scripts/tests/commit-msg.test.mjs` covers both.

⚠️ Neither layer touches commits you have already pushed. Their messages are part of history,
so removing attribution there means `git filter-repo` (or an interactive rebase) followed by a
force-push — which rewrites every SHA from that point on. Worth it on a solo repo; coordinate
first on a shared one.

## If git says "dubious ownership"

Every git command fails with exit 128 and setup stops. This is **not** a missing repository — do
not run `git init`. It happens after a drive move, an OS reinstall, or copying a repo between user
accounts. `npm run setup` prints the exact fix; it is:

```bash
git config --global --add safe.directory "/full/path/to/your/repo"
```

## Second machine (same project, e.g. Windows + macOS)

What git carries: `AGENTS.md`, generated pointers, docs and archives, `.claude/settings.json`,
`.githooks/` and `package.json` gates. GitHub stores issues, comments and Project data remotely.
Per-machine state includes GitHub authentication, the local Project connection, `core.hooksPath`,
your SSH configuration and agent auto-memory. Keep cross-machine decisions in GitHub or docs.

```bash
git clone <origin>
cd <project>
gh auth login --scopes repo,project
npm install
npm run setup                 # reconnects the existing GitHub Project
npm run gate
```

There is no issue database to pull or push. `gh issue list` reads the current remote tracker.

## Machine-level agent tooling (deliberately NOT in agentready)

Token/behavior optimizers — e.g. **rtk** (compresses CLI output before it enters context),
**caveman** (terse response style), **ponytail** (write-less-code bias) — are all **per-machine**
installs (global hooks/plugins in `~/.claude`), not per-project files. They compose with
agentready but do not belong in it: a repo must work on a machine that has none of them. Install/skip
them per machine to taste. One warning if you use caveman: never run `/caveman-compress` on
`AGENTS.md` — it rewrites lossily and the contracts there are load-bearing.

One context saver does ship: `scripts/read-guard.mjs`, a Claude Code hook that denies reading a
whole file over 400 lines without an offset/limit window (details in `CLAUDE.md`). It is the
exception because it depends on nothing agentready does not already require — Node — so the rule
above still holds: a machine with nothing installed gets it, and so does a cloud session, which
never sees `~/.claude`. Installing the same guard globally as well is harmless: both run and agree.

## Day-to-day rhythm (any machine)

- Session start: inspect `git status`, `gh issue list` and the linked Project.
- Before saying "done": run `npm run gate` and report its result.
- Session end: update issues and Project Status; commit/push only when the owner asks.
