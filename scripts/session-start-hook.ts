// Plugin SessionStart hook. No-op unless MM_SESSION_ID is set (R5); node:sqlite is only loaded when it is.
if (process.env.MM_SESSION_ID) {
  const { runSessionStartHook } = await import('../src/hooks/session-start.ts');
  const output = runSessionStartHook(process.env);
  if (output !== null) process.stdout.write(JSON.stringify(output));
}
