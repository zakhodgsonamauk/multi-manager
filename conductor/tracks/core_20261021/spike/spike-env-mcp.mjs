// Spike MCP server (stdio, no dependencies): proves MM_* env reaches MCP servers.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const seen = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('MM_')));
writeFileSync(join(import.meta.dirname, 'spike-mcp-env.json'), JSON.stringify(seen, null, 2));

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'spike-env', version: '0.0.1' } } });
  } else if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'show_env', description: 'Return the MM_* variables this MCP server process sees', inputSchema: { type: 'object', properties: {} } }] } });
  } else if (message.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(seen) }] } });
  } else {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
  }
});
