<!-- tooling:readme -->
# agentready

**One set of rules every AI coding agent follows, one command that says the work is done, and a gate that
turns AI slop red.**

[![gate](https://github.com/ahnafudin/agentready/actions/workflows/gate.yml/badge.svg)](https://github.com/ahnafudin/agentready/actions/workflows/gate.yml)
[![release](https://img.shields.io/github/v/release/ahnafudin/agentready)](https://github.com/ahnafudin/agentready/releases)
[![npm](https://img.shields.io/npm/v/%40ahnafudin%2Fagentready)](https://www.npmjs.com/package/@ahnafudin/agentready)
[![license](https://img.shields.io/github/license/ahnafudin/agentready)](https://github.com/ahnafudin/agentready/blob/main/LICENSE)

![A four-line comment fails npm run slop; cut to one line, it passes.](https://raw.githubusercontent.com/ahnafudin/agentready/main/.github/assets/demo.svg)

A project starter that makes a new repo **ready for AI coding agents** — structure and contracts only, no stack
lock-in. Copy it, fill the placeholders, and every coding session starts with the right rules, the
right docs, a working issue tracker and one command that means "is this green?" — **whichever AI
tool and whichever framework you use.** You type only the task.

## The three problems it solves

**1. Every AI tool looks for a different file.** Rules written for one agent are invisible to the
next. Here `AGENTS.md` is canonical, and `npm run agents:sync` generates a pointer for every other
front door — so opening this repo in Cursor, Copilot, Gemini CLI, Windsurf, Cline, Junie or Aider
loads the same contract instead of nothing.

**2. "Run the tests" means something different in every framework.** Here it is always
`npm run gate`. What that expands to comes from a **70-entry framework registry** (55 frameworks, 15 language bases) that detects your stack and writes the real commands into `package.json`.

**3. Agents write slop that nobody asked for.** Narrative comments, filler copy, generic screens.
Here the rules live in `docs/anti-slop/`, and the ones a machine can check run first in every
`npm run gate`: a comment over three lines fails it, in any of 76 languages, and so does text in
`DESIGN.md` that misses WCAG AA contrast.

## What you get

| Piece | What it does |
|---|---|
| `AGENTS.md` | **Canonical rules, read by every agent.** Session working rules (docs-by-route, read-before-write, finish-100%, verify-before-claiming, no dead code, one-question rule, worktree isolation, completion report) + placeholders to fill per project. |
| Per-tool pointers | `CLAUDE.md` (`@AGENTS.md` import + Claude-only extras) plus **generated** stubs for Copilot · Gemini CLI · Cursor · Windsurf · Cline/Roo · Junie · Aider. Each restates the non-negotiables inline, so an agent that ignores file references is still bound by them. **Coexists with other tools that write to the same files:** a region fenced off between `<!-- name:start -->` / `<!-- name:end -->` or `<!-- BEGIN name -->` / `<!-- END name -->` markers (rules installers have their own) is carried across instead of overwritten — this repo owns the generated part of those files, not the whole file. |
| **Framework registry** | `scripts/stacks.json` — detection markers, gate commands, `.gitignore` lines, core-layer rule and conventions per framework. Adding one is **a JSON row, no code change**. Schema-validated by the test suite. |
| **`npm run gate`** | One command in every language: lint → typecheck → test → build, stopping at the first failure. Polyglot repos (Tauri, a Next.js + FastAPI monorepo) run both sides. The first `stack:apply` in a renamed project swaps agentready's own gates for your framework's; after that they are yours. |
| `docs/STACK.md` | **Generated** per project: which framework was detected, where heavy logic belongs, the exact gate commands, framework conventions. The brief a fresh agent reads instead of guessing. |
| `docs/` skeletons | `PRD` · `ARCHITECTURE` · `FEATURES` · `TASKS` · `ROADMAP` · `VERSIONING` — thin frames, not content. |
| **Archive contract** | `docs/archive/STATUS_ARCHIVE.md` + `TASKS_ARCHIVE.md`: when work merges, its full story moves here and `AGENTS.md` keeps ≤ 1 bullet per domain — the always-loaded context never bloats. |
| **Read guard** | `scripts/read-guard.mjs`, a Claude Code hook that denies reading a whole file over 400 lines without an offset/limit window, and says how to read the part you need instead. Whole files read to find one function are the largest single entries in a long session's context, and nothing takes them back out. |
| **Anti-slop** | Rules for code, UI, copy and reports in `docs/anti-slop/`, enforced wherever a machine can check them: `npm run gate` runs a comment check first, in every language the registry knows, and in Claude Code `slop-guard` names a long comment right after the edit. |
| **`DESIGN.md`** | **The visual identity agents build UI from**, in the open DESIGN.md format: tokens (colours, type, spacing, radii, components) in the front matter, how to use them in eight fixed sections. It ships as a frame with every token group marked `omitted`, so the look is decided there before the first screen. `npm run gate` checks its format and the WCAG AA contrast of every component's text, unrounded, with the 3:1 limit only for text that is actually large; `npm run design:lint` runs the format's own linter. |
| **GitHub Issues and Projects** | Cross-session issues live in GitHub; the linked Project tracks Status and Priority. Authenticated `gh` connects each machine without a local issue database. [Workflow](docs/ISSUES.md). |
| **Shared worktrees** | `.worktrees/<task-id>/` can be opened with Claude or Codex. The manager links GitHub issues, transfers agent ownership and context, and removes only clean inactive worktrees. [Workflow](docs/WORKTREES.md). |
| **Auto-versioning** | A conventional-commit hook bumps semver in `package.json` and syncs **every other manifest that exists** — inside the same commit. |
| **No agent attribution** | Three layers, because one bad commit is permanent — it puts a bot in your GitHub contributor list, removable only by rewriting published history. `.claude/settings.json` stops Claude Code adding `Co-Authored-By`, a "Generated with" line or a session link, and arms the hooks at session start; `.githooks/commit-msg` strips them whatever tool wrote them — Cursor, Copilot, or one that does not exist yet; and `.github/workflows/attribution.yml` fails the build if any commit carries them anyway, which is the layer that covers a fresh clone where no hook is installed yet. The rule is **one author per commit**: every `Co-Authored-By` line goes, not only an agent's, because separating the two was tried by name (which deleted a real person whose address contained "amp") and by bot address (a list that must grow with every new agent, where one miss is permanent). Credit collaborators in the commit body. If one lands anyway, rewriting history removes the commit but not GitHub's cached contributor list; renaming the default branch away and back makes GitHub rebuild it. |
| `scripts/setup.mjs` | One-shot, idempotent, ordered bootstrap (order matters — see below). |

## Framework support

`npm run stack:detect` reads the markers in your repo; `npm run stack:apply` writes the answer into
`package.json` → `tooling.gates`, the `.gitignore` managed block and `docs/STACK.md`.

| Group | Entries |
|---|---|
| **Desktop** | Electron · Tauri · Wails · .NET MAUI · Avalonia |
| **JS frontend** | Next.js · Nuxt · React+Vite · Angular · Vue · SvelteKit · Astro · Remix/RR7 · SolidStart |
| **JS backend** | Express · NestJS · Fastify · Hono · AdonisJS · Elysia |
| **Mobile** | Expo · React Native (bare) · Flutter · Ionic/Capacitor · Android |
| **PHP** | Laravel · Symfony · CodeIgniter 4 · Slim · WordPress |
| **Python** | Django · FastAPI · Flask · Streamlit |
| **Go** | Gin · Echo · Fiber · chi |
| **Rust** | Axum · Actix · Rocket · Leptos |
| **JVM / .NET** | Spring Boot · Ktor · Quarkus · ASP.NET Core · Blazor |
| **Other** | Rails · Sinatra · Phoenix · Unity · Godot · Terraform · Helm · Docker Compose |
| **Language bases** | Node · Deno · Bun · Python · PHP · Go · Rust · Maven · Gradle · .NET · Ruby · Elixir · Dart · Swift · C/C++ |

Frameworks inherit their language base through `extends`, so Laravel gets PHP's rules plus its own,
and Tauri composes Rust **and** Node.

**On honesty:** all 70 entries are verified — most of them against a project the framework's own
creator produced, on GitHub's runners (`.github/workflows/verify-stacks.yml`). Anything that is
not gets marked `"verified": false`, and its generated `docs/STACK.md` carries a visible "verify
these commands before trusting them" banner. A wrong command an agent believes is worse than one
it is told to check. That count is asserted by the test suite, so this paragraph cannot quietly
go stale.

**Adding your framework** — one entry in `scripts/stacks.json`, then `npm run stack:validate`:

```jsonc
{ "id": "my-framework", "tier": "framework", "extends": "node", "verified": true,
  "detect": { "any": [{ "file": "myfw.config.*" }, { "dep": "my-framework" }] },
  "gates": { "test": "myfw test", "build": "myfw build" },
  "ignore": [".myfw/"],
  "coreLayer": "where heavy logic belongs in this framework",
  "conventions": ["the rule an agent would otherwise get wrong"] }
```

**If your framework is built on another one, give it more signals than that one has.** Ties break
alphabetically, and this has bitten three times: Wails vendors `labstack/echo` and was detected as
Echo; an Ionic Angular app was detected as Angular; the official Leptos starter was detected as
Axum. Each was fixed by adding the marker that is definitive for the specific framework —
`wails.json`, `@capacitor/core`, `[package.metadata.leptos]`. The underlying framework then stays
on as a *secondary*, so its real gate commands still run.

## Language / version-manifest support

`package.json` is the version source of truth (it exists in every copy as the *tooling* manifest,
whatever the app language). `scripts/version.mjs` propagates it to every manifest present:

| Stack | Synced target |
|---|---|
| JS/TS · Deno · Expo | `package.json` (source of truth) · `deno.json` · `app.json` (only when it is an Expo manifest) |
| Rust · Tauri | `Cargo.toml` + `Cargo.lock` — at the **repo root and/or `src-tauri/`** · `src-tauri/tauri.conf.json` |
| PHP | `composer.json` (only when it declares `"version"` — Packagist omits it, and that is respected) |
| Python | `pyproject.toml` (`[project]` or `[tool.poetry]`; skipped when `dynamic`) |
| Dart / Flutter | `pubspec.yaml` (the `+build` number is preserved, never auto-incremented) |
| Java / Kotlin | `pom.xml` (the project's own `<version>`, never `<parent>`'s or a dependency's) · `gradle.properties` · `versionName` in `build.gradle(.kts)` |
| .NET | `*.csproj`, `src/*/*.csproj`, `Directory.Build.props` (`<Version>` / `<VersionPrefix>`) |
| Elixir · Ruby · Helm | `mix.exs` · `*.gemspec` and `lib/**/version.rb` · `Chart.yaml` (`version` **and** `appVersion`) |
| WordPress | the `Version:` header of a plugin/theme file that actually declares one |
| Go / anything else | a root `VERSION` file (`go:embed` / `-ldflags`) |

Deliberately **not** touched, because they are release counters rather than semver: Android
`versionCode`, the Flutter build number, Xcode `MARKETING_VERSION`, Expo `runtimeVersion`.

## Quick start

```bash
# 1. a new project with a history of its own, named after its directory (nothing links back here)
npx @ahnafudin/agentready init my-app
cd my-app

# 2. bootstrap (safe to re-run any time)
npm install          # activates the version hook via postinstall
npm run setup        # hooks → framework detection → agent docs → GitHub Project

# 3. check what it detected, then fill the <!-- TODO:fill --> sections
cat docs/STACK.md    # framework, core layer, gate commands
npm run gate         # should already run something sensible
```

Then open any AI coding tool and type your task — the rules ride along automatically.

Without npm, clone it (`git clone --depth 1 https://github.com/ahnafudin/agentready.git my-app`),
replace its `.git` with a fresh `git init`, and set `name` in `package.json` before step 2: while it
is `my-project`, the scripts treat the copy as agentready itself.

## Take it in parts

**Into a repo you already have** — `npx @ahnafudin/agentready add` copies only what is missing.
Every file you already have is kept and listed, and npm scripts are added without replacing any.

**Only the hooks, in Claude Code** — the read guard, the slop guard and `/agentready:anti-slop`,
in any project, without copying anything:

```text
/plugin marketplace add ahnafudin/agentready
/plugin install agentready@agentready
```

**Only the comment check, in any repository's CI** — one annotation per long comment on the pull
request. `paths` is optional; without it every tracked file is checked:

```yaml
- uses: actions/checkout@v7
- uses: ahnafudin/agentready/slop@main   # pin a release tag for a stable check
```

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | One-shot bootstrap. Idempotent; safe to re-run on any machine. |
| **`npm run gate`** | **The one command that means "is this green?"** — slop → design → version-sync → lint → typecheck → test → build, stopping at the first failure. |
| `npm run slop` | The comment check alone (`tooling.slop` in `package.json` sets the limit and ignored paths). |
| `npm run design` | The `DESIGN.md` check alone: format, token references and text contrast. |
| `npm run design:lint` | The DESIGN.md format's official linter, fetched with npx (not part of the gate). |
| `npm run gate test` | A single stage. |
| `npm run gate version-sync` | Compare optional npm v2/v3 lockfile project versions with `package.json`. |
| `npm run gate:list` | What `gate` would run, without running it. |
| `npm run stack:detect` | Which framework matched, its bases, and the full ranking. |
| `npm run stack:list` | All 70 registry entries. |
| `npm run stack:apply` | Refresh `docs/STACK.md`, `tooling.gates` and the `.gitignore` block. |
| `npm run stack:reapply` | Same, but overwrite hand-tuned gates from the registry. |
| `npm run stack:validate` | Check `scripts/stacks.json` against its schema. |
| `npm run issues:setup` | Discover or create the repository's linked GitHub Project and save machine-local configuration. |
| `npm run agents:sync` | Regenerate the per-tool pointer files from `AGENTS.md`. |
| `npm run agents:check` | Are they stale? (part of `gate`) |
| `npm run wt:create -- <task-id> --agent codex` | Create an isolated task worktree and link its existing GitHub issue. |
| `npm run wt:open -- <task-id>` | Open its selected Claude or Codex CLI. |
| `npm run wt:handoff -- <task-id> --to claude --note "context"` | Transfer the task and record context for the next agent. |
| `npm run wt:list` | List managed worktrees, selected agents and active sessions. |
| `npm run wt:remove -- <task-id>` | Remove a clean inactive worktree, retaining its branch and issue status. |
| `npm run version:get` · `:patch` · `:minor` · `:major` · `:sync` | Manual version control. |

> **Why `gate:list` and `stack:reapply` are separate scripts:** `npm run gate --list` does **NOT**
> work — npm swallows a leading flag instead of forwarding it, so you would get a full gate run
> instead of a listing. A bare argument (`npm run gate test`) does pass through. Rather than expect
> every agent to remember `npm run gate -- --list`, the flag-taking forms get their own script — and
> a test fails the build if any doc reintroduces the broken form.

## Why the setup order matters

`scripts/setup.mjs` runs **git hooks → personalise → stack detection → agent docs → GitHub Project**.
Personalising precedes stack detection because it consumes the pristine-copy settings first.
The GitHub connection follows the repository's origin and stores Project IDs outside tracked
files. Without a GitHub origin, setup prints the connection command for later. With an origin,
authenticate `gh` first; connection failures leave local tooling installed and return an error.
Setup never commits or pushes.

## What happens to a copy of agentready

The first `npm run setup` in a **renamed** project personalises it, once:

| Scaffolding | Becomes |
|---|---|
| version `0.2.x` (agentready's release history) | `0.1.0` |
| this README | a README about your project; this one is kept as `docs/TOOLING.md` |
| `tooling.gates` (commands that maintain agentready) | your framework's gates, from the registry |
| the `test` npm script (the tooling's own suite) | free for your project; the suite stays at `test:tooling` |
| no tracker identity | connects to YOUR GitHub origin and linked Project |
| agentready's MIT `LICENSE` | kept as `docs/TOOLING-LICENSE` beside the tooling it covers; the root is yours to license |
| `CONTRIBUTING.md` (how to contribute to agentready) | removed |
| what serves agentready's own repository: code of conduct, security policy, issue and PR templates, README assets, the `verify-stacks` and `release` workflows | removed |

All of it is keyed off `tooling.pristine` and happens exactly once. Nothing you have written is
ever replaced. `scripts/tests/derived-project.test.mjs` builds a copy, renames it, bootstraps it and
runs this whole suite inside it — every one of those rows is a bug agentready shipped until a
real generated app exposed it.

## Two machines?

See `SETUP.md` → "Second machine" for the exact checklist (what git carries for you, what is
per-machine, and how to connect to the same GitHub Project).

## Layout

```
AGENTS.md              CANONICAL rules — edit here, then `npm run agents:sync`
CLAUDE.md              @AGENTS.md import + Claude-Code-only extras
DESIGN.md              visual identity: design tokens + how to use them (open DESIGN.md format)
GEMINI.md  CONVENTIONS.md  .cursor/  .windsurf/  .clinerules/  .junie/  .github/copilot-instructions.md
                       generated pointers — do not hand-edit
.aider.conf.yml        makes Aider read CONVENTIONS.md, which it loads only when told to
SETUP.md               fill-in checklist · second-machine checklist
CONTRIBUTING.md  LICENSE  how to contribute · MIT (both leave a project made from agentready)
CODE_OF_CONDUCT.md  SECURITY.md  community rules · private vulnerability reports (agentready only)
docs/
  STACK.md             GENERATED per project: framework, core layer, gate commands
  VERIFYING.md         how an entry earns `verified`, and what that has caught
  TOOLING.md           this README, once a project has been made from agentready
  TOOLING-LICENSE      agentready's licence, likewise
  anti-slop/           rules against AI slop: code · ui · copy · human
  PRD.md  ARCHITECTURE.md  FEATURES.md  TASKS.md  ROADMAP.md  VERSIONING.md
  archive/             STATUS_ARCHIVE.md · TASKS_ARCHIVE.md  (the anti-bloat contract)
scripts/
  stacks.json          the framework registry (DATA — add frameworks here)
  stacks.schema.json   its schema, enforced by the test suite
  comments.json        comment syntax per language (DATA — add languages here), with sources
  comments.schema.json its schema, enforced before every comment check
  stacks.mjs           detect → package.json / .gitignore / docs/STACK.md
  gate.mjs             `npm run gate`
  version.mjs          semver source of truth + every manifest it syncs
  check-version-sync.mjs  optional npm lockfile project versions, built into the gate
  sync-agents.mjs      AGENTS.md → per-tool pointer files
  personalize.mjs      personalise a fresh copy (version → 0.1.0, project README, licence)
  verify-stack.mjs     detect + run the gates of a scaffolded project
  check-attribution.mjs  the commit-msg rule, applied to history in CI
  setup.mjs  install-hooks.mjs  github-setup.mjs
  read-guard.mjs       denies an unbounded Read of a long file (Claude Code hook)
  slop-check.mjs       `npm run slop`: the comment check the gate runs first
  design-check.mjs     `npm run design`: DESIGN.md format and text contrast, the gate's second check
  slop-guard.mjs       the same check right after each edit (Claude Code hook)
  lib/                 shared utils (git, globs, managed blocks, JSON-Schema subset)
  tests/               `node --test` via run.mjs, zero dependencies
.claude/settings.json  Claude Code hooks + no-attribution settings
.githooks/
  post-commit          conventional-commit auto-version
  commit-msg           strips AI-agent attribution, whichever tool wrote it
.github/workflows/
  attribution.yml      fails the build if any commit carries AI-agent attribution
  gate.yml             the same `npm run gate`, on Linux, Windows and macOS
  verify-stacks.yml    scaffolds real projects and verifies registry entries (agentready only)
  release.yml          tags and releases every version main reaches, then the npm CLI (agentready only)
  slop-action.yml      runs the slop Action against this repository (agentready only)
.github/ISSUE_TEMPLATE/  pull_request_template.md  assets/   (agentready only)
.claude-plugin/        this repository as a Claude Code plugin and marketplace (agentready only)
slop/                  the comment check as a GitHub Action (agentready only)
packages/agentready/   the npm CLI: `init` and `add` (agentready only)
```

## Contributing

Fork, branch, `npm run gate`, pull request. The full guide — and the invariants the test suite
protects — is [CONTRIBUTING.md](https://github.com/ahnafudin/agentready/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/ahnafudin/agentready/blob/main/LICENSE) © 2026 ahnafudin. A project
made from agentready keeps that notice in `docs/TOOLING-LICENSE`, beside the tooling it
covers, and chooses its own licence.
