# Tracker migration — 2026-10-30

GitHub Issues and the private [agentready development Project](https://github.com/users/ahnafudin/projects/5)
replace Beads as the canonical tracker. Active workflow: [../ISSUES.md](../ISSUES.md).

The complete local export contained 12 issues: 9 open (including one deferred) and 3 closed.
Verification read back all issue bodies, titles and states, 4 imported comments, 7 typed
`discovered-from` links, and Project membership, Status, Priority, Legacy ID, Legacy Status and
the deferred date. Original authors and timestamps remain explicit historical metadata because
GitHub records the importing account and import time for native events.

| Original ID | GitHub issue | Original state |
|---|---|---|
| `vibe-template-3oa` | [#15](https://github.com/ahnafudin/agentready/issues/15) | closed |
| `vibe-template-n2s` | [#16](https://github.com/ahnafudin/agentready/issues/16) | open |
| `vibe-template-ccq` | [#17](https://github.com/ahnafudin/agentready/issues/17) | open |
| `vibe-template-dnp` | [#18](https://github.com/ahnafudin/agentready/issues/18) | open |
| `vibe-template-fzk` | [#19](https://github.com/ahnafudin/agentready/issues/19) | open |
| `vibe-template-9rl` | [#20](https://github.com/ahnafudin/agentready/issues/20) | closed |
| `vibe-template-plq` | [#21](https://github.com/ahnafudin/agentready/issues/21) | open |
| `vibe-template-x05` | [#22](https://github.com/ahnafudin/agentready/issues/22) | deferred |
| `vibe-template-ay7` | [#23](https://github.com/ahnafudin/agentready/issues/23) | open |
| `vibe-template-aeo` | [#24](https://github.com/ahnafudin/agentready/issues/24) | open |
| `vibe-template-ilf` | [#25](https://github.com/ahnafudin/agentready/issues/25) | open |
| `vibe-template-l63` | [#26](https://github.com/ahnafudin/agentready/issues/26) | closed |

The remote `refs/dolt/data` snapshot at `7f32a3292ac286442c53731e612033980f423200` was cloned
into an isolated temporary database and exported independently. All 10 remote issues are
included in the local 12; no infrastructure records or memories were present. The remote's older
deferred states for `fzk` and `ilf` were superseded by local open states. The original remote
export and comparison report preserve those historical differences.

Recovery copies live outside the repository at
`%LOCALAPPDATA%/agentready/migrations/2026-10-30-github/`: the full database directory, full JSONL
export, remote Git bundle, remote export, ID mapping, verification report and initial working
tree/index patches. Original owner email values remain in this private local export rather than
public issue bodies. These copies are archival evidence, not an active tracker.

After verification, the workspace was retired outside the repository, native `.githooks` was
restored, tracker-specific Git configuration and local forwarding scripts were removed, and the
remote `refs/dolt/data` ref was deleted. Existing repository commits were not rewritten.

Final verification: `npm run gate` passed slop, design, lint and test with 381 tests and zero
failures. A live GitHub cycle created the migration issue worktree, transferred ownership
Codex → Claude → Codex using the checkout identity, removed the clean workspace and confirmed
an empty managed registry. The migration is recorded in [#27](https://github.com/ahnafudin/agentready/issues/27).
