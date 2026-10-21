import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realDeps } from '../launch/runner.ts';
import { realMonitorDeps, startMonitor } from '../monitor/monitor.ts';
import { openRoster } from './db.ts';
import { identityFromEnv, registerRosterTools, type ToolContext } from './tools.ts';

const pluginRoot = resolve(import.meta.dirname, '..', '..');
const db = openRoster();
const server = new McpServer({ name: 'multi-manager-roster', version: '0.1.0' });
const ctx: ToolContext = {
  db,
  identity: identityFromEnv(process.env),
  pluginRoot,
  launch: { db, deps: realDeps(), pluginRoot, env: process.env },
};
registerRosterTools(server, ctx);
// The monitor only acts in the front desk's server: its passes are no-ops until start_front_desk makes this
// session the front desk, and a lease keeps a second front-desk server from acting at the same time.
startMonitor(db, { ...realMonitorDeps(), active: () => ctx.identity.role === 'front-desk' });
await server.connect(new StdioServerTransport());
