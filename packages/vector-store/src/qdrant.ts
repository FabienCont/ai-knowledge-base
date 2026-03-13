import { QdrantClient } from '@qdrant/js-client-rest';
import type { VectorStore, CollectionStatus, UpsertResult } from './types.js';
import { buildQdrantFilter } from './filter.js';
import type { Chunk, Query, QueryResult, ResultItem } from '@aikb/core-types';
import type { VectorConfig } from '@aikb/core-config';
import type { EmbeddingProvider } from '@aikb/core-embeddings';

/** Maximum number of points sent in a single upsert batch. */
const UPSERT_BATCH_SIZE = 500;

/** Maximum number of point IDs deleted in a single call. */
const DELETE_BATCH_SIZE = 500;

/** Maximum points returned per scroll page. */
const SCROLL_PAGE_SIZE = 256;

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly distance: 'Cosine' | 'Dot' | 'Euclid';

  constructor(config: VectorConfig) {
    this.client = new QdrantClient({
      url: config.qdrant_url,
      ...(config.qdrant_api_key !== undefined
        ? { apiKey: config.qdrant_api_key }
        : {}),
    });
    this.collectionName = config.collection_name;
    this.distance =
      config.distance === 'dot'
        ? 'Dot'
        : config.distance === 'euclid'
          ? 'Euclid'
          : 'Cosine';
  }

  async ensureCollection(dimensions: number): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === this.collectionName,
    );
    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: dimensions, distance: this.distance },
      });
    }
  }

  async upsert(chunks: Chunk[], vectors: number[][]): Promise<UpsertResult> {
    if (chunks.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }

    // Deduplicate by hash — skip chunks already in the collection
    const existingHashes = await this.getExistingHashes(
      chunks.map((c) => c.hash),
    );

    const newChunks: Chunk[] = [];
    const newVectors: number[][] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      if (!existingHashes.has(chunk.hash)) {
        newChunks.push(chunk);
        newVectors.push(vectors[i]!);
      }
    }

    const skipped = chunks.length - newChunks.length;

    // Upsert in batches
    for (let i = 0; i < newChunks.length; i += UPSERT_BATCH_SIZE) {
      const batchChunks = newChunks.slice(i, i + UPSERT_BATCH_SIZE);
      const batchVectors = newVectors.slice(i, i + UPSERT_BATCH_SIZE);

      const points = batchChunks.map((chunk, j) => ({
        // Qdrant v1.1+ accepts UUID strings as point IDs natively
        id: chunk.id,
        vector: batchVectors[j]!,
        payload: chunkToPayload(chunk),
      }));

      await this.client.upsert(this.collectionName, { points, wait: true });
    }

    return { inserted: newChunks.length, updated: 0, skipped };
  }

  async query(
    query: Query,
    embeddingProvider: EmbeddingProvider,
  ): Promise<QueryResult> {
    const start = Date.now();
    const vector = await embeddingProvider.embed(query.text);

    const results = await this.client.search(this.collectionName, {
      vector,
      limit: query.top_k,
      ...(query.min_score !== undefined
        ? { score_threshold: query.min_score }
        : {}),
      with_payload: true,
      ...(query.filter
        ? { filter: buildQdrantFilter(query.filter) }
        : {}),
    });

    const items: ResultItem[] = results.map((r) => ({
      chunk: payloadToChunk(r.payload ?? {}),
      score: r.score,
    }));

    // Results come back sorted by score (highest first) from Qdrant
    return {
      query,
      items,
      duration_ms: Date.now() - start,
    };
  }

  async status(): Promise<CollectionStatus> {
    const info = await this.client.getCollection(this.collectionName);

    // Extract dimensions from vectors config (single unnamed vector collection)
    let dimensions = 0;
    const vectorsConfig = info.config?.params?.vectors;
    if (vectorsConfig !== undefined && vectorsConfig !== null) {
      if (typeof (vectorsConfig as { size?: unknown }).size === 'number') {
        // Single unnamed vector params
        dimensions = (vectorsConfig as { size: number }).size;
      }
    }

    // Qdrant also returns 'grey' (optimisations possible but not triggered).
    // Map it to 'yellow' (not fully optimal) to fit our narrower status type.
    const rawStatus = info.status as string;
    const status: CollectionStatus['status'] =
      rawStatus === 'green'
        ? 'green'
        : rawStatus === 'red'
          ? 'red'
          : 'yellow';

    return {
      name: this.collectionName,
      vectorCount: info.points_count ?? 0,
      status,
      dimensions,
    };
  }

  async deleteBySource(sourcePrefix: string): Promise<number> {
    // Collect IDs of all points whose source_path starts with the given prefix.
    // We paginate through the collection because Qdrant has no native
    // "starts with" filter for payload text fields.
    const toDelete: (string | number)[] = [];
    let nextOffset: string | number | undefined = undefined;

    do {
      const result = await this.client.scroll(this.collectionName, {
        with_payload: ['source_path'],
        limit: SCROLL_PAGE_SIZE,
        ...(nextOffset !== undefined ? { offset: nextOffset } : {}),
      });

      for (const point of result.points) {
        const sp =
          (point.payload?.['source_path'] as string | undefined) ?? '';
        if (sp.startsWith(sourcePrefix)) {
          toDelete.push(point.id);
        }
      }

      const rawOffset = result.next_page_offset;
      nextOffset =
        rawOffset !== null && rawOffset !== undefined
          ? (rawOffset as string | number)
          : undefined;
    } while (nextOffset !== undefined);

    if (toDelete.length === 0) return 0;

    // Delete collected IDs in batches
    for (let i = 0; i < toDelete.length; i += DELETE_BATCH_SIZE) {
      await this.client.delete(this.collectionName, {
        points: toDelete.slice(i, i + DELETE_BATCH_SIZE),
        wait: true,
      });
    }

    return toDelete.length;
  }

  /**
   * Return the set of chunk hashes that are already stored in the collection.
   * Used to skip re-uploading unchanged chunks (idempotent upsert by hash).
   */
  private async getExistingHashes(hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();

    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: [{ key: 'hash', match: { any: hashes } }],
      },
      with_payload: ['hash'],
      limit: hashes.length,
    });

    const found = new Set<string>();
    for (const point of result.points) {
      const hash = point.payload?.['hash'];
      if (typeof hash === 'string') {
        found.add(hash);
      }
    }
    return found;
  }
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

/**
 * Serialise a Chunk into the flat key-value payload stored in Qdrant.
 * Storing the full `content` makes search results self-contained.
 */
function chunkToPayload(chunk: Chunk): Record<string, unknown> {
  return {
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
  };
}

/** Reconstruct a Chunk from a Qdrant point payload. */
export function payloadToChunk(payload: Record<string, unknown>): Chunk {
  return {
    id: payload['chunk_id'] as string,
    document_id: payload['document_id'] as string,
    source_path: payload['source_path'] as string,
    content: payload['content'] as string,
    hash: payload['hash'] as string,
    index: payload['index'] as number,
    line_start:
      typeof payload['line_start'] === 'number'
        ? payload['line_start']
        : undefined,
    line_end:
      typeof payload['line_end'] === 'number'
        ? payload['line_end']
        : undefined,
    language:
      typeof payload['language'] === 'string'
        ? payload['language']
        : undefined,
    metadata:
      payload['metadata'] !== undefined && payload['metadata'] !== null
        ? (payload['metadata'] as Record<string, unknown>)
        : undefined,
  };
}
