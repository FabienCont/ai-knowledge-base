import type { EmbeddingProvider } from '@aikb/core-embeddings';
import type { Entity, Chunk } from '@aikb/core-types';
import type { Extractor, ExtractionResult, EntityCandidate } from './types.js';
import { resolveEntities } from './resolution.js';
import type { GraphStore } from '../types.js';

/**
 * Deterministic mock extractor for unit tests.
 *
 * By default it returns a fixed single entity and no relations so tests can
 * assert something meaningful without needing a real LLM.  You can supply a
 * custom `produce` function to control the output per chunk.
 */
export class MockExtractor implements Extractor {
  private readonly produce: (chunk: Chunk) => ExtractionResult;

  constructor(produce?: (chunk: Chunk) => ExtractionResult) {
    this.produce = produce ?? defaultProduce;
  }

  extractFromChunk(chunk: Chunk): Promise<ExtractionResult> {
    return Promise.resolve(this.produce(chunk));
  }

  resolveEntities(
    candidates: EntityCandidate[],
    store: GraphStore,
    embeddingProvider: EmbeddingProvider,
  ): Promise<Entity[]> {
    return resolveEntities(candidates, store, embeddingProvider);
  }
}

function defaultProduce(chunk: Chunk): ExtractionResult {
  return {
    entities: [
      {
        name: `Entity from ${chunk.source_path}`,
        type: 'Concept',
        description: `Extracted from chunk ${chunk.id}`,
        aliases: [],
        source_chunk_ids: [chunk.id],
      },
    ],
    relations: [],
  };
}
