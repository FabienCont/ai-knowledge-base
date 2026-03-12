# ⬜ Subplan F — Core Embeddings

## Overview

Implement a provider-agnostic embedding library (`@aikb/core-embeddings`) that abstracts over multiple embedding backends behind a common interface. The **default provider is local** using `@huggingface/transformers` — no API key, no internet required at runtime (models auto-download on first use). OpenAI and Ollama providers are available as opt-in alternatives.

---

## Dependencies

- Subplan A (monorepo foundation)
- Subplan B (`@aikb/core-types`)
- Subplan C (`@aikb/core-config` — for `EmbeddingConfig`)

---

## Detailed Tasks

### F1 ⬜ Package scaffold

- Package name: `@aikb/core-embeddings`
- Runtime dependencies:
  - `@aikb/core-types workspace:*`
  - `@aikb/core-config workspace:*`
  - `@huggingface/transformers ^3.0` — local inference
- Optional peer deps (installed only when using those providers):
  - `openai ^4.0`
- Dev dependencies: `vitest`, `tsup`, etc.

### F2 ⬜ EmbeddingProvider interface

```ts
// src/types.ts

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
```

### F3 ⬜ Model registry

```ts
// src/registry.ts
export interface ModelInfo {
  id: string;           // HuggingFace model ID
  dimensions: number;
  sizeLabel: string;    // e.g. '~23MB'
  description: string;
  isDefault: boolean;
}

export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    sizeLabel: '~23MB',
    description: 'Fastest, zero-config — recommended default',
    isDefault: true,
  },
  {
    id: 'Xenova/bge-small-en-v1.5',
    dimensions: 384,
    sizeLabel: '~33MB',
    description: 'Better retrieval quality, small size',
    isDefault: false,
  },
  {
    id: 'nomic-ai/nomic-embed-text-v1.5',
    dimensions: 768,
    sizeLabel: '~130MB',
    description: 'High quality, larger model',
    isDefault: false,
  },
  {
    id: 'Snowflake/snowflake-arctic-embed-m',
    dimensions: 768,
    sizeLabel: '~110MB',
    description: 'High quality alternative',
    isDefault: false,
  },
  {
    id: 'Supabase/gte-small',
    dimensions: 384,
    sizeLabel: '~33MB',
    description: 'Balanced quality and size',
    isDefault: false,
  },
];

export const DEFAULT_MODEL = MODEL_REGISTRY.find(m => m.isDefault)!;

export function getModelInfo(modelId: string): ModelInfo | undefined;
```

### F4 ⬜ LocalHFProvider (default)

```ts
// src/providers/local-hf.ts
import { pipeline, env } from '@huggingface/transformers';
import type { EmbeddingProvider } from '../types.js';

export class LocalHFProvider implements EmbeddingProvider {
  readonly name = 'local-hf';
  readonly dimensions: number;

  private pipelineInstance: Awaited<ReturnType<typeof pipeline>> | null = null;
  private readonly modelId: string;

  constructor(modelId = DEFAULT_MODEL.id) {
    this.modelId = modelId;
    this.dimensions = getModelInfo(modelId)?.dimensions ?? 384;
  }

  async ensureModel(): Promise<void> {
    if (this.pipelineInstance) return;
    // Show download progress via @huggingface/transformers progress_callback
    this.pipelineInstance = await pipeline('feature-extraction', this.modelId, {
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          process.stderr.write(
            `\r[aikb] Downloading model ${this.modelId}: ${Math.round(progress.progress ?? 0)}%`
          );
        }
      },
    });
    process.stderr.write('\n');
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureModel();
    const output = await this.pipelineInstance!(text, {
      pooling: 'mean',
      normalize: true,
    });
    // output.data is Float32Array → convert to number[]
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureModel();
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
```

Key design decisions:
- Singleton pipeline per model ID — reuse across calls in the same process
- Progress output goes to `stderr` (not `stdout`) to avoid polluting CLI output
- Model files cached in HuggingFace default cache dir (`~/.cache/huggingface/hub/`)
- `normalize: true` produces unit-norm vectors suitable for cosine similarity

### F5 ⬜ OpenAIProvider

```ts
// src/providers/openai.ts
import OpenAI from 'openai';
import type { EmbeddingProvider } from '../types.js';

const SUPPORTED_MODELS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

export class OpenAIProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions: number;

  private client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = 'text-embedding-3-small', baseUrl?: string) {
    this.model = model;
    this.dimensions = SUPPORTED_MODELS[model] ?? 1536;
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
  }

  async ensureModel(): Promise<void> { /* no-op for API providers */ }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0]!.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map(d => d.embedding);
  }
}
```

### F6 ⬜ OllamaProvider

```ts
// src/providers/ollama.ts
export class OllamaProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions: number;

  private readonly model: string;
  private readonly baseUrl: string;

  constructor(model = 'nomic-embed-text', baseUrl = 'http://localhost:11434', dimensions = 768) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.dimensions = dimensions;
  }

  async ensureModel(): Promise<void> { /* no-op — user must have Ollama running */ }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
```

### F7 ⬜ Factory function

```ts
// src/factory.ts
import type { EmbeddingConfig } from '@aikb/core-config';
import type { EmbeddingProvider } from './types.js';

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai': {
      if (!config.openai_api_key) throw new Error('OPENAI_API_KEY is required for openai provider');
      const { OpenAIProvider } = await import('./providers/openai.js');
      return new OpenAIProvider(config.openai_api_key, config.model, config.openai_base_url);
    }
    case 'ollama': {
      const { OllamaProvider } = await import('./providers/ollama.js');
      return new OllamaProvider(config.model, config.ollama_base_url, config.dimensions);
    }
    case 'local':
    default: {
      const { LocalHFProvider } = await import('./providers/local-hf.js');
      return new LocalHFProvider(config.model);
    }
  }
}
```

### F8 ⬜ Embedding cache (optional)

```ts
// src/cache.ts
export interface EmbeddingCache {
  get(key: string): Promise<number[] | undefined>;
  set(key: string, vector: number[]): Promise<void>;
}

/** Cache key: '<modelId>:<sha256(text)>' */
export function makeCacheKey(modelId: string, text: string): string;

/**
 * SQLite-backed cache using better-sqlite3.
 * Only created if config.embedding.cache_enabled is true.
 */
export class SqliteEmbeddingCache implements EmbeddingCache { ... }
```

Wrap a provider with cache:
```ts
export class CachedEmbeddingProvider implements EmbeddingProvider {
  constructor(inner: EmbeddingProvider, cache: EmbeddingCache, modelId: string) {}
  // Checks cache before calling inner.embed()
}
```

### F9 ⬜ Mock provider for tests

```ts
// src/providers/mock.ts
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly dimensions = 4;

  async ensureModel() {}

  async embed(text: string): Promise<number[]> {
    // Deterministic fake vector based on text hash
    const h = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return [h % 1, (h * 2) % 1, (h * 3) % 1, (h * 4) % 1];
  }

  async embedBatch(texts: string[]) {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
```

### F10 ⬜ Unit tests

`src/__tests__/embeddings.test.ts`:

- Test `MockEmbeddingProvider` returns vectors of correct length
- Test `LocalHFProvider` with a tiny model (mock the HF pipeline in unit tests)
- Test `createEmbeddingProvider` selects correct provider from config
- Test `embedBatch` returns one vector per input
- Test that `ensureModel()` is idempotent (called multiple times, pipeline created once)
- Integration test (optional, tag `@integration`): actually download and use `Xenova/all-MiniLM-L6-v2`

---

## File Structure

```
packages/core-embeddings/
├── src/
│   ├── index.ts          ← exports EmbeddingProvider, createEmbeddingProvider, MODEL_REGISTRY
│   ├── types.ts          ← EmbeddingProvider interface
│   ├── registry.ts       ← MODEL_REGISTRY, ModelInfo
│   ├── factory.ts        ← createEmbeddingProvider
│   ├── cache.ts          ← EmbeddingCache, CachedEmbeddingProvider
│   ├── providers/
│   │   ├── local-hf.ts
│   │   ├── openai.ts
│   │   ├── ollama.ts
│   │   └── mock.ts
│   └── __tests__/
│       └── embeddings.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key APIs / Interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `EmbeddingProvider` | interface | Common provider contract |
| `createEmbeddingProvider(config)` | factory | Returns configured provider |
| `LocalHFProvider` | class | Local HF Transformers (default) |
| `OpenAIProvider` | class | OpenAI Embeddings API |
| `OllamaProvider` | class | Ollama local API |
| `MockEmbeddingProvider` | class | Deterministic mock for tests |
| `MODEL_REGISTRY` | `ModelInfo[]` | List of supported local models |
| `DEFAULT_MODEL` | `ModelInfo` | `Xenova/all-MiniLM-L6-v2` |
| `CachedEmbeddingProvider` | class | Cache wrapper |

---

## Acceptance Criteria

- [ ] `pnpm --filter @aikb/core-embeddings build` succeeds
- [ ] `pnpm --filter @aikb/core-embeddings test` passes (unit tests with mocks)
- [ ] `LocalHFProvider` works with `Xenova/all-MiniLM-L6-v2` end-to-end (integration test)
- [ ] `createEmbeddingProvider({ provider: 'local' })` returns a working `LocalHFProvider`
- [ ] `embedBatch(['a', 'b'])` returns exactly 2 vectors of `dimensions` length
- [ ] Model download shows progress on `stderr`
- [ ] `MockEmbeddingProvider` is exported and usable in other packages' tests

---

## Notes for Implementers

- The `@huggingface/transformers` library uses ONNX Runtime under the hood — no Python required.
- Models are cached in `~/.cache/huggingface/hub/` by default. Set `env.cacheDir` before calling `pipeline()` to override.
- For the OpenAI provider, use the official `openai` SDK — it handles retries, rate limiting, and streaming.
- The `OllamaProvider` uses raw `fetch` to avoid adding another dependency; Ollama's API is simple enough.
- Dimension mismatch between provider and collection is a common error — validate early in `createEmbeddingProvider` and throw a clear message.
- Future: add an `AzureOpenAIProvider`, `CohereProvider`, and `VoyageAIProvider` following the same interface.
