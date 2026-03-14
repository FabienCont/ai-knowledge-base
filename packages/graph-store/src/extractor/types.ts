import { z } from 'zod';
import type { Entity, Chunk } from '@aikb/core-types';
import type { EmbeddingProvider } from '@aikb/core-embeddings';
import type { GraphStore } from '../types.js';

// ---------------------------------------------------------------------------
// Zod schema — validates raw LLM JSON output
// ---------------------------------------------------------------------------

export const LLMExtractionSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().min(1),
      type: z.string().min(1),
      description: z.string().optional(),
      aliases: z.array(z.string()).optional().default([]),
    }),
  ),
  relations: z.array(
    z.object({
      subject_name: z.string(),
      subject_type: z.string(),
      predicate: z.string(),
      object_name: z.string(),
      object_type: z.string(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
});

export type LLMExtraction = z.infer<typeof LLMExtractionSchema>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Candidate entity (no id yet — resolved after extraction) */
export type EntityCandidate = Omit<Entity, 'id'>;

/** Raw relation using names rather than IDs */
export interface RelationCandidate {
  subject_name: string;
  subject_type: string;
  predicate: string;
  object_name: string;
  object_type: string;
  confidence?: number;
}

export interface ExtractionResult {
  entities: EntityCandidate[];
  relations: RelationCandidate[];
}

// ---------------------------------------------------------------------------
// Extractor interface
// ---------------------------------------------------------------------------

export interface Extractor {
  /**
   * Extract entities and raw relations from a single text chunk.
   * Relations use entity names (not IDs); the caller resolves IDs after
   * entity upsert via `resolveEntities`.
   */
  extractFromChunk(chunk: Chunk): Promise<ExtractionResult>;

  /**
   * Resolve entity name candidates to full Entity objects, deduplicating
   * against existing entities in the store via embedding similarity.
   */
  resolveEntities(
    candidates: EntityCandidate[],
    store: GraphStore,
    embeddingProvider: EmbeddingProvider,
  ): Promise<Entity[]>;
}
