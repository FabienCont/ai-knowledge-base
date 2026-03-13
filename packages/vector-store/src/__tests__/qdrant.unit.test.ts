import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QdrantVectorStore, payloadToChunk } from '../qdrant.js';
import { buildQdrantFilter } from '../filter.js';
import type { VectorConfig } from '@aikb/core-config';
import type { Chunk } from '@aikb/core-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<VectorConfig>): VectorConfig {
  return {
    provider: 'qdrant',
    qdrant_url: 'http://localhost:6333',
    qdrant_api_key: undefined,
    collection_name: 'test-collection',
    distance: 'cosine',
    ...overrides,
  };
}

function makeChunk(overrides?: Partial<Chunk>): Chunk {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    document_id: '00000000-0000-0000-0000-000000000002',
    source_path: 'src/index.ts',
    content: 'export const foo = 42;',
    hash: 'a'.repeat(64),
    index: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// QdrantVectorStore constructor — config mapping
// ---------------------------------------------------------------------------

describe('QdrantVectorStore constructor', () => {
  it('accepts cosine distance config without throwing', () => {
    const config = makeConfig({ distance: 'cosine' });
    expect(() => new QdrantVectorStore(config)).not.toThrow();
  });

  it('accepts dot distance config without throwing', () => {
    const config = makeConfig({ distance: 'dot' });
    expect(() => new QdrantVectorStore(config)).not.toThrow();
  });

  it('accepts euclid distance config without throwing', () => {
    const config = makeConfig({ distance: 'euclid' });
    expect(() => new QdrantVectorStore(config)).not.toThrow();
  });

  it('accepts an optional api key', () => {
    const config = makeConfig({ qdrant_api_key: 'secret-key' });
    expect(() => new QdrantVectorStore(config)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// payloadToChunk — round-trip serialisation
// ---------------------------------------------------------------------------

describe('payloadToChunk', () => {
  it('reconstructs a chunk with all required fields', () => {
    const original = makeChunk();
    const payload: Record<string, unknown> = {
      chunk_id: original.id,
      document_id: original.document_id,
      source_path: original.source_path,
      content: original.content,
      hash: original.hash,
      index: original.index,
    };

    const chunk = payloadToChunk(payload);
    expect(chunk.id).toBe(original.id);
    expect(chunk.document_id).toBe(original.document_id);
    expect(chunk.source_path).toBe(original.source_path);
    expect(chunk.content).toBe(original.content);
    expect(chunk.hash).toBe(original.hash);
    expect(chunk.index).toBe(original.index);
  });

  it('reconstructs optional line_start and line_end', () => {
    const payload: Record<string, unknown> = {
      chunk_id: '00000000-0000-0000-0000-000000000001',
      document_id: '00000000-0000-0000-0000-000000000002',
      source_path: 'src/foo.ts',
      content: 'hello',
      hash: 'b'.repeat(64),
      index: 1,
      line_start: 10,
      line_end: 20,
    };
    const chunk = payloadToChunk(payload);
    expect(chunk.line_start).toBe(10);
    expect(chunk.line_end).toBe(20);
  });

  it('sets line_start and line_end to undefined when absent', () => {
    const payload: Record<string, unknown> = {
      chunk_id: '00000000-0000-0000-0000-000000000001',
      document_id: '00000000-0000-0000-0000-000000000002',
      source_path: 'src/foo.ts',
      content: 'hello',
      hash: 'c'.repeat(64),
      index: 0,
    };
    const chunk = payloadToChunk(payload);
    expect(chunk.line_start).toBeUndefined();
    expect(chunk.line_end).toBeUndefined();
  });

  it('reconstructs language field', () => {
    const payload: Record<string, unknown> = {
      chunk_id: '00000000-0000-0000-0000-000000000001',
      document_id: '00000000-0000-0000-0000-000000000002',
      source_path: 'src/foo.ts',
      content: 'hello',
      hash: 'd'.repeat(64),
      index: 0,
      language: 'typescript',
    };
    const chunk = payloadToChunk(payload);
    expect(chunk.language).toBe('typescript');
  });

  it('reconstructs metadata field', () => {
    const payload: Record<string, unknown> = {
      chunk_id: '00000000-0000-0000-0000-000000000001',
      document_id: '00000000-0000-0000-0000-000000000002',
      source_path: 'src/foo.ts',
      content: 'hello',
      hash: 'e'.repeat(64),
      index: 0,
      metadata: { custom: 'value' },
    };
    const chunk = payloadToChunk(payload);
    expect(chunk.metadata).toEqual({ custom: 'value' });
  });

  it('sets metadata to undefined when null', () => {
    const payload: Record<string, unknown> = {
      chunk_id: '00000000-0000-0000-0000-000000000001',
      document_id: '00000000-0000-0000-0000-000000000002',
      source_path: 'src/foo.ts',
      content: 'hello',
      hash: 'f'.repeat(64),
      index: 0,
      metadata: null,
    };
    const chunk = payloadToChunk(payload);
    expect(chunk.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildQdrantFilter
// ---------------------------------------------------------------------------

describe('buildQdrantFilter', () => {
  it('converts exact string match', () => {
    const filter = buildQdrantFilter({ source_path: 'src/index.ts' });
    expect(filter.must).toHaveLength(1);
    expect(filter.must?.[0]).toEqual({
      key: 'source_path',
      match: { value: 'src/index.ts' },
    });
  });

  it('converts exact number match', () => {
    const filter = buildQdrantFilter({ index: 5 });
    expect(filter.must?.[0]).toEqual({ key: 'index', match: { value: 5 } });
  });

  it('converts prefix match', () => {
    const filter = buildQdrantFilter({ source_path: { prefix: 'src/' } });
    expect(filter.must?.[0]).toEqual({
      key: 'source_path',
      match: { text: 'src/' },
    });
  });

  it('converts any-of match', () => {
    const filter = buildQdrantFilter({
      language: { any: ['typescript', 'javascript'] },
    });
    expect(filter.must?.[0]).toEqual({
      key: 'language',
      match: { any: ['typescript', 'javascript'] },
    });
  });

  it('converts range match', () => {
    const filter = buildQdrantFilter({ index: { gte: 0, lt: 10 } });
    expect(filter.must?.[0]).toEqual({
      key: 'index',
      range: { gte: 0, lt: 10 },
    });
  });

  it('handles multiple keys', () => {
    const filter = buildQdrantFilter({
      source_path: 'src/foo.ts',
      language: 'typescript',
    });
    expect(filter.must).toHaveLength(2);
  });

  it('skips null and undefined values', () => {
    const filter = buildQdrantFilter({ source_path: null, language: undefined });
    expect(filter.must).toHaveLength(0);
  });

  it('returns empty must array for empty filter', () => {
    const filter = buildQdrantFilter({});
    expect(filter.must).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// QdrantVectorStore with mocked Qdrant client
// ---------------------------------------------------------------------------

// We test the behaviour of QdrantVectorStore by patching the underlying
// QdrantClient with vi.fn() stubs so no running Qdrant is required.

function makeStore(config?: Partial<VectorConfig>): {
  store: QdrantVectorStore;
  // Exposed mocked methods
  mocks: {
    getCollections: ReturnType<typeof vi.fn>;
    createCollection: ReturnType<typeof vi.fn>;
    scroll: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    getCollection: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
} {
  const mocks = {
    getCollections: vi.fn(),
    createCollection: vi.fn(),
    scroll: vi.fn(),
    upsert: vi.fn(),
    search: vi.fn(),
    getCollection: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };

  const store = new QdrantVectorStore(makeConfig(config));
  // Replace the internal client with our mock using a type-safe double assertion
  (store as unknown as { client: typeof mocks }).client = mocks;

  return { store, mocks };
}

describe('ensureCollection()', () => {
  it('creates a collection when it does not exist', async () => {
    const { store, mocks } = makeStore();
    mocks.getCollections.mockResolvedValue({ collections: [] });
    mocks.createCollection.mockResolvedValue({});

    await store.ensureCollection(128);

    expect(mocks.createCollection).toHaveBeenCalledWith('test-collection', {
      vectors: { size: 128, distance: 'Cosine' },
    });
  });

  it('does NOT create a collection when it already exists', async () => {
    const { store, mocks } = makeStore();
    mocks.getCollections.mockResolvedValue({
      collections: [{ name: 'test-collection' }],
    });

    await store.ensureCollection(128);

    expect(mocks.createCollection).not.toHaveBeenCalled();
  });

  it('maps distance dot → Dot', async () => {
    const { store, mocks } = makeStore({ distance: 'dot' });
    mocks.getCollections.mockResolvedValue({ collections: [] });
    mocks.createCollection.mockResolvedValue({});

    await store.ensureCollection(64);

    const [, callArg] = mocks.createCollection.mock.calls[0] as [string, { vectors: { distance: string } }];
    expect(callArg.vectors.distance).toBe('Dot');
  });

  it('maps distance euclid → Euclid', async () => {
    const { store, mocks } = makeStore({ distance: 'euclid' });
    mocks.getCollections.mockResolvedValue({ collections: [] });
    mocks.createCollection.mockResolvedValue({});

    await store.ensureCollection(64);

    const [, callArg] = mocks.createCollection.mock.calls[0] as [string, { vectors: { distance: string } }];
    expect(callArg.vectors.distance).toBe('Euclid');
  });
});

describe('upsert()', () => {
  beforeEach(() => {
    // Silence any lingering mock state between tests
  });

  it('returns zero counts for empty input', async () => {
    const { store, mocks } = makeStore();
    mocks.scroll.mockResolvedValue({ points: [], next_page_offset: null });

    const result = await store.upsert([], []);

    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 0 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('inserts new chunks when none exist', async () => {
    const { store, mocks } = makeStore();
    const chunk = makeChunk();

    // No existing hashes
    mocks.scroll.mockResolvedValue({ points: [], next_page_offset: null });
    mocks.upsert.mockResolvedValue({ operation_id: 1, status: 'completed' });

    const result = await store.upsert([chunk], [[0.1, 0.2, 0.3]]);

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });

  it('skips chunks whose hash already exists', async () => {
    const { store, mocks } = makeStore();
    const chunk = makeChunk({ hash: 'a'.repeat(64) });

    // Simulate hash already present
    mocks.scroll.mockResolvedValue({
      points: [{ id: chunk.id, payload: { hash: chunk.hash } }],
      next_page_offset: null,
    });

    const result = await store.upsert([chunk], [[0.1, 0.2, 0.3]]);

    expect(result.skipped).toBe(1);
    expect(result.inserted).toBe(0);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('sends correct point structure to Qdrant', async () => {
    const { store, mocks } = makeStore();
    const chunk = makeChunk();
    const vector = [0.5, 0.6, 0.7];

    mocks.scroll.mockResolvedValue({ points: [], next_page_offset: null });
    mocks.upsert.mockResolvedValue({ operation_id: 1, status: 'completed' });

    await store.upsert([chunk], [vector]);

    const call = mocks.upsert.mock.calls[0];
    expect(call?.[0]).toBe('test-collection');
    const { points } = call?.[1] as { points: unknown[] };
    expect(points).toHaveLength(1);
    const point = points[0] as {
      id: string;
      vector: number[];
      payload: Record<string, unknown>;
    };
    expect(point.id).toBe(chunk.id);
    expect(point.vector).toEqual(vector);
    expect(point.payload['content']).toBe(chunk.content);
    expect(point.payload['hash']).toBe(chunk.hash);
  });
});

describe('query()', () => {
  it('embeds the query text and calls search', async () => {
    const { store, mocks } = makeStore();
    const embedSpy = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const mockProvider = { embed: embedSpy, embedBatch: vi.fn(), name: 'mock', dimensions: 3, ensureModel: vi.fn() };

    const scoredPoint = {
      id: '00000000-0000-0000-0000-000000000001',
      version: 0,
      score: 0.95,
      payload: {
        chunk_id: '00000000-0000-0000-0000-000000000001',
        document_id: '00000000-0000-0000-0000-000000000002',
        source_path: 'src/index.ts',
        content: 'hello',
        hash: 'a'.repeat(64),
        index: 0,
      },
    };
    mocks.search.mockResolvedValue([scoredPoint]);

    const result = await store.query(
      { text: 'find me', top_k: 5 },
      mockProvider,
    );

    expect(embedSpy).toHaveBeenCalledWith('find me');
    expect(mocks.search).toHaveBeenCalledOnce();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.score).toBe(0.95);
    expect(result.items[0]!.chunk.content).toBe('hello');
  });

  it('returns results sorted by score (highest first)', async () => {
    const { store, mocks } = makeStore();
    const mockProvider = {
      embed: vi.fn().mockResolvedValue([0.1]),
      embedBatch: vi.fn(),
      name: 'mock',
      dimensions: 1,
      ensureModel: vi.fn(),
    };

    const makePoint = (id: string, score: number) => ({
      id,
      version: 0,
      score,
      payload: {
        chunk_id: id,
        document_id: '00000000-0000-0000-0000-000000000002',
        source_path: 'src/foo.ts',
        content: 'x',
        hash: id.replace(/-/g, '').padEnd(64, '0'),
        index: 0,
      },
    });

    // Qdrant returns in score order (highest first)
    mocks.search.mockResolvedValue([
      makePoint('00000000-0000-0000-0000-000000000003', 0.9),
      makePoint('00000000-0000-0000-0000-000000000001', 0.7),
      makePoint('00000000-0000-0000-0000-000000000002', 0.5),
    ]);

    const result = await store.query({ text: 'q', top_k: 3 }, mockProvider);

    expect(result.items[0]!.score).toBeGreaterThan(result.items[1]!.score);
    expect(result.items[1]!.score).toBeGreaterThan(result.items[2]!.score);
  });

  it('passes min_score and filter to search', async () => {
    const { store, mocks } = makeStore();
    const mockProvider = {
      embed: vi.fn().mockResolvedValue([0.1]),
      embedBatch: vi.fn(),
      name: 'mock',
      dimensions: 1,
      ensureModel: vi.fn(),
    };
    mocks.search.mockResolvedValue([]);

    await store.query(
      {
        text: 'q',
        top_k: 10,
        min_score: 0.5,
        filter: { language: 'typescript' },
      },
      mockProvider,
    );

    const callArgs = mocks.search.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs['score_threshold']).toBe(0.5);
    expect(callArgs['filter']).toBeDefined();
  });

  it('includes duration_ms in result', async () => {
    const { store, mocks } = makeStore();
    const mockProvider = {
      embed: vi.fn().mockResolvedValue([0.1]),
      embedBatch: vi.fn(),
      name: 'mock',
      dimensions: 1,
      ensureModel: vi.fn(),
    };
    mocks.search.mockResolvedValue([]);

    const result = await store.query({ text: 'q', top_k: 1 }, mockProvider);

    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('status()', () => {
  it('returns collection info', async () => {
    const { store, mocks } = makeStore();
    mocks.getCollection.mockResolvedValue({
      status: 'green',
      points_count: 42,
      config: {
        params: {
          vectors: { size: 384, distance: 'Cosine' },
        },
      },
    });

    const status = await store.status();

    expect(status.name).toBe('test-collection');
    expect(status.vectorCount).toBe(42);
    expect(status.status).toBe('green');
    expect(status.dimensions).toBe(384);
  });

  it('maps grey status to yellow', async () => {
    const { store, mocks } = makeStore();
    mocks.getCollection.mockResolvedValue({
      status: 'grey',
      points_count: 10,
      config: {
        params: { vectors: { size: 128, distance: 'Cosine' } },
      },
    });

    const result = await store.status();
    expect(result.status).toBe('yellow');
  });

  it('handles null points_count gracefully', async () => {
    const { store, mocks } = makeStore();
    mocks.getCollection.mockResolvedValue({
      status: 'green',
      points_count: null,
      config: {
        params: { vectors: { size: 128, distance: 'Cosine' } },
      },
    });

    const result = await store.status();
    expect(result.vectorCount).toBe(0);
  });
});

describe('deleteBySource()', () => {
  it('returns 0 when no matching points exist', async () => {
    const { store, mocks } = makeStore();
    mocks.scroll.mockResolvedValue({ points: [], next_page_offset: null });

    const count = await store.deleteBySource('src/index.ts');
    expect(count).toBe(0);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('deletes points with matching source_path and returns count', async () => {
    const { store, mocks } = makeStore();
    mocks.scroll.mockResolvedValue({
      points: [
        { id: 'id-1', payload: { source_path: 'src/index.ts' } },
        { id: 'id-2', payload: { source_path: 'src/index.ts' } },
      ],
      next_page_offset: null,
    });
    mocks.delete.mockResolvedValue({ operation_id: 1, status: 'completed' });

    const count = await store.deleteBySource('src/index.ts');
    expect(count).toBe(2);
    expect(mocks.delete).toHaveBeenCalledOnce();
  });

  it('supports directory prefix matching', async () => {
    const { store, mocks } = makeStore();
    mocks.scroll.mockResolvedValue({
      points: [
        { id: 'id-1', payload: { source_path: 'src/a.ts' } },
        { id: 'id-2', payload: { source_path: 'src/b.ts' } },
        { id: 'id-3', payload: { source_path: 'lib/c.ts' } }, // NOT a match
      ],
      next_page_offset: null,
    });
    mocks.delete.mockResolvedValue({ operation_id: 1, status: 'completed' });

    const count = await store.deleteBySource('src/');
    expect(count).toBe(2); // only src/ prefixed ones
  });

  it('paginates when scroll returns a next_page_offset', async () => {
    const { store, mocks } = makeStore();
    mocks.scroll
      .mockResolvedValueOnce({
        points: [{ id: 'id-1', payload: { source_path: 'src/a.ts' } }],
        next_page_offset: 'id-1',
      })
      .mockResolvedValueOnce({
        points: [{ id: 'id-2', payload: { source_path: 'src/b.ts' } }],
        next_page_offset: null,
      });
    mocks.delete.mockResolvedValue({ operation_id: 1, status: 'completed' });

    const count = await store.deleteBySource('src/');
    expect(count).toBe(2);
    expect(mocks.scroll).toHaveBeenCalledTimes(2);
  });
});
