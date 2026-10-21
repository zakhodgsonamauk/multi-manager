@echo off
rem Opens the Multi-Manager front desk in its own Windows Terminal window.
rem Uses the plugin straight from this folder and skips permission prompts, so cross-session
rem messages to and from architects (which run the same way) are not held for approval.
rem
rem   front-desk.bat          normal
rem   front-desk.bat remote   also reachable from the Claude app on your phone (Remote Control)

setlocal
set "REPO=%~dp0"
set "REPO=%REPO:~0,-1%"

set "REMOTE="
if /i "%~1"=="remote" set "REMOTE=--remote-control mm-front-desk"

rem If started from inside another Claude Code session, drop its variables: a session that inherits
rem them counts as a child and never registers for cross-session messaging.
for %%V in (CLAUDECODE CLAUDE_PID CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_MESSAGING_SOCKET CLAUDE_CODE_MESSAGING_TOKEN CLAUDE_CODE_SESSION_ATTENDED CLAUDE_CODE_SESSION_ID) do set "%%V="

start "" wt.exe -w new new-tab --title mm-front-desk -d "%REPO%" claude -n mm-front-desk %REMOTE% --plugin-dir "%REPO%" --dangerously-skip-permissions "/multi-manager:front-desk"
endlocal
