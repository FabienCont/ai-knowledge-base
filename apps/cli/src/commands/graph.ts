import type { Command } from 'commander';
import { getConfig } from '@aikb/core-config';
import type { LLMConfig } from '@aikb/core-config';
import { createGraphStore, createExtractor, ingestChunks } from '@aikb/graph-store';
import { scanFolder } from '@aikb/core-fs-scan';
import type { FileEntry } from '@aikb/core-types';
import { loadAndChunk } from '@aikb/core-chunking';
import { output, exitError } from '../output.js';
import { createProgressBar } from '../progress.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a positive integer option and exit with an error if invalid. */
function parsePositiveInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || !Number.isFinite(n) || n <= 0) {
    exitError(`--${name} must be a positive integer, got: ${JSON.stringify(value)}`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// LLM helpers for graph ask
// ---------------------------------------------------------------------------

/**
 * Use the configured LLM to translate a natural-language question into
 * a Cypher query.  Falls back to a broad MATCH+RETURN when the LLM
 * provider is not configured.
 */
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

    // Validate: Cypher must be non-empty and start with a known clause
    const CYPHER_KEYWORDS = /^(MATCH|WITH|CALL|OPTIONAL\s+MATCH|MERGE|CREATE|UNWIND|RETURN)/i;
    if (cypher.length > 0 && CYPHER_KEYWORDS.test(cypher)) {
      return cypher;
    }
  }

  // Fallback — broad search
  return 'MATCH (n) RETURN n LIMIT 10';
}

/**
 * Use the LLM to produce a human-readable summary of graph query results.
 */
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
            'to answer the user\'s question concisely.',
        },
        {
          role: 'user',
          content: `Question: ${question}\n\nResults:\n${JSON.stringify(records, null, 2)}`,
        },
      ],
    });

    return resp.choices[0]?.message.content?.trim() ?? JSON.stringify(records, null, 2);
  }

  // Fallback — just stringify
  return JSON.stringify(records, null, 2);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerGraphCommands(program: Command): void {
  const graph = program
    .command('graph')
    .description('Graph store operations');

  // ---------------------------------------------------------------------------
  // graph ingest
  // ---------------------------------------------------------------------------
  graph
    .command('ingest')
    .description('Scan a directory and extract entities/relations into the graph store')
    .requiredOption('--root <path>', 'Root directory to scan')
    .option('--batch-size <n>', 'Chunk batch size per file', '20')
    .option('--dry-run', 'Show what would be ingested without writing')
    .action(
      async (opts: { root: string; batchSize: string; dryRun?: boolean }) => {
        try {
          const batchSize = parsePositiveInt(opts.batchSize, 'batch-size');
          const config = await getConfig();

          // Collect all FileEntry objects once (used for count + ingestion)
          const entries: FileEntry[] = [];
          for await (const entry of scanFolder({ root: opts.root })) {
            entries.push(entry);
          }

          if (entries.length === 0) {
            output(program, { entities: 0, relations: 0, files: 0 }, 'No files found.');
            return;
          }

          if (opts.dryRun) {
            output(
              program,
              { files: entries.length, dryRun: true },
              `[dry-run] Would ingest ${entries.length} file(s) from ${opts.root}`,
            );
            return;
          }

          const { createEmbeddingProvider } = await import('@aikb/core-embeddings');
          const embeddingProvider = createEmbeddingProvider(config.embedding);
          const store = await createGraphStore();
          const extractor = await createExtractor();

          await store.connect();

          const isJson = program.opts<{ json?: boolean }>().json === true;
          const bar = isJson ? null : createProgressBar({ total: entries.length, label: 'Ingesting' });

          let totalEntities = 0;
          let totalRelations = 0;

          try {
            await store.ensureSchema();

            for (const entry of entries) {
              try {
                const result = await loadAndChunk(entry);
                const chunks = result.chunks;

                for (let i = 0; i < chunks.length; i += batchSize) {
                  const batch = chunks.slice(i, i + batchSize);
                  const ingestResult = await ingestChunks(
                    batch,
                    store,
                    extractor,
                    embeddingProvider,
                  );
                  totalEntities += ingestResult.entities;
                  totalRelations += ingestResult.relations;
                }
              } catch (fileErr) {
                // Skip unreadable or un-chunkable files
                if (program.opts<{ debug?: boolean }>().debug) {
                  console.error(`[debug] skipped ${entry.path}: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`);
                }
              }
              bar?.increment();
            }

            bar?.stop();
          } finally {
            await store.close();
          }

          const summary = {
            files: entries.length,
            entities: totalEntities,
            relations: totalRelations,
          };
          output(
            program,
            summary,
            `Ingested ${entries.length} file(s): ${totalEntities} entities, ${totalRelations} relations`,
          );
        } catch (err) {
          exitError(err instanceof Error ? err.message : String(err));
        }
      },
    );

  // ---------------------------------------------------------------------------
  // graph query
  // ---------------------------------------------------------------------------
  graph
    .command('query')
    .description('Execute a raw Cypher query against the graph store')
    .requiredOption('--cypher <cypher>', 'Cypher query to execute')
    .action(async (opts: { cypher: string }) => {
      try {
        const store = await createGraphStore();
        await store.connect();

        let records: Record<string, unknown>[];
        try {
          records = await store.queryCypher(opts.cypher);
        } finally {
          await store.close();
        }

        output(
          program,
          records,
          records.length === 0
            ? 'No results.'
            : records.map((r) => JSON.stringify(r)).join('\n'),
        );
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });

  // ---------------------------------------------------------------------------
  // graph ask
  // ---------------------------------------------------------------------------
  graph
    .command('ask')
    .description('Answer a natural-language question using the graph store')
    .requiredOption('--text <question>', 'Natural-language question')
    .action(async (opts: { text: string }) => {
      try {
        const config = await getConfig();
        const store = await createGraphStore();
        await store.connect();

        let cypher: string;
        let records: Record<string, unknown>[];
        let answer: string;

        try {
          cypher = await generateCypher(opts.text, config.llm);
          records = await store.queryCypher(cypher);
          answer = await summarizeResults(opts.text, records, config.llm);
        } finally {
          await store.close();
        }

        output(program, { cypher, results: records, answer }, answer);
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });

  // ---------------------------------------------------------------------------
  // graph stats
  // ---------------------------------------------------------------------------
  graph
    .command('stats')
    .description('Show graph store statistics')
    .action(async () => {
      try {
        const store = await createGraphStore();
        await store.connect();

        let stats: Awaited<ReturnType<typeof store.stats>>;
        try {
          stats = await store.stats();
        } finally {
          await store.close();
        }

        output(
          program,
          stats,
          `Entities: ${stats.entityCount}\nRelations: ${stats.relationCount}\nChunks: ${stats.chunkCount}`,
        );
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });
}
