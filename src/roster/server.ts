import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realDeps } from '../launch/runner.ts';
import { openRoster } from './db.ts';
import { identityFromEnv, registerRosterTools } from './tools.ts';

const pluginRoot = resolve(import.meta.dirname, '..', '..');
const db = openRoster();
const server = new McpServer({ name: 'multi-manager-roster', version: '0.1.0' });
registerRosterTools(server, {
  db,
  identity: identityFromEnv(process.env),
  pluginRoot,
  launch: { db, deps: realDeps(), pluginRoot, env: process.env },
});
await server.connect(new StdioServerTransport());
