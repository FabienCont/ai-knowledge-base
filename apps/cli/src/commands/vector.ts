import type { Command } from 'commander';
import { getConfig } from '@aikb/core-config';
import { scanFolder } from '@aikb/core-fs-scan';
import type { FileEntry } from '@aikb/core-types';
import { loadAndChunk } from '@aikb/core-chunking';
import { createVectorStore } from '@aikb/vector-store';
import { output, exitError } from '../output.js';
import { createProgressBar } from '../progress.js';

/** Parse a positive integer option and exit with an error if invalid. */
function parsePositiveInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || !Number.isFinite(n) || n <= 0) {
    exitError(`--${name} must be a positive integer, got: ${JSON.stringify(value)}`);
  }
  return n;
}

export function registerVectorCommands(program: Command): void {
  const vector = program
    .command('vector')
    .description('Vector store operations');

  // ---------------------------------------------------------------------------
  // vector ingest
  // ---------------------------------------------------------------------------
  vector
    .command('ingest')
    .description('Scan a directory and ingest files into the vector store')
    .requiredOption('--root <path>', 'Root directory to scan')
    .option('--collection <name>', 'Collection name (overrides config)')
    .option('--batch-size <n>', 'Embedding batch size', '50')
    .option('--dry-run', 'Show what would be ingested without writing')
    .action(
      async (opts: {
        root: string;
        collection?: string;
        batchSize: string;
        dryRun?: boolean;
      }) => {
        try {
          const batchSize = parsePositiveInt(opts.batchSize, 'batch-size');
          const config = await getConfig();

          if (opts.collection) {
            config.vector.collection_name = opts.collection;
          }

          // Collect all FileEntry objects once (used for count + ingestion)
          const entries: FileEntry[] = [];
          for await (const entry of scanFolder({ root: opts.root })) {
            entries.push(entry);
          }

          if (entries.length === 0) {
            output(program, { inserted: 0, skipped: 0, files: 0 }, 'No files found.');
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
          const store = await createVectorStore();

          // Ensure collection exists (get dimensions from a test embed)
          const testVec = await embeddingProvider.embed('hello');
          await store.ensureCollection(testVec.length);

          const isJson = program.opts<{ json?: boolean }>().json === true;
          const bar = isJson ? null : createProgressBar({ total: entries.length, label: 'Ingesting' });

          let totalInserted = 0;
          let totalSkipped = 0;

          for (const entry of entries) {
            try {
              const result = await loadAndChunk(entry);
              const chunks = result.chunks;

              for (let i = 0; i < chunks.length; i += batchSize) {
                const batch = chunks.slice(i, i + batchSize);
                const contents = batch.map((c) => c.content);
                const vectors = await embeddingProvider.embedBatch(contents);
                const upsertResult = await store.upsert(batch, vectors);
                totalInserted += upsertResult.inserted;
                totalSkipped += upsertResult.skipped;
              }
            } catch (fileErr) {
              // Skip files that fail to load/chunk (binary files, permissions, etc.)
              if (program.opts<{ debug?: boolean }>().debug) {
                console.error(`[debug] skipped ${entry.path}: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`);
              }
            }
            bar?.increment();
          }

          bar?.stop();

          const summary = {
            files: entries.length,
            inserted: totalInserted,
            skipped: totalSkipped,
          };
          output(
            program,
            summary,
            `Ingested ${entries.length} file(s): ${totalInserted} chunks inserted, ${totalSkipped} skipped`,
          );
        } catch (err) {
          exitError(err instanceof Error ? err.message : String(err));
        }
      },
    );

  // ---------------------------------------------------------------------------
  // vector query
  // ---------------------------------------------------------------------------
  vector
    .command('query <text>')
    .description('Semantic search in the vector store')
    .option('--top-k <n>', 'Number of results to return', '5')
    .option('--collection <name>', 'Collection name (overrides config)')
    .action(async (text: string, opts: { topK: string; collection?: string }) => {
      try {
        const topK = parsePositiveInt(opts.topK, 'top-k');
        const config = await getConfig();

        if (opts.collection) {
          config.vector.collection_name = opts.collection;
        }

        const { createEmbeddingProvider } = await import('@aikb/core-embeddings');
        const embeddingProvider = createEmbeddingProvider(config.embedding);
        const store = await createVectorStore();

        const result = await store.query({ text, top_k: topK }, embeddingProvider);

        output(
          program,
          result,
          result.items.length === 0
            ? 'No results found.'
            : result.items
                .map(
                  (item, i) =>
                    `#${i + 1} (score: ${item.score.toFixed(4)}) ${item.chunk.source_path}:${item.chunk.line_start ?? '?'}\n${item.chunk.content.slice(0, 200)}`,
                )
                .join('\n\n'),
        );
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });

  // ---------------------------------------------------------------------------
  // vector status
  // ---------------------------------------------------------------------------
  vector
    .command('status')
    .description('Show vector store collection status')
    .option('--collection <name>', 'Collection name (overrides config)')
    .action(async (opts: { collection?: string }) => {
      try {
        const config = await getConfig();

        if (opts.collection) {
          config.vector.collection_name = opts.collection;
        }

        const store = await createVectorStore();
        const status = await store.status();

        output(
          program,
          status,
          `Collection: ${status.name}\nStatus: ${status.status}\nVectors: ${status.vectorCount}\nDimensions: ${status.dimensions}`,
        );
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });
}
