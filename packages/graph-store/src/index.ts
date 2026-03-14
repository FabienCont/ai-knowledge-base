import { getConfig } from '@aikb/core-config';
import { Neo4jGraphStore } from './neo4j.js';
import type { GraphStore } from './types.js';
import { NullExtractor } from './extractor/null.js';
import { OpenAIExtractor } from './extractor/openai.js';
import { OllamaExtractor } from './extractor/ollama.js';
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
 *
 * - `provider: 'none'`   → NullExtractor (no LLM, returns empty results)
 * - `provider: 'openai'` → OpenAIExtractor (requires `api_key`)
 * - `provider: 'ollama'` → OllamaExtractor (uses local Ollama /v1 API)
 */
export async function createExtractor(): Promise<Extractor> {
  const config = await getConfig();
  switch (config.llm.provider) {
    case 'none':
      return new NullExtractor();
    case 'ollama':
      return new OllamaExtractor(config.llm);
    case 'openai':
    default:
      return new OpenAIExtractor(config.llm);
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { Neo4jGraphStore } from './neo4j.js';
export type { GraphStore, GraphStoreStats } from './types.js';

export { ingestChunks } from './ingest.js';
export type { IngestResult } from './ingest.js';

export { OpenAIExtractor } from './extractor/openai.js';
export { OllamaExtractor } from './extractor/ollama.js';
export { MockExtractor } from './extractor/mock.js';
export { NullExtractor } from './extractor/null.js';
export { resolveEntities } from './extractor/resolution.js';
export type { Extractor, ExtractionResult, EntityCandidate, RelationCandidate, LLMExtraction } from './extractor/types.js';
export { LLMExtractionSchema } from './extractor/types.js';
export { EXTRACTION_SYSTEM_PROMPT } from './extractor/prompts.js';
