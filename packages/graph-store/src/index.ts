import { getConfig } from '@aikb/core-config';
import { Neo4jGraphStore } from './neo4j.js';
import type { GraphStore } from './types.js';
import { NullExtractor } from './extractor/null.js';
import { OpenAIExtractor } from './extractor/openai.js';
import type { Extractor } from './extractor/types.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a graph store from the current application config. */
export async function createGraphStore(): Promise<GraphStore> {
  const config = await getConfig();
  return new Neo4jGraphStore(config.graph);
}

/**
 * Create an extractor from the current application config.
 * Returns a NullExtractor when `config.llm.provider === 'none'`.
 */
export async function createExtractor(): Promise<Extractor> {
  const config = await getConfig();
  if (config.llm.provider === 'none') {
    return new NullExtractor();
  }
  return new OpenAIExtractor(config.llm);
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { Neo4jGraphStore } from './neo4j.js';
export type { GraphStore, GraphStoreStats } from './types.js';

export { ingestChunks } from './ingest.js';
export type { IngestResult } from './ingest.js';

export { OpenAIExtractor } from './extractor/openai.js';
export { MockExtractor } from './extractor/mock.js';
export { NullExtractor } from './extractor/null.js';
export { resolveEntities } from './extractor/resolution.js';
export type { Extractor, ExtractionResult, EntityCandidate, RelationCandidate, LLMExtraction } from './extractor/types.js';
export { LLMExtractionSchema } from './extractor/types.js';
export { EXTRACTION_SYSTEM_PROMPT } from './extractor/prompts.js';
