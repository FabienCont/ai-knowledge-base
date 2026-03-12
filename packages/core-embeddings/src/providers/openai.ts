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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private readonly model: string;

  constructor(
    apiKey: string,
    model = 'text-embedding-3-small',
    baseUrl?: string,
  ) {
    this.model = model;
    this.dimensions = SUPPORTED_MODELS[model] ?? 1536;
    // Import openai lazily so the package is optional at the module boundary.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const { default: OpenAI } = require('openai') as typeof import('openai');
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
  }

  /** No-op — OpenAI is a remote API with no local model to download. */
  async ensureModel(): Promise<void> {}

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return (response.data[0] as { embedding: number[] }).embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return (response.data as Array<{ embedding: number[] }>).map(
      (d) => d.embedding,
    );
  }
}
