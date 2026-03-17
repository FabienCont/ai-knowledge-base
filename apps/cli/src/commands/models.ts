import type { Command } from 'commander';
import { getConfig } from '@aikb/core-config';
import { output, exitError } from '../output.js';
import { CLI_MODEL_REGISTRY } from '../models-registry.js';
import type { ModelEntry } from '../models-registry.js';
import cliProgress from 'cli-progress';
import chalk from 'chalk';

export function registerModelsCommands(program: Command): void {
  const models = program
    .command('models')
    .description('Embedding model management');

  // ---------------------------------------------------------------------------
  // models list
  // ---------------------------------------------------------------------------
  models
    .command('list')
    .description('List all available embedding models')
    .action(() => {
      const rows = CLI_MODEL_REGISTRY.map((m) => ({
        id: m.id,
        dimensions: m.dimensions,
        size: m.sizeLabel,
        default: m.isDefault ? '✓ DEFAULT' : '',
      }));

      output(program, rows, formatModelTable(CLI_MODEL_REGISTRY));
    });

  // ---------------------------------------------------------------------------
  // models download
  // ---------------------------------------------------------------------------
  models
    .command('download <model-id>')
    .description('Pre-download an embedding model to the local cache')
    .action(async (modelId: string) => {
      try {
        const config = await getConfig();

        const { createEmbeddingProvider } = await import('@aikb/core-embeddings');

        // Override model id for the provider
        const provider = createEmbeddingProvider({
          ...config.embedding,
          provider: 'local',
          model: modelId,
        });

        const isJson = program.opts<{ json?: boolean }>().json === true;

        let bar: cliProgress.SingleBar | null = null;
        if (!isJson) {
          bar = new cliProgress.SingleBar(
            {
              format: `${chalk.cyan('Downloading')} {bar} {percentage}% | {value}/{total} chunks`,
              clearOnComplete: false,
              hideCursor: true,
            },
            cliProgress.Presets.shades_classic,
          );
          bar.start(100, 0);
        }

        // Trigger model load by embedding a short text
        await provider.embed('download trigger');

        bar?.update(100);
        bar?.stop();

        output(
          program,
          { modelId, status: 'downloaded' },
          `Model ${modelId} is ready.`,
        );
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format the model registry as a pretty ASCII table for human output.
 */
function formatModelTable(registry: ModelEntry[]): string {
  const colWidths = {
    id: Math.max(5, ...registry.map((m) => m.id.length)),
    dims: 4,
    size: Math.max(4, ...registry.map((m) => m.sizeLabel.length)),
    def: 9, // '✓ DEFAULT'
  };

  const totalWidth = colWidths.id + colWidths.dims + colWidths.size + colWidths.def + 13;
  const top = `┌${'─'.repeat(totalWidth)}┐`;
  const bottom = `└${'─'.repeat(totalWidth)}┘`;
  const divider = `├${'─'.repeat(totalWidth)}┤`;
  const pad = (s: string, n: number) => s.padEnd(n);

  const header =
    `│  ${pad('Model', colWidths.id)}   ${pad('Dims', colWidths.dims)}   ${pad('Size', colWidths.size)}   ${pad('Default', colWidths.def)}  │`;

  const rows = registry.map(
    (m) =>
      `│  ${pad(m.id, colWidths.id)}   ${pad(String(m.dimensions), colWidths.dims)}   ${pad(m.sizeLabel, colWidths.size)}   ${pad(m.isDefault ? '✓ DEFAULT' : '', colWidths.def)}  │`,
  );

  return [top, header, divider, ...rows, bottom].join('\n');
}
