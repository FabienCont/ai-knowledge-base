import type { EmbeddingProvider } from '../types.js';

/**
 * Deterministic in-memory mock provider intended for unit tests.
 * Vectors are derived from the character codes of the input text so they
 * are always the same for a given input, but do **not** represent semantic
 * meaning in any way.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly dimensions = 4;

  async ensureModel(): Promise<void> {}

  embed(text: string): Promise<number[]> {
    const h = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return Promise.resolve([h % 1, (h * 2) % 1, (h * 3) % 1, (h * 4) % 1]);
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
