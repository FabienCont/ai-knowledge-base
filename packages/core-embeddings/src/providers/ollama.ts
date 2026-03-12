import type { EmbeddingProvider } from '../types.js';

/**
 * Embedding provider backed by a locally running Ollama server.
 * The user is responsible for starting Ollama and pulling the desired model.
 * Uses plain `fetch` — no extra dependencies required.
 */
export class OllamaProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions: number;

  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    model = 'nomic-embed-text',
    baseUrl = 'http://localhost:11434',
    dimensions = 768,
  ) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.dimensions = dimensions;
  }

  /** No-op — the user must ensure Ollama is running with the model pulled. */
  async ensureModel(): Promise<void> {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }
    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
