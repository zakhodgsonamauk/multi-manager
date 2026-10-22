@echo off
rem Double-click to open a Multi-Manager front desk. A pop-up (front-desk-picker.ps1) asks which team: your
rem main team (the shared roster on this PC, opened in this folder, as before) or a cluster folder (browse or
rem paste; a separate team with its own roster in <folder>\.multi-manager\roster.db). It also asks whether the
rem front desk should be reachable from your phone (Remote Control), then opens it in its own Windows Terminal
rem window. No command line needed; the old "front-desk.bat remote" is now the pop-up's phone checkbox.
rem
rem The front desk tab itself clears any inherited Claude Code variables, sets CLAUDE_CODE_NO_FLICKER=1 (so
rem the pane docks beside the chat) and skips permission prompts, like the architects it launches.

setlocal
set "REPO=%~dp0"
rem Drop the trailing backslash: "C:\path\" would escape the closing quote.
set "REPO=%REPO:~0,-1%"
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%REPO%\front-desk-picker.ps1" -PluginDir "%REPO%"
endlocal
