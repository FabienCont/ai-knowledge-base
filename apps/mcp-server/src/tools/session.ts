import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSessionStore } from '@aikb/session-memory';

// ---------------------------------------------------------------------------
// Error wrapper — catches thrown errors and returns isError: true responses
// ---------------------------------------------------------------------------

type ToolContent = { type: 'text'; text: string };
type ToolResult = { content: ToolContent[]; isError?: true };

async function safeTool(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSessionTools(server: McpServer): void {
  // ─────────────────────────────────────────────────────────────────────────
  // session_memory_add
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'session_memory_add',
    'Add a memory entry to a session',
    {
      session_id: z.string().describe('Session ID to add the entry to'),
      role: z
        .enum(['user', 'assistant', 'system', 'tool'])
        .describe('Role of the entry'),
      content: z.string().describe('Content of the memory entry'),
    },
    async ({ session_id, role, content }) =>
      safeTool(async () => {
        const store = await createSessionStore();
        const entry = await store.add(session_id, {
          role,
          content,
          timestamp: new Date().toISOString(),
        });
        return { content: [{ type: 'text', text: JSON.stringify(entry) }] };
      }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // session_memory_get
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'session_memory_get',
    'Get all entries for a session',
    {
      session_id: z.string().describe('Session ID to retrieve'),
    },
    async ({ session_id }) =>
      safeTool(async () => {
        const store = await createSessionStore();
        const result = await store.get(session_id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // session_memory_list
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'session_memory_list',
    'List all sessions',
    {
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe('Maximum number of sessions to return'),
    },
    async ({ limit }) =>
      safeTool(async () => {
        const store = await createSessionStore();
        const sessions = await store.list();
        const limited = limit !== undefined ? sessions.slice(0, limit) : sessions;
        return { content: [{ type: 'text', text: JSON.stringify(limited) }] };
      }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // session_memory_search
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'session_memory_search',
    'Search across all sessions for a text pattern',
    {
      pattern: z.string().describe('Substring or regex pattern to search for'),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Maximum results to return'),
    },
    async ({ pattern, limit }) =>
      safeTool(async () => {
        const store = await createSessionStore();
        const results = await store.search({
          pattern,
          ...(limit !== undefined ? { limit } : {}),
        });
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      }),
  );
}
