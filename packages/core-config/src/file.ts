import { readFile, access, constants as fsConstants } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError } from './errors.js';
import type { AppConfig } from './schema.js';

function validateConfigPath(p: string): string {
  // Normalize the path and reject null bytes
  if (p.includes('\0')) {
    throw new ConfigError(`Invalid config file path: "${p}"`);
  }
  return resolve(p);
}

/**
 * Attempts to load a config file from the given path (or default locations).
 * Search order: explicit path → ./aikb.config.json → ./aikb.config.js → none
 */
export async function loadFromFile(configPath?: string): Promise<Partial<AppConfig>> {
  const candidates = configPath
    ? [configPath]
    : [
        process.env['AIKB_CONFIG_FILE'],
        './aikb.config.json',
        './aikb.config.js',
      ].filter((p): p is string => typeof p === 'string');

  for (const candidate of candidates) {
    let resolvedPath: string;
    try {
      resolvedPath = validateConfigPath(candidate);
    } catch (err) {
      throw err instanceof ConfigError ? err : new ConfigError(String(err), err);
    }

    try {
      if (resolvedPath.endsWith('.json')) {
        const raw = await readFile(resolvedPath, 'utf8');
        try {
          return JSON.parse(raw) as Partial<AppConfig>;
        } catch (err) {
          throw new ConfigError(
            `Failed to parse config file "${resolvedPath}": ${String(err)}`,
            err,
          );
        }
      } else {
        // JS / ESM dynamic import — check existence first to avoid confusing errors
        try {
          await access(resolvedPath, fsConstants.F_OK);
        } catch (accessErr) {
          const code = (accessErr as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'ENOTDIR') {
            // File does not exist — try next candidate
            continue;
          }
          // Any other error (e.g. EACCES) is a real problem — report it
          throw new ConfigError(
            `Cannot access config file "${resolvedPath}": ${String(accessErr)}`,
            accessErr,
          );
        }
        const fileUrl = pathToFileURL(resolvedPath).href;
        try {
          const mod = (await import(fileUrl)) as { default?: Partial<AppConfig> };
          return mod.default ?? (mod as Partial<AppConfig>);
        } catch (err) {
          throw new ConfigError(
            `Failed to import config file "${resolvedPath}": ${String(err)}`,
            err,
          );
        }
      }
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      // File does not exist — try next candidate
      continue;
    }
  }

  return {};
}
