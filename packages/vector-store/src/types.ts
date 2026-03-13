import type { Chunk, Query, QueryResult } from '@aikb/core-types';
import type { EmbeddingProvider } from '@aikb/core-embeddings';

export interface CollectionStatus {
  name: string;
  vectorCount: number;
  status: 'green' | 'yellow' | 'red';
  dimensions: number;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  /** Chunks whose hash already exists in the collection — not re-uploaded. */
  skipped: number;
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

  /** Semantic search: embed the query text and return top-k results. */
  query(query: Query, embeddingProvider: EmbeddingProvider): Promise<QueryResult>;

  /** Return collection status. */
  status(): Promise<CollectionStatus>;

  /**
   * Delete all points whose payload.source_path matches the given prefix.
   * Used to re-ingest a file or directory cleanly.
   * Returns the number of deleted points.
   */
  deleteBySource(sourcePrefix: string): Promise<number>;
}
