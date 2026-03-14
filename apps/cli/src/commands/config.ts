import type { Command } from 'commander';
import { getConfig } from '@aikb/core-config';
import { output, exitError } from '../output.js';
import type { AppConfig } from '@aikb/core-config';

const SENSITIVE_KEYS = new Set([
  'openai_api_key',
  'qdrant_api_key',
  'api_key',
  'neo4j_password',
]);

/**
 * Recursively redact sensitive keys in a plain object.
 */
function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEYS.has(k) && typeof v === 'string' && v.length > 0
      ? '***'
      : redact(v);
  }
  return result;
}

export function registerConfigCommands(program: Command): void {
  const config = program
    .command('config')
    .description('Configuration management');

  // ---------------------------------------------------------------------------
  // config show
  // ---------------------------------------------------------------------------
  config
    .command('show')
    .description('Print the resolved configuration (with secrets redacted)')
    .option('--section <section>', 'Show only one section (e.g. embedding, vector, graph, llm, session, scan)')
    .action(async (opts: { section?: string }) => {
      try {
        const cfg: AppConfig = await getConfig();
        const safeConfig = redact(cfg) as Record<string, unknown>;

        if (opts.section) {
          const section = safeConfig[opts.section];
          if (section === undefined) {
            exitError(
              `Unknown config section: ${opts.section}. ` +
                `Valid sections: ${Object.keys(safeConfig).join(', ')}`,
            );
          }
          output(program, section, JSON.stringify(section, null, 2));
        } else {
          output(program, safeConfig, JSON.stringify(safeConfig, null, 2));
        }
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });
}
