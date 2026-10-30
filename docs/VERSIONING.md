# Versioning

Semantic versioning (MAJOR.MINOR.PATCH). **`package.json` is the single source of truth** (it exists
in every copy of agentready as the tooling manifest, whatever the app language);
`scripts/version.mjs` propagates it to every optional manifest that exists in the repo.

Writes are targeted regex replacements — never a JSON/TOML reparse and reformat — so a bump touches
only the version string and produces a clean one-line diff. `writeAll` is **two-phase**: every
target is read and validated BEFORE any byte is written, so a validation failure can never leave the
manifests half-synced. There is a test for exactly that.

## Synced targets

Each is skipped silently when the file is absent, so one script serves every stack. Detection here
is by **file existence and content only** — `version.mjs` deliberately does not read the framework
registry (`scripts/stacks.json`), so versioning keeps working even if a stack entry is wrong.

| Stack | Target | Notes |
|---|---|---|
| JS/TS | `package.json` | the source of truth itself |
| npm | `package-lock.json` | v2/v3 root `version` and `packages[""].version` together; dependency pins and formatting stay unchanged |
| Deno | `deno.json`, `deno.jsonc` | skipped when it declares no `version` |
| Expo | `app.json` | **only** when the file contains an `"expo"` key — bare React Native uses `app.json` for the display name, and that must not be rewritten |
| Rust / Tauri | `Cargo.toml` + `Cargo.lock`, at the repo **root and/or `src-tauri/`**; `src-tauri/tauri.conf.json` | `[package]`-scoped, so a dependency's `version = "…"` is never touched; a workspace-inherited version is skipped |
| PHP | `composer.json` | only when it declares `"version"` — Packagist convention omits it, and that omission is respected, never "fixed" |
| Python | `pyproject.toml` | `[project]` (PEP 621) or `[tool.poetry]`; skipped when `dynamic = ["version"]` |
| Dart / Flutter | `pubspec.yaml` | the semver is rewritten, the `+build` number **preserved** — see below |
| Gradle / Android | `gradle.properties`, plus `versionName` in `build.gradle(.kts)`, `app/`, `android/app/` | `versionCode` is left alone — see below |
| .NET | `Directory.Build.props`, `*.csproj`, `src/*/*.csproj` | `<Version>`, falling back to `<VersionPrefix>`; never added when absent |
| Java (Maven) | `pom.xml` | the **project's own** `<version>` only: `<parent>` and every dependency are excluded, and a module that inherits its version is skipped |
| Elixir | `mix.exs` | the `version:` in `def project` |
| Ruby | `*.gemspec`, `lib/**/version.rb` | a `VERSION = "…"` constant, or a literal `.version =` in the gemspec; a gemspec that computes its version from the constant is left to the constant |
| Helm | `Chart.yaml` | both `version` (the chart) and `appVersion`, preserving quote style |
| WordPress | a root `*.php` or `style.css` | only a file that actually declares a `Plugin Name:` / `Theme Name:` header |
| Go / any | a root `VERSION` file | created by you once; read via `go:embed`, `-ldflags`, or at runtime |

Extend `TARGETS` in `scripts/version.mjs` for anything else, and add a planner test beside it.

## npm lockfile guard

`npm run gate` includes `version-sync` before framework gates, so regenerating `tooling.gates`
with `stack:apply` cannot remove the check. Run it alone with `npm run gate version-sync`.
The check reads manifests without changing them and fails if either supported lockfile project
version differs from `package.json`. Run `npm run version:sync` to repair drift, then review the
two version changes and commit the lockfile with the other manifests.

An absent lockfile is allowed: the template and non-npm projects need none. Legacy v1 lockfiles
are explicitly skipped by both the planner and guard; upgrade them with npm to opt into v2/v3
synchronization. The planner also skips malformed JSON, missing/non-string version fields, and
ambiguous duplicate keys without a partial rewrite. The guard rejects malformed or unsupported
existing lockfiles and v2/v3 files missing either project version; regenerate those with
`npm install` rather than relying on a version bump to repair their structure.

## Counters this does NOT touch (on purpose)

These rise per *release*, not per semver bump, and several must increase monotonically for a store
to accept an upload. A commit hook must never move them silently:

| Counter | Where | Raise it |
|---|---|---|
| `versionCode` | `build.gradle(.kts)` | manually, at release |
| build number (`+N`) | `pubspec.yaml` | manually, at release |
| `MARKETING_VERSION` / `CFBundleShortVersionString` | Xcode project / `Info.plist` | manually — plist rewriting is too fragile to automate here |
| `android.versionCode` / `ios.buildNumber` / `runtimeVersion` | Expo `app.json` | manually, or via EAS |

## Auto-bump on commit

`.githooks/post-commit` (activated by `npm run setup` / `npm install` → postinstall →
`hooks:install`, which sets `core.hooksPath`) reads the conventional-commit type of the commit that
just landed, bumps the manifests, and **folds the bump into that same commit with a guarded
`git commit --amend`**:

| Commit | Bump |
|---|---|
| `feat:` | MINOR |
| `fix:` / `perf:` / `refactor:` | PATCH |
| `type!:` or a `BREAKING CHANGE:` footer (colon required, conventional header required) | MAJOR |
| `docs:` `chore:` `test:` `ci:` `style:` `build:` / non-conventional | none |

> Why post-commit + amend? Git snapshots the index BEFORE `prepare-commit-msg` runs, so a bump
> staged there lands one commit late (shipping the previous version) and leaves a permanently dirty
> index that breaks the next rebase/cherry-pick — verified empirically. post-commit is the only hook
> that can put the bump in the same commit.

The hook asks `node scripts/version.mjs manifests` which files are in play rather than repeating the
list. That matters: with a hardcoded list, adding a stack to `version.mjs` without also editing the
shell script would leave the dirty-manifest guard silently checking the wrong files.

Built-in guards (all fail-soft):

- **Recursion:** the amend re-triggers post-commit; a `TOOLING_VERSION_AMEND` env guard stops it.
- **Sequences:** the hook skips entirely during rebase / merge / cherry-pick / revert / bisect —
  amending mid-sequence is the classic double-bump corruption.
- **Dirty manifests:** if a version manifest already has local edits, the hook skips (with a stderr
  note) instead of silently sweeping your changes into the commit — bump manually then.
- **No node / no script:** exits 0 without touching anything.

⚠️ The amend rewrites the just-created commit's SHA. That is safe locally (it happens immediately,
before any push), but never re-run history-rewriting tools between commit and push expecting the
pre-amend SHA.

## Manual control

```bash
npm run version:get
npm run version:patch   # or :minor / :major
node scripts/version.mjs set 1.2.3
npm run version:sync    # re-propagate package.json to every manifest
node scripts/version.mjs manifests   # which files a bump would touch, right now
node scripts/version.mjs infer "feat: x"   # what a commit message would do
```
