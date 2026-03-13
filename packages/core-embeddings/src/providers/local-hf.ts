import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbeddingProvider } from '../types.js';
import { DEFAULT_MODEL, getModelInfo } from '../registry.js';

/**
 * Local embedding provider using `@huggingface/transformers` (ONNX Runtime).
 * No API key required — models are auto-downloaded on first use and cached in
 * `~/.cache/huggingface/hub/` by default.
 */
export class LocalHFProvider implements EmbeddingProvider {
  readonly name = 'local-hf';
  readonly dimensions: number;

  private pipelineInstance: FeatureExtractionPipeline | null = null;
  private readonly modelId: string;

  constructor(modelId = DEFAULT_MODEL.id) {
    this.modelId = modelId;
    this.dimensions = getModelInfo(modelId)?.dimensions ?? 384;
  }

  /** Load (and optionally download) the model. Idempotent — safe to call many times. */
  async ensureModel(): Promise<void> {
    if (this.pipelineInstance) return;
    this.pipelineInstance = await pipeline(
      'feature-extraction',
      this.modelId,
      {
        progress_callback: (progress: Record<string, unknown>) => {
          if (progress['status'] === 'downloading') {
            const pct = Math.round((progress['progress'] as number | undefined) ?? 0);
            process.stderr.write(
              `\r[aikb] Downloading model ${this.modelId}: ${pct}%`,
            );
          }
        },
      },
    );
    process.stderr.write('\n');
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureModel();
    const output = await this.pipelineInstance!(text, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureModel();
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
