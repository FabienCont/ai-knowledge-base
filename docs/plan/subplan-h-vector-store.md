# ✅ Subplan H — Vector Store

## Overview

Implement a Qdrant adapter (`@aikb/vector-store`) that provides idempotent upsert, semantic query, and collection management operations. The adapter wraps `@qdrant/js-client-rest` behind a clean interface so the rest of the codebase never imports the Qdrant client directly. A Docker Compose file makes local development trivial.

---

## Dependencies

- Subplan A (monorepo foundation)
- Subplan B (`@aikb/core-types` — `Chunk`, `QueryResult`, `ResultItem`)
- Subplan C (`@aikb/core-config` — `VectorConfig`)
- Subplan F (`@aikb/core-embeddings` — `EmbeddingProvider`)

---

## Detailed Tasks

### H1 ✅ Package scaffold

- Package name: `@aikb/vector-store`
- Runtime dependencies:
  - `@aikb/core-types workspace:*`
  - `@aikb/core-config workspace:*`
  - `@aikb/core-embeddings workspace:*`
  - `@qdrant/js-client-rest ^1.9`

### H2 ✅ VectorStore interface

```ts
// src/types.ts
import type { Chunk, Query, QueryResult } from '@aikb/core-types';

export interface CollectionStatus {
  name: string;
  vectorCount: number;
  status: 'green' | 'yellow' | 'red';
  dimensions: number;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  skipped: number;  // chunks whose hash already exists
}

export interface VectorStore {
  /**
   * Ensure the named collection exists with the correct config.
   * Idempotent — safe to call multiple times.
   */
  ensureCollection(dimensions: number): Promise<void>;

  /**
   * Upsert chunks into the collection.
   * Idempotent by chunk.hash — skips chunks already present.
   */
  upsert(chunks: Chunk[], vectors: number[][]): Promise<UpsertResult>;

  /** Semantic search: embed the query and return top-k results */
  query(query: Query, embeddingProvider: EmbeddingProvider): Promise<QueryResult>;

  /** Return collection status */
  status(): Promise<CollectionStatus>;

  /**
   * Delete all points whose payload.source_path starts with the given prefix.
   * Used to re-ingest a file or directory cleanly.
   */
  deleteBySource(sourcePrefix: string): Promise<number>;
}
```

### H3 ✅ QdrantVectorStore implementation

```ts
// src/qdrant.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import type { VectorStore, CollectionStatus, UpsertResult } from './types.js';
import type { Chunk, Query, QueryResult } from '@aikb/core-types';
import type { EmbeddingProvider } from '@aikb/core-embeddings';

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly distance: 'Cosine' | 'Dot' | 'Euclid';

  constructor(config: VectorConfig) {
    this.client = new QdrantClient({
      url: config.qdrant_url,
      apiKey: config.qdrant_api_key,
    });
    this.collectionName = config.collection_name;
    this.distance = config.distance === 'dot' ? 'Dot'
      : config.distance === 'euclid' ? 'Euclid'
      : 'Cosine';
  }

  async ensureCollection(dimensions: number): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(c => c.name === this.collectionName);
    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: dimensions, distance: this.distance },
      });
    }
  }

  async upsert(chunks: Chunk[], vectors: number[][]): Promise<UpsertResult> {
    // Build Qdrant points
    const points = chunks.map((chunk, i) => ({
      id: chunk.id,  // Qdrant v1.1+ accepts UUID strings natively
      vector: vectors[i]!,
      payload: {
        chunk_id: chunk.id,
        document_id: chunk.document_id,
        source_path: chunk.source_path,
        content: chunk.content,
        hash: chunk.hash,
        index: chunk.index,
        line_start: chunk.line_start,
        line_end: chunk.line_end,
        language: chunk.language,
        metadata: chunk.metadata,
      },
    }));

    // Check for existing hashes (skip already-upserted chunks)
    const existingHashes = await this.getExistingHashes(chunks.map(c => c.hash));
    const newPoints = points.filter((_, i) => !existingHashes.has(chunks[i]!.hash));
    const skipped = points.length - newPoints.length;

    if (newPoints.length > 0) {
      await this.client.upsert(this.collectionName, { points: newPoints, wait: true });
    }

    return { inserted: newPoints.length, updated: 0, skipped };
  }

  async query(query: Query, embeddingProvider: EmbeddingProvider): Promise<QueryResult> {
    const start = Date.now();
    const vector = await embeddingProvider.embed(query.text);
    const results = await this.client.search(this.collectionName, {
      vector,
      limit: query.top_k,
      score_threshold: query.min_score,
      with_payload: true,
      filter: query.filter ? buildQdrantFilter(query.filter) : undefined,
    });
    // Map Qdrant results → QueryResult
    const items: ResultItem[] = results.map(r => ({
      chunk: payloadToChunk(r.payload!),
      score: r.score,
    }));
    return {
      query,
      items,
      duration_ms: Date.now() - start,
    };
  }

  async status(): Promise<CollectionStatus> {
    const info = await this.client.getCollection(this.collectionName);
    return {
      name: this.collectionName,
      vectorCount: info.vectors_count ?? 0,
      status: info.status as CollectionStatus['status'],
      dimensions: info.config?.params?.vectors?.size ?? 0,
    };
  }

  async deleteBySource(sourcePrefix: string): Promise<number> {
    const result = await this.client.delete(this.collectionName, {
      filter: {
        must: [{
          key: 'source_path',
          match: { value: sourcePrefix },
        }],
      },
      wait: true,
    });
    return result.result?.deleted ?? 0;
  }
}
```

### H4 ✅ UUID to Qdrant ID mapping

Qdrant supports both string UUIDs and `uint64` IDs. Use string UUIDs (Qdrant v1.1+ supports them natively):

```ts
// Use chunk.id directly as the Qdrant point ID (it's a UUID string)
// No conversion needed — Qdrant accepts UUID strings as point IDs
```

### H5 ✅ Duplicate detection

To avoid re-embedding chunks that haven't changed:
```ts
private async getExistingHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const results = await this.client.scroll(this.collectionName, {
    filter: {
      must: [{ key: 'hash', match: { any: hashes } }],
    },
    with_payload: ['hash'],
    limit: hashes.length,
  });
  return new Set(results.points.map(p => p.payload!['hash'] as string));
}
```

### H6 ✅ Factory function

```ts
// src/index.ts
export async function createVectorStore(): Promise<VectorStore> {
  const config = await getConfig();
  return new QdrantVectorStore(config.vector);
}
```

### H7 ✅ Docker Compose

Create `docker/docker-compose.yml` (or update if it exists):

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: aikb-qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__API_KEY: ""
    restart: unless-stopped

volumes:
  qdrant_data:
```

### H8 ✅ Integration tests

`src/__tests__/qdrant.integration.test.ts`:

Tag these tests `@integration` and skip them unless `QDRANT_URL` env var is set.

- Test `ensureCollection()` creates the collection
- Test `upsert()` with mock chunks and vectors
- Test `upsert()` idempotency: same chunks upserted twice → `skipped` count == chunks.length on second call
- Test `query()` returns results in score order
- Test `deleteBySource()` removes points matching source prefix
- Test `status()` returns non-zero vector count after upsert

Unit tests (no Qdrant needed):
- Test `QdrantVectorStore` constructor maps config correctly
- Test payload serialization/deserialization round-trip

---

## File Structure

```
packages/vector-store/
├── src/
│   ├── index.ts          ← exports createVectorStore, VectorStore, QdrantVectorStore
│   ├── types.ts          ← VectorStore interface, CollectionStatus, UpsertResult
│   ├── qdrant.ts         ← QdrantVectorStore implementation
│   ├── filter.ts         ← buildQdrantFilter helper
│   └── __tests__/
│       ├── qdrant.unit.test.ts
│       └── qdrant.integration.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key APIs / Interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `createVectorStore()` | `async function` | Factory — reads config, returns store |
| `VectorStore` | interface | Store contract |
| `QdrantVectorStore` | class | Qdrant implementation |
| `CollectionStatus` | interface | Collection info |
| `UpsertResult` | interface | Result of an upsert operation |

---

## Acceptance Criteria

- [x] `pnpm --filter @aikb/vector-store build` succeeds
- [x] `pnpm --filter @aikb/vector-store test` passes unit tests without Qdrant
- [x] Integration tests pass when `QDRANT_URL` is set and Qdrant is running
- [x] Upserting the same chunks twice results in `skipped == chunks.length` on the second call
- [x] `query()` returns results sorted by score (highest first)
- [x] `deleteBySource()` removes all points for a given file
- [x] `ensureCollection()` is safe to call multiple times (idempotent)

---

## Notes for Implementers

- Always use `wait: true` on upsert/delete operations to ensure consistency before returning.
- Qdrant's string UUID support means no need for hash/conversion tricks.
- Store the full chunk `content` in the Qdrant payload so results are self-contained (no DB lookup needed).
- For large ingestion jobs (>10k chunks), batch upserts in groups of 100–500 for performance.
- The `filter` field in `Query` uses a flexible `Record<string, unknown>` — define a `buildQdrantFilter()` helper in `filter.ts` that converts common filter shapes (e.g. `{ source_path: { prefix: '...' } }`) into Qdrant filter syntax.
