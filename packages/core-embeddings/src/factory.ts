import type { EmbeddingConfig } from '@aikb/core-config';
import { LocalHFProvider } from './providers/local-hf.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenAIProvider } from './providers/openai.js';
import type { EmbeddingProvider } from './types.js';

/**
 * Build an {@link EmbeddingProvider} from the given config.
 *
 * - `provider: 'local'` (default) — {@link LocalHFProvider}: local ONNX model via
 *   `@huggingface/transformers`, no API key required.
 * - `provider: 'openai'` — {@link OpenAIProvider}: requires `openai_api_key`.
 * - `provider: 'ollama'` — {@link OllamaProvider}: requires a running Ollama server.
 *
 * @throws {Error} if `provider === 'openai'` and `openai_api_key` is missing.
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai': {
      if (!config.openai_api_key) {
        throw new Error('openai_api_key is required when provider is "openai"');
      }
      return new OpenAIProvider(
        config.openai_api_key,
        config.model,
        config.openai_base_url,
      );
    }
    case 'ollama': {
      return new OllamaProvider(
        config.model,
        config.ollama_base_url,
        config.dimensions,
      );
    }
    case 'local':
    default: {
      return new LocalHFProvider(config.model);
    }
  }
}
