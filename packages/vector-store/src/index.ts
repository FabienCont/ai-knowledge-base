import { getConfig } from '@aikb/core-config';
import { QdrantVectorStore } from './qdrant.js';
import type { VectorStore } from './types.js';

/** Factory — reads config and returns a ready-to-use VectorStore. */
export async function createVectorStore(): Promise<VectorStore> {
  const config = await getConfig();
  return new QdrantVectorStore(config.vector);
}

export { QdrantVectorStore } from './qdrant.js';
export { payloadToChunk } from './qdrant.js';
export { buildQdrantFilter } from './filter.js';
export type { VectorStore, CollectionStatus, UpsertResult } from './types.js';
