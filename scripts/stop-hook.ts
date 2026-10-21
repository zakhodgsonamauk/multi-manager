// Plugin Stop hook. No-op unless MM_SESSION_ID is set (R5); node:sqlite is only loaded when it is.
if (process.env.MM_SESSION_ID) {
  const { runStopHook } = await import('../src/hooks/stop.ts');
  const output = runStopHook(process.env);
  if (output !== null) process.stdout.write(JSON.stringify(output));
}
