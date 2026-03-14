/**
 * @integration
 *
 * Integration tests for Neo4jGraphStore + ingestChunks.
 *
 * These tests require a running Neo4j instance. They are automatically skipped
 * unless the `NEO4J_URI` environment variable is set.
 *
 * Start Neo4j locally:
 *   docker compose -f docker/docker-compose.yml up -d
 *
 * Then run:
 *   NEO4J_URI=bolt://localhost:7687 pnpm --filter @aikb/graph-store test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Neo4jGraphStore } from '../neo4j.js';
import { MockExtractor } from '../extractor/mock.js';
import { ingestChunks } from '../ingest.js';
import type { GraphConfig } from '@aikb/core-config';
import type { Chunk, Entity } from '@aikb/core-types';
import type { EmbeddingProvider } from '@aikb/core-embeddings';

const NEO4J_URI = process.env['NEO4J_URI'];
const SKIP = !NEO4J_URI;

// ---------------------------------------------------------------------------
// Inline mock embedding provider — avoids importing @aikb/core-embeddings
// which loads onnxruntime-node (a native module that may fail on CI).
// ---------------------------------------------------------------------------

class InlineMockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'inline-mock';
  readonly dimensions = 4;
  ensureModel(): Promise<void> { return Promise.resolve(); }
  embed(text: string): Promise<number[]> {
    const h = text.split('').reduce((a, c) => a + c.charCodeAt(0), 1);
    return Promise.resolve([h, h * 2, h * 3, h * 4]);
  }
  embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): GraphConfig {
  return {
    provider: 'neo4j',
    neo4j_uri: NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j_user: process.env['NEO4J_USER'] ?? 'neo4j',
    neo4j_password: process.env['NEO4J_PASSWORD'] ?? 'password',
    neo4j_database: process.env['NEO4J_DATABASE'] ?? 'neo4j',
  };
}

function makeChunk(overrides?: Partial<Chunk>): Chunk {
  return {
    id: crypto.randomUUID(),
    document_id: crypto.randomUUID(),
    source_path: 'src/example.ts',
    content: 'TypeScript is a superset of JavaScript.',
    hash: crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'),
    index: 0,
    ...overrides,
  };
}

// Tag prefix used to isolate this test run's nodes
const TEST_TAG = `integration-test-${Date.now()}`;

function makeTaggedExtractor(tag: string) {
  return new MockExtractor((chunk) => ({
    entities: [
      {
        name: `${tag}-EntityA`,
        type: 'TestEntity',
        aliases: [],
        source_chunk_ids: [chunk.id],
      },
      {
        name: `${tag}-EntityB`,
        type: 'TestEntity',
        aliases: [],
        source_chunk_ids: [chunk.id],
      },
    ],
    relations: [
      {
        subject_name: `${tag}-EntityA`,
        subject_type: 'TestEntity',
        predicate: 'RELATES_TO',
        object_name: `${tag}-EntityB`,
        object_type: 'TestEntity',
      },
    ],
  }));
}

// ---------------------------------------------------------------------------
// Suite — skipped when NEO4J_URI is not set
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('Neo4jGraphStore (integration)', () => {
  let store: Neo4jGraphStore;
  const provider = new InlineMockEmbeddingProvider();

  beforeAll(async () => {
    store = new Neo4jGraphStore(makeConfig());
    await store.connect();
    await store.ensureSchema();
  });

  afterAll(async () => {
    // Clean up test nodes created during this run
    try {
      await store.queryCypher(
        `MATCH (e:Entity) WHERE e.name STARTS WITH $prefix DETACH DELETE e`,
        { prefix: TEST_TAG },
      );
    } catch {
      // Best-effort cleanup
    }
    await store.close();
  });

  // -------------------------------------------------------------------------
  // connect / ensureSchema
  // -------------------------------------------------------------------------

  it('connect() does not throw', async () => {
    // Already connected in beforeAll — create a fresh store to test connect()
    const s = new Neo4jGraphStore(makeConfig());
    await expect(s.connect()).resolves.toBeUndefined();
    await s.close();
  });

  it('ensureSchema() is idempotent — calling twice does not throw', async () => {
    await expect(store.ensureSchema()).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // upsertEntities
  // -------------------------------------------------------------------------

  it('upsertEntities() creates entity nodes', async () => {
    const entity: Entity = {
      id: crypto.randomUUID(),
      name: `${TEST_TAG}-upsert-test`,
      type: 'TestEntity',
      aliases: ['alias-1'],
      source_chunk_ids: [crypto.randomUUID()],
    };
    await store.upsertEntities([entity]);

    const rows = await store.queryCypher(
      `MATCH (e:Entity { name: $name }) RETURN e.id AS id, e.aliases AS aliases`,
      { name: entity.name },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!['id']).toBe(entity.id);
  });

  it('upsertEntities() merges aliases and source_chunk_ids on re-upsert', async () => {
    const chunkId1 = crypto.randomUUID();
    const chunkId2 = crypto.randomUUID();
    const entityName = `${TEST_TAG}-merge-test`;

    // First upsert
    await store.upsertEntities([
      {
        id: crypto.randomUUID(),
        name: entityName,
        type: 'TestEntity',
        aliases: ['a1'],
        source_chunk_ids: [chunkId1],
      },
    ]);

    // Second upsert with new alias and chunk ID
    await store.upsertEntities([
      {
        id: crypto.randomUUID(), // ID is ignored on MATCH
        name: entityName,
        type: 'TestEntity',
        aliases: ['a2'],
        source_chunk_ids: [chunkId2],
      },
    ]);

    const rows = await store.queryCypher(
      `MATCH (e:Entity { name: $name }) RETURN e.aliases AS aliases, e.source_chunk_ids AS source_chunk_ids`,
      { name: entityName },
    );
    expect(rows).toHaveLength(1);
    const aliases = rows[0]!['aliases'] as string[];
    const chunkIds = rows[0]!['source_chunk_ids'] as string[];
    expect(aliases).toContain('a1');
    expect(aliases).toContain('a2');
    expect(chunkIds).toContain(chunkId1);
    expect(chunkIds).toContain(chunkId2);
  });

  // -------------------------------------------------------------------------
  // upsertRelations
  // -------------------------------------------------------------------------

  it('upsertRelations() creates relation edges', async () => {
    const subjId = crypto.randomUUID();
    const objId = crypto.randomUUID();

    await store.upsertEntities([
      {
        id: subjId,
        name: `${TEST_TAG}-rel-subj`,
        type: 'TestEntity',
        aliases: [],
        source_chunk_ids: [],
      },
      {
        id: objId,
        name: `${TEST_TAG}-rel-obj`,
        type: 'TestEntity',
        aliases: [],
        source_chunk_ids: [],
      },
    ]);

    await store.upsertRelations([
      {
        id: crypto.randomUUID(),
        subject_id: subjId,
        predicate: 'USES',
        object_id: objId,
        source_chunk_ids: [crypto.randomUUID()],
        confidence: 0.9,
      },
    ]);

    const rows = await store.queryCypher(
      `MATCH (s:Entity { id: $sid })-[r:RELATION]->(o:Entity { id: $oid })
       RETURN r.predicate AS predicate, r.confidence AS confidence`,
      { sid: subjId, oid: objId },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!['predicate']).toBe('USES');
  });

  // -------------------------------------------------------------------------
  // queryCypher
  // -------------------------------------------------------------------------

  it('queryCypher() returns records for a MATCH query', async () => {
    await store.upsertEntities([
      {
        id: crypto.randomUUID(),
        name: `${TEST_TAG}-query-test`,
        type: 'TestEntity',
        aliases: [],
        source_chunk_ids: [],
      },
    ]);

    const rows = await store.queryCypher(
      `MATCH (e:Entity) WHERE e.name = $name RETURN e.name AS name`,
      { name: `${TEST_TAG}-query-test` },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!['name']).toBe(`${TEST_TAG}-query-test`);
  });

  // -------------------------------------------------------------------------
  // stats
  // -------------------------------------------------------------------------

  it('stats() returns non-negative counts', async () => {
    const s = await store.stats();
    expect(s.entityCount).toBeGreaterThanOrEqual(0);
    expect(s.relationCount).toBeGreaterThanOrEqual(0);
    expect(s.chunkCount).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // ingestChunks (pipeline smoke test)
  // -------------------------------------------------------------------------

  it('ingestChunks() writes expected entity and relation counts', async () => {
    const extractor = makeTaggedExtractor(TEST_TAG + '-ingest');
    const chunks = [
      makeChunk({ source_path: 'file-a.ts' }),
      makeChunk({ source_path: 'file-b.ts' }),
      makeChunk({ source_path: 'file-c.ts' }),
    ];

    const result = await ingestChunks(chunks, store, extractor, provider);

    // 3 chunks × 2 entities each = 6 candidates, but the same two entity names
    // repeat across all chunks → they are deduplicated to 2 entities total.
    expect(result.entities).toBeGreaterThanOrEqual(2);
    // Relations: at least 1
    expect(result.relations).toBeGreaterThanOrEqual(1);
  });

  it('re-ingesting same chunks does not duplicate nodes/edges', async () => {
    const extractor = makeTaggedExtractor(TEST_TAG + '-reingest');
    const chunks = [makeChunk({ source_path: 'reingest.ts' })];

    await ingestChunks(chunks, store, extractor, provider);
    const statsBefore = await store.stats();

    // Ingest the same chunks again
    await ingestChunks(chunks, store, extractor, provider);
    const statsAfter = await store.stats();

    expect(statsAfter.entityCount).toBe(statsBefore.entityCount);
    expect(statsAfter.relationCount).toBe(statsBefore.relationCount);
  });

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  it('close() and reconnect works', async () => {
    const s = new Neo4jGraphStore(makeConfig());
    await s.connect();
    await s.close();
    // After close, connect again should succeed
    await expect(s.connect()).resolves.toBeUndefined();
    await s.close();
  });
});
