import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realDeps } from '../launch/runner.ts';
import { realActivityReaders } from '../monitor/activity.ts';
import { realMonitorDeps, startMonitor } from '../monitor/monitor.ts';
import { openRoster } from './db.ts';
import { createFrontDeskProbe } from './identity.ts';
import { currentIdentity, identityFromEnv, registerRosterTools, type ToolContext } from './tools.ts';

const pluginRoot = resolve(import.meta.dirname, '..', '..');
const db = openRoster();
const server = new McpServer({ name: 'multi-manager-roster', version: '0.1.0' });
const readers = realActivityReaders();
const ctx: ToolContext = {
  db,
  identity: identityFromEnv(process.env),
  pluginRoot,
  launch: { db, deps: realDeps(), pluginRoot, env: process.env },
  // A restarted server with no environment identity recognises the front desk by its own Claude Code process.
  probe: createFrontDeskProbe({ db, env: process.env, parentPid: () => process.ppid, readSessionFile: readers.readSessionFile }),
};
currentIdentity(ctx);
registerRosterTools(server, ctx);
// The monitor only acts in the front desk's server: its passes are no-ops until the front desk is recognised or
// start_front_desk makes this session the front desk, and a lease keeps a second front-desk server from acting at the same time.
startMonitor(db, { ...realMonitorDeps(), active: () => currentIdentity(ctx, { throttled: true }).role === 'front-desk' });
await server.connect(new StdioServerTransport());
