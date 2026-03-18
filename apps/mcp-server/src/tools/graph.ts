import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createGraphStore, createExtractor, ingestChunks } from '@aikb/graph-store';
import { scanFolder } from '@aikb/core-fs-scan';
import { loadAndChunk } from '@aikb/core-chunking';
import { getConfig } from '@aikb/core-config';
import type { LLMConfig } from '@aikb/core-config';
import type { FileEntry } from '@aikb/core-types';
import { safeTool } from './safe-tool.js';

// ---------------------------------------------------------------------------
// LLM helpers (reuse logic from CLI graph commands)
// ---------------------------------------------------------------------------

const CYPHER_KEYWORDS = /^(MATCH|WITH|CALL|OPTIONAL\s+MATCH|MERGE|CREATE|UNWIND|RETURN)/i;

async function generateCypher(question: string, llm: LLMConfig): Promise<string> {
  if (llm.provider === 'openai' || llm.provider === 'ollama') {
    const baseURL =
      llm.provider === 'ollama'
        ? (llm.base_url ?? 'http://localhost:11434/v1')
        : llm.base_url;

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey: llm.api_key ?? 'ollama',
      ...(baseURL !== undefined ? { baseURL } : {}),
    });

    const resp = await client.chat.completions.create({
      model: llm.model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are a Cypher query expert. Given a user question, return ONLY ' +
            'a valid Cypher query that retrieves relevant data from a Neo4j graph ' +
            'with Entity and Relation node types. Return no explanation.',
        },
        { role: 'user', content: question },
      ],
    });

    const cypher = resp.choices[0]?.message.content?.trim() ?? '';
    if (cypher.length > 0 && CYPHER_KEYWORDS.test(cypher)) {
      return cypher;
    }
  }

  return 'MATCH (n) RETURN n LIMIT 10';
}

async function summarizeResults(
  question: string,
  records: Record<string, unknown>[],
  llm: LLMConfig,
): Promise<string> {
  if (records.length === 0) return 'No results found in the graph for that question.';

  if (llm.provider === 'openai' || llm.provider === 'ollama') {
    const baseURL =
      llm.provider === 'ollama'
        ? (llm.base_url ?? 'http://localhost:11434/v1')
        : llm.base_url;

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey: llm.api_key ?? 'ollama',
      ...(baseURL !== undefined ? { baseURL } : {}),
    });

    const resp = await client.chat.completions.create({
      model: llm.model,
      temperature: llm.temperature,
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful assistant. Summarise the following graph query results ' +
            "to answer the user's question concisely.",
        },
        {
          role: 'user',
          content: `Question: ${question}\n\nResults:\n${JSON.stringify(records, null, 2)}`,
        },
      ],
    });

    return resp.choices[0]?.message.content?.trim() ?? JSON.stringify(records, null, 2);
  }

  return JSON.stringify(records, null, 2);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerGraphTools(server: McpServer): void {
  // ─────────────────────────────────────────────────────────────────────────
  // graph_ingest
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'graph_ingest',
    'Extract entities and relations from files and store in graph',
    {
      root: z.string().describe('Root directory to scan and ingest'),
    },
    async ({ root }) =>
      safeTool(async () => {
        const config = await getConfig();

        const entries: FileEntry[] = [];
        for await (const entry of scanFolder({ root })) {
          entries.push(entry);
        }

        if (entries.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ files_processed: 0, entities: 0, relations: 0 }),
              },
            ],
          };
        }

        const { createEmbeddingProvider } = await import('@aikb/core-embeddings');
        const embeddingProvider = createEmbeddingProvider(config.embedding);
        const store = await createGraphStore();
        const extractor = await createExtractor();

        await store.connect();

        let totalEntities = 0;
        let totalRelations = 0;
        const BATCH_SIZE = 20;

        try {
          await store.ensureSchema();

          for (const entry of entries) {
            try {
              const { chunks } = await loadAndChunk(entry);

              for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
                const batch = chunks.slice(i, i + BATCH_SIZE);
                const result = await ingestChunks(batch, store, extractor, embeddingProvider);
                totalEntities += result.entities;
                totalRelations += result.relations;
              }
            } catch (fileErr) {
              // skip unreadable / binary files — log to stderr for diagnostics
              process.stderr.write(
                `[aikb-mcp] graph_ingest skipped file: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}\n`,
              );
            }
          }
        } finally {
          await store.close();
        }

        const summary = {
          files_processed: entries.length,
          entities: totalEntities,
          relations: totalRelations,
        };

        return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
      }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // graph_query
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'graph_query',
    'Execute a Cypher query against the graph store',
    {
      cypher: z.string().describe('Cypher query to execute'),
      params: z.record(z.unknown()).optional().describe('Query parameters'),
    },
    async ({ cypher, params }) =>
      safeTool(async () => {
        const store = await createGraphStore();
        await store.connect();

        let records: Record<string, unknown>[];
        try {
          records = await store.queryCypher(cypher, params);
        } finally {
          await store.close();
        }

        return { content: [{ type: 'text', text: JSON.stringify(records) }] };
      }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // graph_ask
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'graph_ask',
    'Ask a natural language question answered from the graph',
    {
      text: z.string().describe('Natural language question about the knowledge graph'),
    },
    async ({ text }) =>
      safeTool(async () => {
        const config = await getConfig();
        const store = await createGraphStore();
        await store.connect();

        let cypher: string;
        let records: Record<string, unknown>[];
        let answer: string;

        try {
          cypher = await generateCypher(text, config.llm);
          records = await store.queryCypher(cypher);
          answer = await summarizeResults(text, records, config.llm);
        } finally {
          await store.close();
        }

        return {
          content: [
            { type: 'text', text: JSON.stringify({ cypher, results: records, answer }) },
          ],
        };
      }),
  );
}
