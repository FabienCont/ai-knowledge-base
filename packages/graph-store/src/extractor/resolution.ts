import type { Entity } from '@aikb/core-types';
import type { EmbeddingProvider } from '@aikb/core-embeddings';
import type { EntityCandidate } from './types.js';
import type { GraphStore } from '../types.js';

/**
 * Cosine similarity between two vectors.
 * Both vectors must have the same length.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Resolve entity name candidates to full Entity objects.
 *
 * Algorithm:
 * 1. Fetch all existing entities from the graph store.
 * 2. Embed candidate names and existing entity names in batches.
 * 3. For each candidate, find the nearest existing entity by cosine similarity.
 * 4. If similarity >= `similarityThreshold` → merge (existing entity gets the
 *    candidate added as an alias and its source_chunk_ids extended).
 * 5. Otherwise → create a new Entity with a fresh UUID.
 *
 * @param candidates        Entities extracted from the current chunk (no ID yet).
 * @param store             Graph store used to look up existing entities.
 * @param embeddingProvider Provider used to compute name embeddings.
 * @param similarityThreshold Minimum cosine similarity to consider a match (0–1).
 */
export async function resolveEntities(
  candidates: EntityCandidate[],
  store: GraphStore,
  embeddingProvider: EmbeddingProvider,
  similarityThreshold = 0.92,
): Promise<Entity[]> {
  if (candidates.length === 0) return [];

  // 1. Load all existing entities
  const rows = await store.queryCypher(
    'MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.type AS type, ' +
      'e.description AS description, e.aliases AS aliases, ' +
      'e.source_chunk_ids AS source_chunk_ids',
  );

  const existing: Entity[] = rows.map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    type: String(r['type'] ?? ''),
    description:
      r['description'] !== null && r['description'] !== undefined
        ? String(r['description'])
        : undefined,
    aliases: Array.isArray(r['aliases'])
      ? (r['aliases'] as string[])
      : [],
    source_chunk_ids: Array.isArray(r['source_chunk_ids'])
      ? (r['source_chunk_ids'] as string[])
      : [],
  }));

  // Fast path: no existing entities → just assign fresh IDs
  if (existing.length === 0) {
    return candidates.map((c) => ({ ...c, id: crypto.randomUUID() }));
  }

  // 2. Embed candidate names and existing entity names
  const candidateNames = candidates.map((c) => c.name);
  const existingNames = existing.map((e) => e.name);

  const [candidateVecs, existingVecs] = await Promise.all([
    embeddingProvider.embedBatch(candidateNames),
    embeddingProvider.embedBatch(existingNames),
  ]);

  // 3. Resolve each candidate
  const resolved: Entity[] = [];

  for (let ci = 0; ci < candidates.length; ci++) {
    const candidate = candidates[ci]!;
    const candidateVec = candidateVecs[ci]!;

    let bestScore = -1;
    let bestExisting: Entity | undefined;

    for (let ei = 0; ei < existing.length; ei++) {
      const score = cosineSimilarity(candidateVec, existingVecs[ei]!);
      if (score > bestScore) {
        bestScore = score;
        bestExisting = existing[ei];
      }
    }

    if (bestScore >= similarityThreshold && bestExisting !== undefined) {
      // 4. Merge: extend existing entity's aliases and source_chunk_ids
      const mergedAliases = Array.from(
        new Set([
          ...(bestExisting.aliases ?? []),
          ...(candidate.aliases ?? []),
          // If the candidate name differs from the existing name, add it as alias
          ...(candidate.name !== bestExisting.name ? [candidate.name] : []),
        ]),
      );
      const mergedChunkIds = Array.from(
        new Set([
          ...bestExisting.source_chunk_ids,
          ...candidate.source_chunk_ids,
        ]),
      );
      resolved.push({
        ...bestExisting,
        aliases: mergedAliases,
        source_chunk_ids: mergedChunkIds,
      });
    } else {
      // 5. New entity
      resolved.push({ ...candidate, id: crypto.randomUUID() });
    }
  }

  return resolved;
}
