@echo off
rem Project check: type check, lint, tests (R7).
cd /d "%~dp0.."
call npm run check
exit /b %ERRORLEVEL%
