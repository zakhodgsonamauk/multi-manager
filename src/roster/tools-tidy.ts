import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { setProjectArchived, setWorkstreamArchived } from './projects.ts';
import { me, type ToolContext } from './tools.ts';

/**
 * Tidying the front desk's view: hide a workstream or a project the user no longer needs. Hidden ones drop out
 * of `status` and the pane but stay in list_projects / list_workstreams (flagged by archived_at); nothing is
 * deleted, and archived: false shows them again.
 */

async function guard(fn: () => unknown): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

/** Only the front desk tidies its own view: a developer or architect must not hide things from the user. */
function frontDeskOnly(ctx: ToolContext): void {
  if (me(ctx).role !== 'front-desk') throw new Error('Only the front desk can hide or show projects and workstreams');
}

export function registerTidyTools(server: McpServer, ctx: ToolContext): void {
  const { db } = ctx;

  server.registerTool(
    'archive_workstream',
    {
      description:
        'Hide a workstream from the status and the pane (archived: true), or show it again (false). Refused while its architect is running: stop it first. Nothing is deleted.',
      inputSchema: { project: z.string(), workstream: z.string(), archived: z.boolean() },
    },
    (a) =>
      guard(() => {
        frontDeskOnly(ctx);
        return setWorkstreamArchived(db, a.project, a.workstream, a.archived);
      }),
  );

  server.registerTool(
    'archive_project',
    {
      description:
        'Hide a project from the status and the pane (archived: true), or show it again (false). Refused while any of its architects is running: stop them first. Nothing is deleted.',
      inputSchema: { project: z.string(), archived: z.boolean() },
    },
    (a) =>
      guard(() => {
        frontDeskOnly(ctx);
        return setProjectArchived(db, a.project, a.archived);
      }),
  );
}
