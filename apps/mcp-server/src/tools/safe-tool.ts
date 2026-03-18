/**
 * Shared error-handling wrapper for all MCP tool handlers.
 *
 * Catches any thrown error and returns it as an MCP error response
 * (isError: true) so the server stays alive instead of crashing.
 */

export type ToolContent = { type: 'text'; text: string };
export type ToolResult = { content: ToolContent[]; isError?: true };

export async function safeTool(fn: () => Promise<ToolResult>): Promise<ToolResult> {
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
