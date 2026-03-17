import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createVectorStore } from '@aikb/vector-store';
import { scanFolder } from '@aikb/core-fs-scan';
import { loadAndChunk } from '@aikb/core-chunking';
import { getConfig } from '@aikb/core-config';
import type { FileEntry } from '@aikb/core-types';

// ---------------------------------------------------------------------------
// Error wrapper
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

export function registerVectorTools(server: McpServer): void {
  // ─────────────────────────────────────────────────────────────────────────
  // vector_ingest
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'vector_ingest',
    'Scan a directory and ingest files into the vector store',
    {
      root: z.string().describe('Absolute or relative path to the root directory'),
      collection: z.string().optional().describe('Collection name override'),
    },
    async ({ root, collection }) =>
      safeTool(async () => {
        const config = await getConfig();

        if (collection !== undefined) {
          config.vector.collection_name = collection;
        }

        // Collect file entries
        const entries: FileEntry[] = [];
        for await (const entry of scanFolder({ root })) {
          entries.push(entry);
        }

        if (entries.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ files_processed: 0, chunks_inserted: 0, chunks_skipped: 0 }),
              },
            ],
          };
        }

        const { createEmbeddingProvider } = await import('@aikb/core-embeddings');
        const embeddingProvider = createEmbeddingProvider(config.embedding);
        const store = await createVectorStore();

        const testVec = await embeddingProvider.embed('hello');
        await store.ensureCollection(testVec.length);

        let totalInserted = 0;
        let totalSkipped = 0;
        const BATCH_SIZE = 50;

        for (const entry of entries) {
          try {
            const { chunks } = await loadAndChunk(entry);

            for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
              const batch = chunks.slice(i, i + BATCH_SIZE);
              const contents = batch.map((c) => c.content);
              const vectors = await embeddingProvider.embedBatch(contents);
              const upsertResult = await store.upsert(batch, vectors);
              totalInserted += upsertResult.inserted;
              totalSkipped += upsertResult.skipped;
            }
          } catch (fileErr) {
            // skip unreadable / binary files — log to stderr for diagnostics
            process.stderr.write(
              `[aikb-mcp] vector_ingest skipped file: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}\n`,
            );
          }
        }

        const summary = {
          files_processed: entries.length,
          chunks_inserted: totalInserted,
          chunks_skipped: totalSkipped,
        };

        return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
      }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // vector_query
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'vector_query',
    'Semantic search in the vector store',
    {
      text: z.string().describe('Query text for semantic search'),
      top_k: z
        .number()
        .int()
        .positive()
        .max(50)
        .default(10)
        .describe('Number of results to return'),
      source_prefix: z
        .string()
        .optional()
        .describe('Filter results to files under this path prefix'),
    },
    async ({ text, top_k, source_prefix }) =>
      safeTool(async () => {
        const config = await getConfig();
        const { createEmbeddingProvider } = await import('@aikb/core-embeddings');
        const embeddingProvider = createEmbeddingProvider(config.embedding);
        const store = await createVectorStore();

        const result = await store.query(
          {
            text,
            top_k,
            ...(source_prefix !== undefined ? { source_prefix } : {}),
          },
          embeddingProvider,
        );

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // vector_status
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'vector_status',
    'Get vector store collection status',
    {},
    async () =>
      safeTool(async () => {
        const store = await createVectorStore();
        const status = await store.status();
        return { content: [{ type: 'text', text: JSON.stringify(status) }] };
      }),
  );
}
