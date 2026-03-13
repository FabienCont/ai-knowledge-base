import OpenAI from 'openai';
import type { EmbeddingProvider } from '../types.js';

/** Mapping of supported OpenAI embedding models to their output dimensions. */
const SUPPORTED_MODELS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * Embedding provider backed by the OpenAI Embeddings API.
 * Requires an `OPENAI_API_KEY`; a custom `baseUrl` can be provided
 * to target Azure OpenAI or any OpenAI-compatible endpoint.
 *
 * The `openai` package must be installed (listed in `optionalDependencies`).
 */
export class OpenAIProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions: number;

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    apiKey: string,
    model = 'text-embedding-3-small',
    baseUrl?: string,
  ) {
    this.model = model;
    this.dimensions = SUPPORTED_MODELS[model] ?? 1536;
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
  }

  /** No-op — OpenAI is a remote API with no local model to download. */
  async ensureModel(): Promise<void> {}

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    const first = response.data[0];
    if (!first) {
      throw new Error(`OpenAI returned no embedding for model "${this.model}"`);
    }
    return first.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map((d) => d.embedding);
  }
}
