import * as dotenv from 'dotenv';
import { ZodError } from 'zod';
import { loadFromEnv } from './env.js';
import { ConfigError } from './errors.js';
import { loadFromFile } from './file.js';
import { AppConfig, AppConfigSchema } from './schema.js';

let _config: AppConfig | null = null;

/**
 * Deep-merges two objects. Arrays are replaced (not appended).
 * `undefined` values from the source are skipped.
 */
function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(override) as Array<keyof T>) {
    const overrideVal = override[key];
    if (overrideVal === undefined) continue;
    const baseVal = base[key];
    if (
      overrideVal !== null &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key as string] = deepMerge(
        baseVal as object,
        overrideVal as Partial<object>,
      );
    } else {
      result[key as string] = overrideVal;
    }
  }
  return result as T;
}

/**
 * Returns the validated AppConfig singleton.
 * Priority: defaults ← config file ← env vars ← overrides.
 */
export async function getConfig(overrides?: Partial<AppConfig>): Promise<AppConfig> {
  if (_config) return _config;

  // 1. Load .env file
  dotenv.config();

  // 2. Load config file
  let fileConfig: Partial<AppConfig> = {};
  try {
    fileConfig = await loadFromFile();
  } catch (err) {
    // Re-throw ConfigErrors from file loading; ignore missing files
    if (err instanceof ConfigError) throw err;
  }

  // 3. Load env vars
  const envConfig = loadFromEnv();

  // 4. Deep-merge: defaults ← file ← env ← overrides
  const defaults = AppConfigSchema.parse({});
  const merged = deepMerge(
    deepMerge(deepMerge(defaults, fileConfig as Partial<AppConfig>), envConfig as Partial<AppConfig>),
    overrides ?? {},
  );

  // 5. Validate with Zod (throws on invalid)
  try {
    _config = AppConfigSchema.parse(merged);
  } catch (err) {
    if (err instanceof ZodError) {
      const messages = err.errors
        .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
        .join('\n');
      throw new ConfigError(`Invalid configuration:\n${messages}`, err);
    }
    throw err;
  }

  return _config;
}

/**
 * Clears the singleton. For testing only.
 */
export function resetConfig(): void {
  _config = null;
}
