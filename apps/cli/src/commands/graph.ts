import type { Command } from 'commander';
import { getConfig } from '@aikb/core-config';
import type { LLMConfig } from '@aikb/core-config';
import { createGraphStore, createExtractor, ingestChunks } from '@aikb/graph-store';
import { scanFolder } from '@aikb/core-fs-scan';
import { loadAndChunk } from '@aikb/core-chunking';
import { output, exitError } from '../output.js';
import { createProgressBar } from '../progress.js';

// ---------------------------------------------------------------------------
// LLM helpers for graph ask
// ---------------------------------------------------------------------------

/**
 * Use the configured LLM to translate a natural-language question into
 * a Cypher query.  Falls back to a simple MATCH+RETURN when the LLM
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

    return resp.choices[0]?.message.content?.trim() ?? '';
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
          const config = await getConfig();
          const batchSize = parseInt(opts.batchSize, 10);

          // Collect files first
          const files: string[] = [];
          for await (const entry of scanFolder({ root: opts.root })) {
            files.push(entry.path);
          }

          if (files.length === 0) {
            output(program, { entities: 0, relations: 0, files: 0 }, 'No files found.');
            return;
          }

          if (opts.dryRun) {
            output(
              program,
              { files: files.length, dryRun: true },
              `[dry-run] Would ingest ${files.length} file(s) from ${opts.root}`,
            );
            return;
          }

          const { createEmbeddingProvider } = await import('@aikb/core-embeddings');
          const embeddingProvider = createEmbeddingProvider(config.embedding);
          const store = await createGraphStore();
          const extractor = await createExtractor();

          await store.connect();
          await store.ensureSchema();

          const isJson = program.opts<{ json?: boolean }>().json === true;
          const bar = isJson ? null : createProgressBar({ total: files.length, label: 'Ingesting' });

          let totalEntities = 0;
          let totalRelations = 0;

          for await (const entry of scanFolder({ root: opts.root })) {
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
          await store.close();

          const summary = {
            files: files.length,
            entities: totalEntities,
            relations: totalRelations,
          };
          output(
            program,
            summary,
            `Ingested ${files.length} file(s): ${totalEntities} entities, ${totalRelations} relations`,
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
        const records = await store.queryCypher(opts.cypher);
        await store.close();

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

        const cypher = await generateCypher(opts.text, config.llm);
        const records = await store.queryCypher(cypher);
        const answer = await summarizeResults(opts.text, records, config.llm);

        await store.close();

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
        const stats = await store.stats();
        await store.close();

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
