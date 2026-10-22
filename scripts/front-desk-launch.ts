import { spawn } from 'node:child_process';
import { runFrontDeskLaunch } from '../src/launch/front-desk-launch.ts';
import { wtPath } from '../src/launch/launcher.ts';

// Called by front-desk-picker.ps1: (--folder <cluster folder> | --main) --plugin-dir <plugin folder> [--remote]
// Opens the front desk in a new Windows Terminal window. Exits non-zero with the reason on stderr if it cannot,
// so the picker can show it.
process.exitCode = await runFrontDeskLaunch(process.argv.slice(2), {
  spawn,
  env: process.env,
  wtPath: wtPath(process.env),
  error: (message) => console.error(message),
});
