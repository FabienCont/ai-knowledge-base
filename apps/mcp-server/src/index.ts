import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSessionTools } from './tools/session.js';
import { registerVectorTools } from './tools/vector.js';
import { registerGraphTools } from './tools/graph.js';
import { registerModelsTools } from './tools/models.js';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'aikb',
    version: '0.1.0',
  });

  // Register all tool groups
  registerSessionTools(server);
  registerVectorTools(server);
  registerGraphTools(server);
  registerModelsTools(server);

  // Start transport
  // AIKB_MCP_TRANSPORT: set to 'stdio' (default) for Claude Desktop / pipe-based
  // clients, or 'sse' for HTTP-based agents (requires AIKB_MCP_PORT, not yet
  // implemented).
  const transportType = process.env['AIKB_MCP_TRANSPORT'] ?? 'stdio';

  if (transportType === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[aikb-mcp] Running on stdio transport\n');
  } else if (transportType === 'sse') {
    const port = parseInt(process.env['AIKB_MCP_PORT'] ?? '3001', 10);
    // TODO: implement SSE transport via StreamableHTTPServerTransport (SDK ≥ 1.1)
    process.stderr.write(
      `[aikb-mcp] SSE transport requested on port ${port} — not yet implemented\n`,
    );
    process.exit(0);
  } else {
    process.stderr.write(
      `[aikb-mcp] Unknown transport: ${transportType}. Use 'stdio' or 'sse'.\n`,
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[aikb-mcp] Fatal: ${String(err)}\n`);
  process.exit(1);
});

