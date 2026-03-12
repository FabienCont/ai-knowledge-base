import type { AppConfig } from './schema.js';

type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/**
 * Maps environment variables to config paths and returns a deep partial
 * AppConfig populated from process.env.
 */
export function loadFromEnv(): DeepPartial<AppConfig> {
  const env = process.env;
  const result: DeepPartial<AppConfig> = {};

  // embedding.provider
  if (env['AIKB_EMBEDDING_PROVIDER']) {
    result.embedding = {
      ...result.embedding,
      provider: env['AIKB_EMBEDDING_PROVIDER'] as AppConfig['embedding']['provider'],
    };
  }

  // embedding.model
  if (env['AIKB_EMBEDDING_MODEL']) {
    result.embedding = { ...result.embedding, model: env['AIKB_EMBEDDING_MODEL'] };
  }

  // OPENAI_API_KEY → embedding.openai_api_key + llm.api_key
  if (env['OPENAI_API_KEY']) {
    result.embedding = { ...result.embedding, openai_api_key: env['OPENAI_API_KEY'] };
    result.llm = { ...result.llm, api_key: env['OPENAI_API_KEY'] };
  }

  // vector.qdrant_url
  if (env['AIKB_QDRANT_URL']) {
    result.vector = { ...result.vector, qdrant_url: env['AIKB_QDRANT_URL'] };
  }

  // vector.qdrant_api_key
  if (env['AIKB_QDRANT_API_KEY']) {
    result.vector = { ...result.vector, qdrant_api_key: env['AIKB_QDRANT_API_KEY'] };
  }

  // graph.neo4j_uri
  if (env['AIKB_NEO4J_URI']) {
    result.graph = { ...result.graph, neo4j_uri: env['AIKB_NEO4J_URI'] };
  }

  // graph.neo4j_user
  if (env['AIKB_NEO4J_USER']) {
    result.graph = { ...result.graph, neo4j_user: env['AIKB_NEO4J_USER'] };
  }

  // graph.neo4j_password
  if (env['AIKB_NEO4J_PASSWORD']) {
    result.graph = { ...result.graph, neo4j_password: env['AIKB_NEO4J_PASSWORD'] };
  }

  // llm.provider
  if (env['AIKB_LLM_PROVIDER']) {
    result.llm = {
      ...result.llm,
      provider: env['AIKB_LLM_PROVIDER'] as AppConfig['llm']['provider'],
    };
  }

  // llm.model
  if (env['AIKB_LLM_MODEL']) {
    result.llm = { ...result.llm, model: env['AIKB_LLM_MODEL'] };
  }

  // log_level
  if (env['AIKB_LOG_LEVEL']) {
    result.log_level = env['AIKB_LOG_LEVEL'] as AppConfig['log_level'];
  }

  // data_dir
  if (env['AIKB_DATA_DIR']) {
    result.data_dir = env['AIKB_DATA_DIR'];
  }

  return result;
}
