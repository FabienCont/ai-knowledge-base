import type { EmbeddingProvider } from '@aikb/core-embeddings';
import type { Entity, Chunk } from '@aikb/core-types';
import type { Extractor, ExtractionResult, EntityCandidate } from './types.js';
import type { GraphStore } from '../types.js';

/**
 * No-op extractor used when `config.llm.provider === 'none'`.
 * Always returns empty entities and relations so the ingestion pipeline can
 * run without an LLM — useful for importing raw chunk metadata without
 * knowledge-graph extraction.
 */
export class NullExtractor implements Extractor {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  extractFromChunk(_chunk: Chunk): Promise<ExtractionResult> {
    return Promise.resolve({ entities: [], relations: [] });
  }

  resolveEntities(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _candidates: EntityCandidate[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _store: GraphStore,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _embeddingProvider: EmbeddingProvider,
  ): Promise<Entity[]> {
    return Promise.resolve([]);
  }
}
