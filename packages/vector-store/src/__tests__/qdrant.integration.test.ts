/**
 * @integration
 *
 * Integration tests for QdrantVectorStore.
 *
 * These tests require a running Qdrant instance. They are automatically skipped
 * unless the `QDRANT_URL` environment variable is set.
 *
 * Start Qdrant locally:
 *   docker compose -f docker/docker-compose.yml up -d
 *
 * Then run:
 *   QDRANT_URL=http://localhost:6333 pnpm --filter @aikb/vector-store test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QdrantVectorStore } from '../qdrant.js';
import type { VectorConfig } from '@aikb/core-config';
import type { Chunk } from '@aikb/core-types';
import { MockEmbeddingProvider } from '@aikb/core-embeddings';

const QDRANT_URL = process.env['QDRANT_URL'];
const SKIP = !QDRANT_URL;

const TEST_COLLECTION = `aikb-integration-${Date.now()}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): VectorConfig {
  return {
    provider: 'qdrant',
    qdrant_url: QDRANT_URL ?? 'http://localhost:6333',
    qdrant_api_key: undefined,
    collection_name: TEST_COLLECTION,
    distance: 'cosine',
  };
}

function makeChunk(overrides?: Partial<Chunk>): Chunk {
  const base: Chunk = {
    id: crypto.randomUUID(),
    document_id: crypto.randomUUID(),
    source_path: 'src/index.ts',
    content: 'export const answer = 42;',
    hash: crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'),
    index: 0,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Suite — skipped when QDRANT_URL is not set
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('QdrantVectorStore (integration)', () => {
  let store: QdrantVectorStore;
  const provider = new MockEmbeddingProvider();

  beforeAll(async () => {
    store = new QdrantVectorStore(makeConfig());
    await store.ensureCollection(provider.dimensions);
  });

  afterAll(async () => {
    // Clean up the test collection after all tests
    try {
      // Access the underlying client to delete the collection
      const client = (store as unknown as { client: { deleteCollection(name: string): Promise<unknown> } }).client;
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Best-effort cleanup — ignore errors
    }
  });

  // -------------------------------------------------------------------------
  // ensureCollection()
  // -------------------------------------------------------------------------

  it('ensureCollection() creates the collection', async () => {
    const status = await store.status();
    expect(status.name).toBe(TEST_COLLECTION);
    expect(status.dimensions).toBe(provider.dimensions);
  });

  it('ensureCollection() is idempotent — calling twice does not throw', async () => {
    await expect(
      store.ensureCollection(provider.dimensions),
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // upsert()
  // -------------------------------------------------------------------------

  it('upsert() inserts new chunks', async () => {
    const chunks = [
      makeChunk({ source_path: 'src/a.ts', content: 'chunk one' }),
      makeChunk({ source_path: 'src/a.ts', content: 'chunk two' }),
    ];
    const vectors = await provider.embedBatch(chunks.map((c) => c.content));

    const result = await store.upsert(chunks, vectors);

    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.updated).toBe(0);
  });

  it('upsert() is idempotent — same chunks → skipped count equals chunks.length', async () => {
    const chunk = makeChunk({ source_path: 'src/idem.ts', content: 'idempotent' });
    const vector = await provider.embed(chunk.content);

    // First upsert
    const first = await store.upsert([chunk], [vector]);
    expect(first.inserted).toBe(1);

    // Second upsert with the same chunk
    const second = await store.upsert([chunk], [vector]);
    expect(second.skipped).toBe(1);
    expect(second.inserted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // query()
  // -------------------------------------------------------------------------

  it('query() returns results in score order (highest first)', async () => {
    // Insert some chunks first
    const chunks = [
      makeChunk({ source_path: 'src/q.ts', content: 'alpha beta gamma' }),
      makeChunk({ source_path: 'src/q.ts', content: 'delta epsilon zeta' }),
      makeChunk({ source_path: 'src/q.ts', content: 'alpha alpha alpha' }),
    ];
    const vectors = await provider.embedBatch(chunks.map((c) => c.content));
    await store.upsert(chunks, vectors);

    const result = await store.query(
      { text: 'alpha beta gamma', top_k: 3 },
      provider,
    );

    expect(result.items.length).toBeGreaterThan(0);
    // Scores must be non-increasing
    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i - 1]!.score).toBeGreaterThanOrEqual(
        result.items[i]!.score,
      );
    }
  });

  it('query() includes duration_ms', async () => {
    const result = await store.query({ text: 'test', top_k: 1 }, provider);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // deleteBySource()
  // -------------------------------------------------------------------------

  it('deleteBySource() removes points matching the source prefix', async () => {
    const sourcePath = `src/to-delete-${Date.now()}.ts`;
    const chunks = [
      makeChunk({ source_path: sourcePath, content: 'delete me' }),
      makeChunk({ source_path: sourcePath, content: 'delete me too' }),
    ];
    const vectors = await provider.embedBatch(chunks.map((c) => c.content));
    await store.upsert(chunks, vectors);

    const deleted = await store.deleteBySource(sourcePath);
    expect(deleted).toBe(2);
  });

  it('deleteBySource() returns 0 when no points match', async () => {
    const deleted = await store.deleteBySource('src/non-existent-xyz.ts');
    expect(deleted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // status()
  // -------------------------------------------------------------------------

  it('status() returns non-zero vector count after upserts', async () => {
    const status = await store.status();
    expect(status.vectorCount).toBeGreaterThan(0);
  });

  it('status() returns green or yellow (not red) for a healthy collection', async () => {
    const status = await store.status();
    expect(['green', 'yellow']).toContain(status.status);
  });
});
