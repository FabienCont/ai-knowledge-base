# ✅ Subplan K — MCP Server

## Overview

Implement an MCP (Model Context Protocol) server (`apps/mcp-server`) that exposes all knowledge base capabilities as structured tools consumable by AI agents. The server uses `@modelcontextprotocol/sdk`, defaults to stdio transport (for Claude Desktop and similar integrations), and optionally supports SSE/HTTP transport for web-based agents.

---

## Dependencies

- Subplan A (monorepo foundation)
- Subplan B (`@aikb/core-types`)
- Subplan C (`@aikb/core-config`)
- Subplan G (`@aikb/session-memory`)
- Subplan H (`@aikb/vector-store`)
- Subplan I (`@aikb/graph-store`)
- Subplan F (`@aikb/core-embeddings`)

---

## Detailed Tasks

### K1 ⬜ App scaffold

- Directory: `apps/mcp-server/`
- Package name: `@aikb/mcp-server`
- `package.json` bin: `{ "aikb-mcp": "./dist/index.js" }`
- Runtime dependencies:
  - All `@aikb/*` packages (workspace:*)
  - `@modelcontextprotocol/sdk ^1.0`
  - `zod ^3.22`
- Build: `tsup src/index.ts --format esm --dts false --clean --banner.js '#!/usr/bin/env node'`

### K2 ⬜ Architecture

```
apps/mcp-server/src/
├── index.ts              ← Setup, transport init, tool registration
└── tools/
    ├── session.ts        ← session_memory.* tools
    ├── vector.ts         ← vector.* tools
    ├── graph.ts          ← graph.* tools
    └── models.ts         ← models.* tools
```

Each tool module exports a `registerTools(server: McpServer): void` function. No business logic lives in the MCP layer — all logic delegates to the `@aikb/*` packages.

### K3 ⬜ Server setup

```ts
// src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSessionTools } from './tools/session.js';
import { registerVectorTools } from './tools/vector.js';
import { registerGraphTools } from './tools/graph.js';
import { registerModelsTools } from './tools/models.js';

async function main() {
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
  const transportType = process.env['AIKB_MCP_TRANSPORT'] ?? 'stdio';

  if (transportType === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[aikb-mcp] Running on stdio transport\n');
  } else if (transportType === 'sse') {
    // SSE transport setup (optional)
    const port = parseInt(process.env['AIKB_MCP_PORT'] ?? '3001', 10);
    // await server.connect(new SSEServerTransport(...));
    process.stderr.write(`[aikb-mcp] Running on SSE transport at port ${port}\n`);
  }
}

main().catch(err => {
  process.stderr.write(`[aikb-mcp] Fatal: ${String(err)}\n`);
  process.exit(1);
});
```

### K4 ⬜ Session memory tools

```ts
// src/tools/session.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createSessionStore } from '@aikb/session-memory';

export function registerSessionTools(server: McpServer): void {

  server.tool(
    'session_memory_add',
    'Add a memory entry to a session',
    {
      session_id: z.string().describe('Session ID to add the entry to'),
      role: z.enum(['user', 'assistant', 'system', 'tool']).describe('Role of the entry'),
      content: z.string().describe('Content of the memory entry'),
    },
    async ({ session_id, role, content }) => {
      const store = await createSessionStore();
      const entry = await store.add(session_id, {
        role,
        content,
        timestamp: new Date().toISOString(),
      });
      return { content: [{ type: 'text', text: JSON.stringify(entry) }] };
    },
  );

  server.tool(
    'session_memory_get',
    'Get all entries for a session',
    {
      session_id: z.string().describe('Session ID to retrieve'),
    },
    async ({ session_id }) => {
      const store = await createSessionStore();
      const result = await store.get(session_id);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'session_memory_list',
    'List all sessions',
    {
      limit: z.number().int().positive().max(100).optional()
        .describe('Maximum number of sessions to return'),
    },
    async ({ limit }) => {
      const store = await createSessionStore();
      const sessions = await store.list();
      const limited = limit ? sessions.slice(0, limit) : sessions;
      return { content: [{ type: 'text', text: JSON.stringify(limited) }] };
    },
  );

  server.tool(
    'session_memory_search',
    'Search across all sessions for a text pattern',
    {
      pattern: z.string().describe('Substring or regex pattern to search for'),
      limit: z.number().int().positive().max(50).optional()
        .describe('Maximum results to return'),
    },
    async ({ pattern, limit }) => {
      const store = await createSessionStore();
      const results = await store.search({ pattern, limit });
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  );
}
```

### K5 ⬜ Vector tools

```ts
// src/tools/vector.ts
export function registerVectorTools(server: McpServer): void {

  server.tool(
    'vector_ingest',
    'Scan a directory and ingest files into the vector store',
    {
      root: z.string().describe('Absolute or relative path to the root directory'),
      collection: z.string().optional().describe('Collection name override'),
    },
    async ({ root, collection }) => {
      // Full ingest pipeline (scan → chunk → embed → upsert)
      // Returns: { files_processed, chunks_inserted, chunks_skipped }
    },
  );

  server.tool(
    'vector_query',
    'Semantic search in the vector store',
    {
      text: z.string().describe('Query text for semantic search'),
      top_k: z.number().int().positive().max(50).default(10)
        .describe('Number of results to return'),
      source_prefix: z.string().optional()
        .describe('Filter results to files under this path prefix'),
    },
    async ({ text, top_k, source_prefix }) => {
      // Embed query, search Qdrant, return results
    },
  );

  server.tool(
    'vector_status',
    'Get vector store collection status',
    {},
    async () => {
      const store = await createVectorStore();
      const status = await store.status();
      return { content: [{ type: 'text', text: JSON.stringify(status) }] };
    },
  );
}
```

### K6 ⬜ Graph tools

```ts
// src/tools/graph.ts
export function registerGraphTools(server: McpServer): void {

  server.tool(
    'graph_ingest',
    'Extract entities and relations from files and store in graph',
    {
      root: z.string().describe('Root directory to scan and ingest'),
    },
    async ({ root }) => { /* ingest pipeline */ },
  );

  server.tool(
    'graph_query',
    'Execute a Cypher query against the graph store',
    {
      cypher: z.string().describe('Cypher query to execute'),
      params: z.record(z.unknown()).optional().describe('Query parameters'),
    },
    async ({ cypher, params }) => {
      const store = await createGraphStore();
      await store.connect();
      try {
        const results = await store.queryCypher(cypher, params);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      } finally {
        await store.close();
      }
    },
  );

  server.tool(
    'graph_ask',
    'Ask a natural language question answered from the graph',
    {
      text: z.string().describe('Natural language question about the knowledge graph'),
    },
    async ({ text }) => {
      // NL → Cypher → results → LLM summarize → answer
    },
  );
}
```

### K7 ⬜ Models tools

```ts
// src/tools/models.ts
export function registerModelsTools(server: McpServer): void {

  server.tool(
    'models_list',
    'List available embedding models',
    {},
    async () => {
      const { MODEL_REGISTRY } = await import('@aikb/core-embeddings');
      return {
        content: [{ type: 'text', text: JSON.stringify(MODEL_REGISTRY) }],
      };
    },
  );

  server.tool(
    'models_download',
    'Pre-download a local embedding model',
    {
      model_id: z.string().describe('HuggingFace model ID to download'),
    },
    async ({ model_id }) => {
      const { LocalHFProvider } = await import('@aikb/core-embeddings');
      const provider = new LocalHFProvider(model_id);
      await provider.ensureModel();
      return { content: [{ type: 'text', text: `Downloaded: ${model_id}` }] };
    },
  );
}
```

### K8 ⬜ Error handling

All tool handlers must catch errors and return them as MCP error responses (not crash the server):

```ts
function wrapTool<T>(fn: () => Promise<T>): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return fn().then(result => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
  })).catch(err => ({
    content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  }));
}
```

### K9 ⬜ Testing with MCP Inspector

After build, test with the MCP Inspector:
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Open `http://localhost:5173` → verify all tools are listed and callable.

### K10 ⬜ Unit tests

`src/__tests__/tools.test.ts`:

- Mock all package dependencies
- Test each tool handler returns correct response shape
- Test error handling returns `isError: true` with message
- Test tool input validation (Zod schema rejects invalid params)

---

## File Structure

```
apps/mcp-server/
├── src/
│   ├── index.ts          ← Server setup, transport, tool registration
│   ├── tools/
│   │   ├── session.ts
│   │   ├── vector.ts
│   │   ├── graph.ts
│   │   └── models.ts
│   └── __tests__/
│       └── tools.test.ts
├── package.json
└── tsconfig.json
```

---

## Tool Reference

| Tool Name | Description | Key Params |
|-----------|-------------|-----------|
| `session_memory_add` | Add memory entry | `session_id`, `role`, `content` |
| `session_memory_get` | Get session entries | `session_id` |
| `session_memory_list` | List all sessions | `limit?` |
| `session_memory_search` | Search sessions | `pattern`, `limit?` |
| `vector_ingest` | Ingest directory | `root`, `collection?` |
| `vector_query` | Semantic search | `text`, `top_k?`, `source_prefix?` |
| `vector_status` | Collection status | — |
| `graph_ingest` | Graph ingestion | `root` |
| `graph_query` | Cypher query | `cypher`, `params?` |
| `graph_ask` | NL question | `text` |
| `models_list` | List models | — |
| `models_download` | Download model | `model_id` |

---

## Claude Desktop Integration

Add to `~/.config/claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "aikb": {
      "command": "node",
      "args": ["/path/to/apps/mcp-server/dist/index.js"],
      "env": {
        "AIKB_DATA_DIR": "/path/to/.aikb"
      }
    }
  }
}
```

---

## Acceptance Criteria

- [ ] `pnpm --filter @aikb/mcp-server build` succeeds
- [ ] `pnpm --filter @aikb/mcp-server test` passes unit tests
- [ ] `node dist/index.js` starts without error and reads from stdin
- [ ] All 12 tools are discoverable via MCP Inspector
- [ ] Each tool returns valid MCP response shape
- [ ] Errors are returned as `isError: true` (server doesn't crash)
- [ ] Claude Desktop can connect and invoke tools

---

## Notes for Implementers

- Always write diagnostic messages to `stderr` — `stdout` is reserved for the MCP protocol when using stdio transport.
- Each tool handler should be stateless where possible (create + close connections per call) — or use a module-level singleton for performance.
- The `@modelcontextprotocol/sdk` Zod integration auto-validates inputs before calling the handler. If validation fails, the SDK returns an error response automatically.
- For the `vector_ingest` and `graph_ingest` tools, consider streaming progress via MCP notifications if the SDK supports it.
- Keep tool names snake_case with a namespace prefix (e.g., `session_memory_`, `vector_`, `graph_`) to avoid collisions with other MCP servers.
