/**
 * Unit tests for the graph-store extractor layer.
 * These tests run without any Neo4j connection.
 */

import { describe, it, expect, vi } from 'vitest';
import { MockExtractor } from '../extractor/mock.js';
import { NullExtractor } from '../extractor/null.js';
import { LLMExtractionSchema } from '../extractor/types.js';
import { resolveEntities } from '../extractor/resolution.js';
import { ingestChunks } from '../ingest.js';
import { MockEmbeddingProvider } from '@aikb/core-embeddings';
import type { EmbeddingProvider } from '@aikb/core-embeddings';
import type { Chunk, Entity } from '@aikb/core-types';
import type { GraphStore, GraphStoreStats } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(overrides?: Partial<Chunk>): Chunk {
  return {
    id: crypto.randomUUID(),
    document_id: crypto.randomUUID(),
    source_path: 'src/example.ts',
    content: 'TypeScript is a superset of JavaScript.',
    hash: 'a'.repeat(64),
    index: 0,
    ...overrides,
  };
}

/**
 * Embedding provider that returns a deterministic non-zero vector based on the
 * character sum of the text.  Unlike MockEmbeddingProvider, these vectors are
 * guaranteed to be non-zero, so cosine similarity is well-defined.
 */
class NonZeroMockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'non-zero-mock';
  readonly dimensions = 4;
  async ensureModel(): Promise<void> {}
  embed(text: string): Promise<number[]> {
    const h = text.split('').reduce((a, c) => a + c.charCodeAt(0), 1); // start at 1
    return Promise.resolve([h, h * 2, h * 3, h * 4]);
  }
  embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/** Stub GraphStore that keeps entities in memory. */
function makeMemoryStore(initial: Entity[] = []): GraphStore {
  const entities: Entity[] = [...initial];
  const relations: { id: string; subject_id: string; predicate: string; object_id: string }[] = [];

  return {
    connect(): Promise<void> { return Promise.resolve(); },
    ensureSchema(): Promise<void> { return Promise.resolve(); },
    upsertEntities(es: Entity[]): Promise<void> {
      for (const e of es) {
        const idx = entities.findIndex((x) => x.id === e.id);
        if (idx >= 0) {
          entities[idx] = e;
        } else {
          entities.push(e);
        }
      }
      return Promise.resolve();
    },
    upsertRelations(rs: Parameters<GraphStore['upsertRelations']>[0]): Promise<void> {
      for (const r of rs) {
        relations.push(r);
      }
      return Promise.resolve();
    },
    queryCypher(cypher: string): Promise<Record<string, unknown>[]> {
      if (cypher.includes('MATCH (e:Entity)')) {
        return Promise.resolve(entities.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          description: e.description ?? null,
          aliases: e.aliases ?? [],
          source_chunk_ids: e.source_chunk_ids,
        })));
      }
      return Promise.resolve([]);
    },
    stats(): Promise<GraphStoreStats> {
      return Promise.resolve({
        entityCount: entities.length,
        relationCount: relations.length,
        chunkCount: 0,
      });
    },
    close(): Promise<void> { return Promise.resolve(); },
  };
}

// ---------------------------------------------------------------------------
// LLMExtractionSchema
// ---------------------------------------------------------------------------

describe('LLMExtractionSchema', () => {
  it('parses a valid extraction result', () => {
    const input = {
      entities: [
        { name: 'TypeScript', type: 'Technology', description: 'A typed JS superset' },
      ],
      relations: [
        {
          subject_name: 'TypeScript',
          subject_type: 'Technology',
          predicate: 'PART_OF',
          object_name: 'JavaScript',
          object_type: 'Technology',
        },
      ],
    };
    const result = LLMExtractionSchema.parse(input);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.name).toBe('TypeScript');
    expect(result.relations[0]!.predicate).toBe('PART_OF');
  });

  it('defaults aliases to [] when omitted', () => {
    const input = {
      entities: [{ name: 'X', type: 'Y' }],
      relations: [],
    };
    const result = LLMExtractionSchema.parse(input);
    expect(result.entities[0]!.aliases).toEqual([]);
  });

  it('throws on invalid input (missing required fields)', () => {
    expect(() => LLMExtractionSchema.parse({ entities: [{ type: 'T' }], relations: [] })).toThrow();
  });

  it('throws on invalid confidence value', () => {
    const input = {
      entities: [],
      relations: [
        {
          subject_name: 'A',
          subject_type: 'T',
          predicate: 'P',
          object_name: 'B',
          object_type: 'T',
          confidence: 2.5, // out of range
        },
      ],
    };
    expect(() => LLMExtractionSchema.parse(input)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// NullExtractor
// ---------------------------------------------------------------------------

describe('NullExtractor', () => {
  it('returns empty entities and relations for any chunk', async () => {
    const extractor = new NullExtractor();
    const result = await extractor.extractFromChunk(makeChunk());
    expect(result.entities).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });

  it('resolveEntities returns empty array', async () => {
    const extractor = new NullExtractor();
    const store = makeMemoryStore();
    const provider = new MockEmbeddingProvider();
    const result = await extractor.resolveEntities([], store, provider);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// MockExtractor
// ---------------------------------------------------------------------------

describe('MockExtractor', () => {
  it('returns a default entity per chunk', async () => {
    const extractor = new MockExtractor();
    const chunk = makeChunk({ source_path: 'a.ts' });
    const result = await extractor.extractFromChunk(chunk);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.source_chunk_ids).toContain(chunk.id);
  });

  it('accepts a custom produce function', async () => {
    const extractor = new MockExtractor(() => ({
      entities: [
        {
          name: 'Custom',
          type: 'Thing',
          aliases: [],
          source_chunk_ids: ['chunk-1'],
        },
      ],
      relations: [],
    }));
    const result = await extractor.extractFromChunk(makeChunk());
    expect(result.entities[0]!.name).toBe('Custom');
  });
});

// ---------------------------------------------------------------------------
// resolveEntities
// ---------------------------------------------------------------------------

describe('resolveEntities', () => {
  const provider = new MockEmbeddingProvider();

  it('assigns fresh UUIDs to candidates when store is empty', async () => {
    const store = makeMemoryStore();
    const candidates = [
      { name: 'Alpha', type: 'Tech', aliases: [], source_chunk_ids: ['c1'] },
    ];
    const result = await resolveEntities(candidates, store, provider);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('returns empty array for empty candidates', async () => {
    const store = makeMemoryStore();
    const result = await resolveEntities([], store, provider);
    expect(result).toHaveLength(0);
  });

  it('merges a candidate with an existing entity above the similarity threshold', async () => {
    // Use a non-zero embedding provider so cosine similarity is well-defined.
    // "TypeScript" embedded twice → identical non-zero vector → similarity 1.0 → merges.
    const nonZeroProvider = new NonZeroMockEmbeddingProvider();
    const existingEntity: Entity = {
      id: 'existing-id-1',
      name: 'TypeScript',
      type: 'Technology',
      aliases: [],
      source_chunk_ids: ['old-chunk'],
    };
    const store = makeMemoryStore([existingEntity]);
    const candidates = [
      {
        name: 'TypeScript', // same name → same vector → similarity 1.0
        type: 'Technology',
        aliases: [],
        source_chunk_ids: ['new-chunk'],
      },
    ];
    const result = await resolveEntities(candidates, store, nonZeroProvider);
    expect(result).toHaveLength(1);
    // Must reuse the existing entity's ID
    expect(result[0]!.id).toBe('existing-id-1');
    // Must merge source_chunk_ids
    expect(result[0]!.source_chunk_ids).toContain('old-chunk');
    expect(result[0]!.source_chunk_ids).toContain('new-chunk');
  });
});

// ---------------------------------------------------------------------------
// ingestChunks
// ---------------------------------------------------------------------------

describe('ingestChunks', () => {
  const provider = new MockEmbeddingProvider();

  it('returns zero counts when no chunks provided', async () => {
    const store = makeMemoryStore();
    const extractor = new MockExtractor();
    const result = await ingestChunks([], store, extractor, provider);
    expect(result.entities).toBe(0);
    expect(result.relations).toBe(0);
  });

  it('NullExtractor → no entities or relations ingested', async () => {
    const store = makeMemoryStore();
    const extractor = new NullExtractor();
    const chunks = [makeChunk(), makeChunk()];
    const result = await ingestChunks(chunks, store, extractor, provider);
    expect(result.entities).toBe(0);
    expect(result.relations).toBe(0);
  });

  it('ingests entities via MockExtractor', async () => {
    const store = makeMemoryStore();
    const extractor = new MockExtractor();
    const chunks = [makeChunk({ source_path: 'a.ts' }), makeChunk({ source_path: 'b.ts' })];
    const result = await ingestChunks(chunks, store, extractor, provider);
    // MockExtractor returns one entity per chunk
    expect(result.entities).toBe(2);
  });

  it('ingests relations when extractor returns them', async () => {
    const store = makeMemoryStore();
    const extractor = new MockExtractor((chunk) => ({
      entities: [
        {
          name: 'TypeScript',
          type: 'Technology',
          aliases: [],
          source_chunk_ids: [chunk.id],
        },
        {
          name: 'JavaScript',
          type: 'Technology',
          aliases: [],
          source_chunk_ids: [chunk.id],
        },
      ],
      relations: [
        {
          subject_name: 'TypeScript',
          subject_type: 'Technology',
          predicate: 'EXTENDS',
          object_name: 'JavaScript',
          object_type: 'Technology',
        },
      ],
    }));
    const result = await ingestChunks([makeChunk()], store, extractor, provider);
    expect(result.entities).toBe(2);
    expect(result.relations).toBe(1);
  });

  it('calls upsertEntities and upsertRelations on the store', async () => {
    const store = makeMemoryStore();
    const upsertEntitiesSpy = vi.spyOn(store, 'upsertEntities');
    const upsertRelationsSpy = vi.spyOn(store, 'upsertRelations');
    const extractor = new MockExtractor();
    await ingestChunks([makeChunk()], store, extractor, provider);
    expect(upsertEntitiesSpy).toHaveBeenCalledOnce();
    expect(upsertRelationsSpy).not.toHaveBeenCalled(); // no relations from default mock
  });
});
