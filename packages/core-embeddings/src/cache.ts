import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import type { EmbeddingProvider } from './types.js';

const _require = createRequire(import.meta.url);

/**
 * Simple key-value cache for embedding vectors.
 * Implementations may be in-memory, SQLite-backed, etc.
 */
export interface EmbeddingCache {
  get(key: string): Promise<number[] | undefined>;
  set(key: string, vector: number[]): Promise<void>;
}

/**
 * Build a stable cache key from a model ID and the raw text.
 * Format: `<modelId>:<sha256(text)>`
 */
export function makeCacheKey(modelId: string, text: string): string {
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  return `${modelId}:${hash}`;
}

// ---------------------------------------------------------------------------
// SQLite-backed cache
// ---------------------------------------------------------------------------

/**
 * Persistent embedding cache backed by SQLite via `better-sqlite3`.
 * The database is created at `dbPath` if it does not already exist.
 * Only active when `config.embedding.cache_enabled` is `true`.
 */
export class SqliteEmbeddingCache implements EmbeddingCache {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Use createRequire so the CJS native module works in an ESM context.
    const BetterSqlite3 = _require('better-sqlite3') as typeof import('better-sqlite3');
    this.db = new BetterSqlite3(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  get(key: string): Promise<number[] | undefined> {
    const row = this.db
      .prepare<[string], { value: string }>('SELECT value FROM embeddings WHERE key = ?')
      .get(key);
    if (!row) return Promise.resolve(undefined);
    return Promise.resolve(JSON.parse(row.value) as number[]);
  }

  set(key: string, vector: number[]): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO embeddings (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(vector));
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Cache-wrapping provider
// ---------------------------------------------------------------------------

/**
 * Wraps an existing {@link EmbeddingProvider} with an {@link EmbeddingCache}.
 * Cache hits skip the inner provider entirely.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly cache: EmbeddingCache,
    private readonly modelId: string,
  ) {
    this.name = inner.name;
    this.dimensions = inner.dimensions;
  }

  ensureModel(): Promise<void> {
    return this.inner.ensureModel();
  }

  async embed(text: string): Promise<number[]> {
    const key = makeCacheKey(this.modelId, text);
    const cached = await this.cache.get(key);
    if (cached !== undefined) return cached;
    const vector = await this.inner.embed(text);
    await this.cache.set(key, vector);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
