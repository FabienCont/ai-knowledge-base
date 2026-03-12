/**
 * Common contract for all embedding providers.
 */
export interface EmbeddingProvider {
  /** Provider identifier, e.g. 'local-hf', 'openai', 'ollama' */
  readonly name: string;
  /** Output dimension count */
  readonly dimensions: number;

  /**
   * Ensure the model is ready (download if needed).
   * Called automatically before first embed — safe to call multiple times.
   */
  ensureModel(): Promise<void>;

  /** Embed a single text string → float32 vector */
  embed(text: string): Promise<number[]>;

  /**
   * Embed multiple texts efficiently.
   * Default implementation calls embed() in parallel — providers can override
   * with a native batch API for better performance.
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}
