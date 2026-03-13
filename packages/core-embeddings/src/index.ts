// Types
export type { EmbeddingProvider } from './types.js';

// Registry
export {
  MODEL_REGISTRY,
  DEFAULT_MODEL,
  getModelInfo,
} from './registry.js';
export type { ModelInfo } from './registry.js';

// Factory
export { createEmbeddingProvider } from './factory.js';

// Providers
export { LocalHFProvider } from './providers/local-hf.js';
export { OpenAIProvider } from './providers/openai.js';
export { OllamaProvider } from './providers/ollama.js';
export { MockEmbeddingProvider } from './providers/mock.js';

// Cache
export {
  makeCacheKey,
  SqliteEmbeddingCache,
  CachedEmbeddingProvider,
} from './cache.js';
export type { EmbeddingCache } from './cache.js';
