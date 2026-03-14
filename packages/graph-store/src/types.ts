import type { Entity, Relation, Chunk } from '@aikb/core-types';

export type { Entity, Relation, Chunk };

export interface GraphStoreStats {
  entityCount: number;
  relationCount: number;
  chunkCount: number;
}

export interface GraphStore {
  /** Open Neo4j connection and verify connectivity. */
  connect(): Promise<void>;

  /**
   * Create indexes and constraints if they don't exist.
   * Idempotent — safe to call multiple times.
   */
  ensureSchema(): Promise<void>;

  /**
   * Upsert entities (merge by name + type).
   * Updates aliases and description if already present.
   * Arrays (aliases, source_chunk_ids) are merged as sets — no duplicates.
   */
  upsertEntities(entities: Entity[]): Promise<void>;

  /**
   * Upsert relations (merge by subject_id + predicate + object_id).
   * Merges source_chunk_ids into existing relations.
   */
  upsertRelations(relations: Relation[]): Promise<void>;

  /** Execute a raw Cypher query and return records as plain objects. */
  queryCypher(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]>;

  /** Return store statistics (entity, relation, and chunk node counts). */
  stats(): Promise<GraphStoreStats>;

  /** Close the Neo4j connection. */
  close(): Promise<void>;
}
