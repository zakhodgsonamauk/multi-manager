# 030 return: one plugin copy

## What changed
- New `src/launch/plugin-copy.ts`: reads the canonical plugin folder (env `MM_CANONICAL_PLUGIN_DIR`, else first line of `~\.claude\multi-manager\canonical-plugin-dir`) and builds the one-line warning. No path is hard-coded in code.
- `src/launch/front-desk-launch.ts` and `scripts/front-desk-launch.ts`: launcher prints the warning once to stderr when `--plugin-dir` is not canonical.
- `src/roster/server.ts`: same warning once at roster server start, on stderr.
- Outside the repo: the setting file above now holds `C:\dev\multi-manager`.

## Launchers found (before any change)
| Launcher | Before | After |
|---|---|---|
| Desktop `Multi-Manager Front Desk.lnk` | `I:\Dropbox (Personal)\Projects\multi-manager\front-desk.bat` | `C:\dev\multi-manager\front-desk.bat` |
| Desktop `Multi-Manager Front Desk (phone).lnk` | same, arg `remote` | `C:\dev\multi-manager\front-desk.bat`, arg `remote` kept |
Backups: `<name>.lnk.bak-030` beside each on the Desktop.
- Windows Terminal settings + fragment: no plugin path in them (profile is plain `cmd.exe`), nothing to change. `terminal-profile.ts` writes no plugin folder, so no change and no "canonical path" test applies.
- `front-desk.bat` / `front-desk-picker.ps1`: use their own folder (`%~dp0`), so they follow whichever copy is launched. No change.
- Start menu shortcuts, scheduled tasks: none found mentioning multi-manager/front-desk.

## Roster locations
- Main team: `C:\Users\zak_h\.claude\multi-manager\roster.db` (home folder, not a plugin copy).
- Clusters: `<cluster folder>\.multi-manager\roster.db`. Switching copies orphans nothing.
- Found inside the Dropbox plugin copy: `scratch-ignored\e2e-cluster\.multi-manager\roster.db`, a throwaway test cluster (git-ignored). Not moved. Decide separately.

## Tests
`node --test test/front-desk-launch.test.ts test/terminal-profile.test.ts test/server.test.ts test/plugin-copy.test.ts`
```
ℹ tests 34
ℹ pass 34
ℹ fail 0
```
`npm run typecheck`: clean (no output after tsc line).
`npm run lint`: 22 errors, all in `docs/multi-manager/usage-efficiency/measure/analyze.js` and `extract.js` (already failing at session start, not mine). My changed files: `eslint` clean.
New tests: `test/plugin-copy.test.ts` (warning vs none, env/file lookup) and a runner test in `test/front-desk-launch.test.ts` (non-canonical warns once, canonical silent).

## Decisions
- 2026-11-24: canonical folder stored in a text file beside the roster, env override for tests/other PCs. No file recorded = no warning.
- Server warning is not covered by a test (stderr of a spawned server); logic is covered via the shared function.

## Gaps
- No running session was restarted. Sessions on the Dropbox copy keep running it until their next start; they will then see the warning only if started from Dropbox.
- Not screenshot-tested (no UI change).
