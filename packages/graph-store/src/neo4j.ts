import neo4j, { type Driver } from 'neo4j-driver';
import type { GraphStore, GraphStoreStats } from './types.js';
import type { Entity, Relation } from '@aikb/core-types';
import type { GraphConfig } from '@aikb/core-config';

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
    // Constraints
    await this.run(`
      CREATE CONSTRAINT entity_id IF NOT EXISTS
      FOR (e:Entity) REQUIRE e.id IS UNIQUE
    `);
    await this.run(`
      CREATE CONSTRAINT chunk_id IF NOT EXISTS
      FOR (c:Chunk) REQUIRE c.id IS UNIQUE
    `);
    // Indexes
    await this.run(`
      CREATE INDEX entity_name IF NOT EXISTS
      FOR (e:Entity) ON (e.name)
    `);
    await this.run(`
      CREATE INDEX entity_type IF NOT EXISTS
      FOR (e:Entity) ON (e.type)
    `);
    await this.run(`
      CREATE INDEX entity_name_type IF NOT EXISTS
      FOR (e:Entity) ON (e.name, e.type)
    `);
  }

  async upsertEntities(entities: Entity[]): Promise<void> {
    if (entities.length === 0) return;
    // Use UNWIND to batch all entities into a single round-trip.
    // Arrays (aliases, source_chunk_ids) are merged as sets via list comprehension —
    // no APOC required, works on stock Neo4j 5.x.
    await this.run(
      `
      UNWIND $entities AS e
      MERGE (n:Entity { name: e.name, type: e.type })
      ON CREATE SET
        n.id               = e.id,
        n.description      = e.description,
        n.aliases          = e.aliases,
        n.source_chunk_ids = e.source_chunk_ids,
        n.created_at       = datetime()
      ON MATCH SET
        n.description      = CASE WHEN e.description IS NULL
                                  THEN n.description
                                  ELSE e.description END,
        n.aliases          = [x IN n.aliases
                                WHERE NOT x IN e.aliases] + e.aliases,
        n.source_chunk_ids = [x IN n.source_chunk_ids
                                WHERE NOT x IN e.source_chunk_ids]
                             + e.source_chunk_ids,
        n.updated_at       = datetime()
      `,
      {
        entities: entities.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          description: e.description ?? null,
          aliases: e.aliases ?? [],
          source_chunk_ids: e.source_chunk_ids,
        })),
      },
    );
  }

  async upsertRelations(relations: Relation[]): Promise<void> {
    if (relations.length === 0) return;
    // Batch all relations in a single UNWIND query.
    await this.run(
      `
      UNWIND $relations AS rel
      MATCH (subj:Entity { id: rel.subject_id })
      MATCH (obj:Entity  { id: rel.object_id  })
      MERGE (subj)-[r:RELATION { predicate: rel.predicate }]->(obj)
      ON CREATE SET
        r.id               = rel.id,
        r.source_chunk_ids = rel.source_chunk_ids,
        r.confidence       = rel.confidence,
        r.created_at       = datetime()
      ON MATCH SET
        r.source_chunk_ids = [x IN r.source_chunk_ids
                                WHERE NOT x IN rel.source_chunk_ids]
                             + rel.source_chunk_ids,
        r.updated_at       = datetime()
      `,
      {
        relations: relations.map((r) => ({
          id: r.id,
          subject_id: r.subject_id,
          object_id: r.object_id,
          predicate: r.predicate,
          source_chunk_ids: r.source_chunk_ids,
          confidence: r.confidence ?? 1.0,
        })),
      },
    );
  }

  async queryCypher(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    return this.run(cypher, params);
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getDriver(): Driver {
    if (!this.driver) {
      throw new Error(
        'Neo4jGraphStore: not connected — call connect() first',
      );
    }
    return this.driver;
  }

  private async run(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const session = this.getDriver().session({
      database: this.config.neo4j_database,
    });
    try {
      const result = await session.run(cypher, params);
      return result.records.map((r) => r.toObject() as Record<string, unknown>);
    } finally {
      await session.close();
    }
  }
}
