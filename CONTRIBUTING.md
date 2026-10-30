<!-- tooling:contributing -->
# Contributing to agentready

Thank you for helping. People start their own projects from a copy of this repository, and
improvements come back here through a fork and a pull request.

## Before you start

- **A small fix** — a typo, a wrong command, a detection marker: open a pull request directly.
- **Anything larger** — a new script, a change to a rule in `AGENTS.md`, a new hook: open an issue
  first, so we agree on the shape before you spend the time.
- **A new framework** is one entry in `scripts/stacks.json` (see "Adding your framework" in the
  README). Say in the pull request how you verified its commands; `docs/VERIFYING.md` explains how
  an entry earns `"verified": true`.
- **A new language for the comment check** is one entry in `scripts/comments.json`. Link the
  language's official comment syntax in `source`, and list any prefix that looks like a comment but
  is code (an attribute, a pragma, a hint) under `code`.

## Workflow

1. Fork the repository and create a branch from `main`.
2. `npm install` — this also installs the git hooks (auto-version and the attribution filter).
3. Make the change. The rules agents follow here live in `AGENTS.md`: edit them there, never in a
   generated pointer file, then run `npm run agents:sync`.
4. `npm run gate` must be green. Paste its summary into the pull request.
5. Open the pull request against `main`. CI runs the same gate on Linux (Node 22, 24 and 26), Windows
   and macOS.

## Commits

- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:` …). The post-commit hook bumps the
  version from that prefix, so never edit the version by hand.
- **One author per commit.** No `Co-Authored-By` line, no "Generated with …" line, no session
  link — CI fails the pull request if one lands. Credit collaborators in the commit body.

## What the tests protect

`npm run gate` validates the registry against its schema, checks that the generated pointer files
are in sync, and runs the whole suite (`node --test`, zero dependencies): every version-manifest
planner, every detection rule, the commit-msg hook, the documented commands themselves, and a
simulated project built from agentready.

The invariants those tests protect, which are easy to break by accident:

- a bump must never touch a Cargo **dependency** version, a Maven `<parent>` or dependency version,
  an Android `versionCode`, or a Flutter build number;
- `writeAll` must validate **every** manifest before writing **any** of them;
- `react-vite` must not claim every React-based framework (that is what `detect.all` is for);
- a polyglot repo must report **both** stacks, not just the loudest one;
- every pointer file must restate the non-negotiables inline, not merely link to `AGENTS.md`;
- no doc may print an `npm run <script> --flag` form that npm will swallow;
- nothing that belongs to agentready may survive into a project made from it — the simulated
  project is the test for that.

Two more rules without a test of their own:

- **Keep the tooling dependency-free.** Node's standard library only, so a copy works anywhere Node
  22+ does.
- **Keep other people's product names out of the source.** Naming them reads as an endorsement or a
  comparison. References needed for supported integrations belong in their workflow documentation.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
