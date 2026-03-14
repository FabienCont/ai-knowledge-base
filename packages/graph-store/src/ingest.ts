import type { Chunk, Relation } from '@aikb/core-types';
import type { EmbeddingProvider } from '@aikb/core-embeddings';
import type { GraphStore } from './types.js';
import type { Extractor, RelationCandidate } from './extractor/types.js';

export interface IngestResult {
  entities: number;
  relations: number;
}

/**
 * Full ingestion pipeline.
 *
 * For each chunk:
 * 1. Extract raw entities and relations using the extractor.
 * 2. Resolve entity candidates (dedup via embedding similarity).
 * 3. Upsert resolved entities into the graph store.
 * 4. Map relation candidate names → resolved entity IDs.
 * 5. Upsert relations.
 *
 * @param chunks            Chunks to ingest.
 * @param store             Graph store to write to.
 * @param extractor         LLM extractor (use MockExtractor / NullExtractor in tests).
 * @param embeddingProvider Used by entity resolution.
 */
export async function ingestChunks(
  chunks: Chunk[],
  store: GraphStore,
  extractor: Extractor,
  embeddingProvider: EmbeddingProvider,
): Promise<IngestResult> {
  let totalEntities = 0;
  let totalRelations = 0;

  for (const chunk of chunks) {
    const extraction = await extractor.extractFromChunk(chunk);

    if (extraction.entities.length === 0) continue;

    // Attach the current chunk ID to every extracted entity candidate
    const candidates = extraction.entities.map((e) => ({
      ...e,
      source_chunk_ids: Array.from(
        new Set([...e.source_chunk_ids, chunk.id]),
      ),
    }));

    // Resolve candidates (dedup + assign IDs)
    const entities = await extractor.resolveEntities(
      candidates,
      store,
      embeddingProvider,
    );

    await store.upsertEntities(entities);

    // Map relation names → resolved entity IDs
    const relations = mapRelations(extraction.relations, entities, chunk.id);
    if (relations.length > 0) {
      await store.upsertRelations(relations);
    }

    totalEntities += entities.length;
    totalRelations += relations.length;
  }

  return { entities: totalEntities, relations: totalRelations };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Translate relation candidates (which use entity names) into full Relation
 * objects (which use entity IDs).  Relations whose subject or object entity
 * cannot be found in `entities` are silently dropped.
 */
function mapRelations(
  candidates: RelationCandidate[],
  entities: { id: string; name: string; type: string }[],
  chunkId: string,
): Relation[] {
  const byNameType = new Map<string, string>();
  for (const e of entities) {
    byNameType.set(nameTypeKey(e.name, e.type), e.id);
  }

  const relations: Relation[] = [];
  for (const rel of candidates) {
    const subjectId = byNameType.get(
      nameTypeKey(rel.subject_name, rel.subject_type),
    );
    const objectId = byNameType.get(
      nameTypeKey(rel.object_name, rel.object_type),
    );

    if (subjectId === undefined || objectId === undefined) {
      // Entity name not resolved — skip relation
      continue;
    }

    relations.push({
      id: crypto.randomUUID(),
      subject_id: subjectId,
      predicate: rel.predicate,
      object_id: objectId,
      source_chunk_ids: [chunkId],
      confidence: rel.confidence ?? 1.0,
    });
  }
  return relations;
}

function nameTypeKey(name: string, type: string): string {
  return `${name.toLowerCase()}::${type.toLowerCase()}`;
}
