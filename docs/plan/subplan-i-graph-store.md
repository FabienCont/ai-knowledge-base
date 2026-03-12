# ⬜ Subplan I — Graph Store + LLM Extract

## Overview

Implement the graph store package (`@aikb/graph-store`) which includes a Neo4j adapter and an LLM-powered entity/relation extractor. The extractor processes text chunks, identifies entities and relationships using structured LLM output, and stores them in Neo4j with full audit trails linking every fact back to its source chunk.

---

## Dependencies

- Subplan A (monorepo foundation)
- Subplan B (`@aikb/core-types` — `Entity`, `Relation`, `Chunk`)
- Subplan C (`@aikb/core-config` — `GraphConfig`, `LLMConfig`)
- Subplan E (`@aikb/core-chunking` — input chunks)
- Subplan F (`@aikb/core-embeddings` — entity resolution via similarity)

---

## Detailed Tasks

### I1 ⬜ Package scaffold

- Package name: `@aikb/graph-store`
- Runtime dependencies:
  - `@aikb/core-types workspace:*`
  - `@aikb/core-config workspace:*`
  - `@aikb/core-embeddings workspace:*`
  - `neo4j-driver ^5.19`
  - `zod ^3.22`
  - `openai ^4.0` (optional, for LLM extraction)

### I2 ⬜ GraphStore interface

```ts
// src/types.ts
import type { Entity, Relation, Chunk } from '@aikb/core-types';

export interface GraphStoreStats {
  entityCount: number;
  relationCount: number;
  chunkCount: number;
}

export interface GraphStore {
  /** Open Neo4j connection */
  connect(): Promise<void>;

  /**
   * Create indexes and constraints if they don't exist.
   * Idempotent.
   */
  ensureSchema(): Promise<void>;

  /**
   * Upsert entities (merge by name + type).
   * Updates aliases and description if already present.
   */
  upsertEntities(entities: Entity[]): Promise<void>;

  /**
   * Upsert relations (merge by subject + predicate + object).
   * Adds source_chunk_ids to existing relations.
   */
  upsertRelations(relations: Relation[]): Promise<void>;

  /** Execute a raw Cypher query and return records */
  queryCypher(cypher: string, params?: Record<string, unknown>): Promise<Record<string, unknown>[]>;

  /** Return store statistics */
  stats(): Promise<GraphStoreStats>;

  /** Close Neo4j connection */
  close(): Promise<void>;
}
```

### I3 ⬜ Neo4jGraphStore implementation

```ts
// src/neo4j.ts
import neo4j, { Driver, Session } from 'neo4j-driver';
import type { GraphStore, GraphStoreStats } from './types.js';
import type { Entity, Relation } from '@aikb/core-types';

export class Neo4jGraphStore implements GraphStore {
  private driver: Driver | null = null;
  private readonly config: GraphConfig;

  constructor(config: GraphConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.driver = neo4j.driver(
      this.config.neo4j_uri,
      neo4j.auth.basic(this.config.neo4j_user, this.config.neo4j_password),
    );
    await this.driver.verifyConnectivity();
  }

  async ensureSchema(): Promise<void> {
    await this.run(`
      CREATE CONSTRAINT entity_id IF NOT EXISTS
      FOR (e:Entity) REQUIRE e.id IS UNIQUE
    `);
    await this.run(`
      CREATE INDEX entity_name IF NOT EXISTS
      FOR (e:Entity) ON (e.name)
    `);
    await this.run(`
      CREATE INDEX entity_type IF NOT EXISTS
      FOR (e:Entity) ON (e.type)
    `);
    await this.run(`
      CREATE CONSTRAINT chunk_id IF NOT EXISTS
      FOR (c:Chunk) REQUIRE c.id IS UNIQUE
    `);
  }

  async upsertEntities(entities: Entity[]): Promise<void> {
    for (const entity of entities) {
      await this.run(`
        MERGE (e:Entity { name: $name, type: $type })
        ON CREATE SET
          e.id = $id,
          e.description = $description,
          e.aliases = $aliases,
          e.source_chunk_ids = $source_chunk_ids,
          e.created_at = datetime()
        ON MATCH SET
          e.description = COALESCE($description, e.description),
          e.aliases = apoc.coll.toSet(e.aliases + $aliases),
          e.source_chunk_ids = apoc.coll.toSet(e.source_chunk_ids + $source_chunk_ids),
          e.updated_at = datetime()
      `, {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description ?? null,
        aliases: entity.aliases ?? [],
        source_chunk_ids: entity.source_chunk_ids,
      });
    }
  }

  async upsertRelations(relations: Relation[]): Promise<void> {
    for (const relation of relations) {
      await this.run(`
        MATCH (subj:Entity { id: $subject_id })
        MATCH (obj:Entity { id: $object_id })
        MERGE (subj)-[r:RELATION { predicate: $predicate }]->(obj)
        ON CREATE SET
          r.id = $id,
          r.source_chunk_ids = $source_chunk_ids,
          r.confidence = $confidence,
          r.created_at = datetime()
        ON MATCH SET
          r.source_chunk_ids = apoc.coll.toSet(r.source_chunk_ids + $source_chunk_ids),
          r.updated_at = datetime()
      `, {
        id: relation.id,
        subject_id: relation.subject_id,
        object_id: relation.object_id,
        predicate: relation.predicate,
        source_chunk_ids: relation.source_chunk_ids,
        confidence: relation.confidence ?? 1.0,
      });
    }
  }

  async queryCypher(cypher: string, params?: Record<string, unknown>) {
    const session = this.driver!.session({ database: this.config.neo4j_database });
    try {
      const result = await session.run(cypher, params);
      return result.records.map(r => r.toObject());
    } finally {
      await session.close();
    }
  }

  async stats(): Promise<GraphStoreStats> {
    const [entities, relations, chunks] = await Promise.all([
      this.run('MATCH (e:Entity) RETURN count(e) AS n'),
      this.run('MATCH ()-[r:RELATION]->() RETURN count(r) AS n'),
      this.run('MATCH (c:Chunk) RETURN count(c) AS n'),
    ]);
    return {
      entityCount: Number(entities[0]?.['n'] ?? 0),
      relationCount: Number(relations[0]?.['n'] ?? 0),
      chunkCount: Number(chunks[0]?.['n'] ?? 0),
    };
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
  }

  private async run(cypher: string, params?: Record<string, unknown>) {
    const session = this.driver!.session({ database: this.config.neo4j_database });
    try {
      const result = await session.run(cypher, params);
      return result.records.map(r => r.toObject());
    } finally {
      await session.close();
    }
  }
}
```

### I4 ⬜ LLM Extractor interface

```ts
// src/extractor/types.ts
import type { Entity, Relation, Chunk } from '@aikb/core-types';

export interface ExtractionResult {
  entities: Omit<Entity, 'id'>[];
  relations: Array<{
    subject_name: string;
    subject_type: string;
    predicate: string;
    object_name: string;
    object_type: string;
    confidence?: number;
  }>;
}

export interface Extractor {
  /**
   * Extract entities and relations from a chunk of text.
   * Relations use names (not IDs) — caller resolves IDs after entity upsert.
   */
  extractFromChunk(chunk: Chunk): Promise<ExtractionResult>;

  /**
   * Resolve entity names to existing entities (by embedding similarity).
   * Returns candidates for deduplication.
   */
  resolveEntities(
    candidates: Omit<Entity, 'id'>[],
    store: GraphStore,
    embeddingProvider: EmbeddingProvider,
  ): Promise<Entity[]>;
}
```

### I5 ⬜ LLM extraction prompts

System prompt for entity extraction:
```
You are a knowledge extraction assistant. Extract entities and relationships from the provided text.

Rules:
- Extract named entities: people, organizations, technologies, concepts, places, events
- For each entity, identify: name, type, brief description
- For each relationship: subject, predicate (verb phrase), object
- Use consistent names (avoid duplicates with different capitalizations)
- Return JSON only, no explanation

Output schema:
{
  "entities": [
    { "name": "...", "type": "...", "description": "...", "aliases": [] }
  ],
  "relations": [
    { "subject_name": "...", "subject_type": "...", "predicate": "...", "object_name": "...", "object_type": "..." }
  ]
}
```

Zod schema for validating LLM output:
```ts
const LLMExtractionSchema = z.object({
  entities: z.array(z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    description: z.string().optional(),
    aliases: z.array(z.string()).optional().default([]),
  })),
  relations: z.array(z.object({
    subject_name: z.string(),
    subject_type: z.string(),
    predicate: z.string(),
    object_name: z.string(),
    object_type: z.string(),
    confidence: z.number().min(0).max(1).optional(),
  })),
});
```

### I6 ⬜ OpenAIExtractor implementation

```ts
// src/extractor/openai.ts
export class OpenAIExtractor implements Extractor {
  constructor(private readonly config: LLMConfig) {}

  async extractFromChunk(chunk: Chunk): Promise<ExtractionResult> {
    const client = new OpenAI({ apiKey: this.config.api_key, baseURL: this.config.base_url });
    const response = await client.chat.completions.create({
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.max_tokens,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: `Extract entities and relations from:\n\n${chunk.content}` },
      ],
      response_format: { type: 'json_object' },
    });
    const raw = JSON.parse(response.choices[0]!.message.content!);
    return LLMExtractionSchema.parse(raw);
  }
}
```

### I7 ⬜ Entity resolution

```ts
// src/extractor/resolution.ts
export async function resolveEntities(
  candidates: Omit<Entity, 'id'>[],
  store: GraphStore,
  embeddingProvider: EmbeddingProvider,
  similarityThreshold = 0.92,
): Promise<Entity[]> {
  // 1. Get existing entities from Neo4j
  // 2. Embed candidate names
  // 3. For each candidate, find the nearest existing entity by cosine similarity
  // 4. If similarity > threshold → merge with existing (add aliases)
  // 5. Otherwise → create new entity with fresh UUID
}
```

### I8 ⬜ Ingestion pipeline

```ts
// src/ingest.ts
export async function ingestChunks(
  chunks: Chunk[],
  store: GraphStore,
  extractor: Extractor,
  embeddingProvider: EmbeddingProvider,
): Promise<{ entities: number; relations: number }> {
  let totalEntities = 0;
  let totalRelations = 0;

  for (const chunk of chunks) {
    const extraction = await extractor.extractFromChunk(chunk);
    // Resolve entities (dedup via embedding similarity)
    const entities = await extractor.resolveEntities(
      extraction.entities.map(e => ({ ...e, source_chunk_ids: [chunk.id] })),
      store,
      embeddingProvider,
    );
    // Upsert entities
    await store.upsertEntities(entities);
    // Map relation names → entity IDs
    const relations = mapRelations(extraction.relations, entities, chunk.id);
    await store.upsertRelations(relations);
    totalEntities += entities.length;
    totalRelations += relations.length;
  }

  return { entities: totalEntities, relations: totalRelations };
}
```

### I9 ⬜ Docker Compose update

Add Neo4j service to `docker/docker-compose.yml`:

```yaml
  neo4j:
    image: neo4j:5-community
    container_name: aikb-neo4j
    ports:
      - "7474:7474"   # HTTP (Browser)
      - "7687:7687"   # Bolt
    volumes:
      - neo4j_data:/data
    environment:
      NEO4J_AUTH: neo4j/password
      NEO4J_PLUGINS: '["apoc"]'
    restart: unless-stopped

volumes:
  neo4j_data:
```

### I10 ⬜ Integration tests

Tag as `@integration`, skip without `NEO4J_URI` env var.

- Ingest 3 small text files → verify expected entity and relation counts
- Verify `queryCypher('MATCH (e:Entity) RETURN e')` returns results
- Verify entity deduplication (same entity in two chunks → one node)
- Verify `stats()` returns correct counts after ingestion
- Verify re-ingesting same chunks doesn't duplicate nodes/edges

---

## File Structure

```
packages/graph-store/
├── src/
│   ├── index.ts          ← exports createGraphStore, ingestChunks, Neo4jGraphStore
│   ├── types.ts          ← GraphStore interface, GraphStoreStats
│   ├── neo4j.ts          ← Neo4jGraphStore implementation
│   ├── ingest.ts         ← ingestChunks pipeline
│   ├── extractor/
│   │   ├── types.ts      ← Extractor interface, ExtractionResult
│   │   ├── openai.ts     ← OpenAIExtractor
│   │   ├── mock.ts       ← MockExtractor for tests
│   │   └── resolution.ts ← resolveEntities
│   └── __tests__/
│       ├── extractor.unit.test.ts
│       └── neo4j.integration.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key APIs / Interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `createGraphStore()` | `async function` | Factory — reads config, returns store |
| `GraphStore` | interface | Store contract |
| `Neo4jGraphStore` | class | Neo4j implementation |
| `Extractor` | interface | LLM extractor contract |
| `OpenAIExtractor` | class | OpenAI-based extractor |
| `MockExtractor` | class | Deterministic mock for tests |
| `ingestChunks(...)` | `async function` | Full ingestion pipeline |

---

## Acceptance Criteria

- [ ] `pnpm --filter @aikb/graph-store build` succeeds
- [ ] `pnpm --filter @aikb/graph-store test` passes unit tests without Neo4j
- [ ] Integration tests pass when `NEO4J_URI` is set and Neo4j is running
- [ ] Ingest 3 files → verify graph has expected entity and relation nodes
- [ ] Re-ingestion of same chunks doesn't create duplicate nodes
- [ ] `queryCypher` executes arbitrary Cypher and returns results
- [ ] LLM extraction result is validated with Zod (invalid LLM output throws)

---

## Notes for Implementers

- APOC procedures (used for `apoc.coll.toSet`) must be installed in Neo4j. The Docker Compose config handles this via `NEO4J_PLUGINS`.
- If APOC is not available, implement the dedup logic in application code instead of Cypher.
- The `NullExtractor` (returns empty result) is a useful fallback when `config.llm.provider === 'none'`.
- Entity resolution via embedding similarity adds latency — consider batching entity name lookups.
- Keep extraction prompts in a separate `prompts.ts` file so they can be tuned without touching logic.
- For relation type consistency, consider a controlled vocabulary of predicates (`USES`, `DEPENDS_ON`, `AUTHORED_BY`, `PART_OF`, etc.) in the system prompt.
