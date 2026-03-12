import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockEmbeddingProvider } from '../providers/mock.js';
import { LocalHFProvider } from '../providers/local-hf.js';
import { OllamaProvider } from '../providers/ollama.js';
import { MODEL_REGISTRY, DEFAULT_MODEL, getModelInfo } from '../registry.js';
import { makeCacheKey, CachedEmbeddingProvider } from '../cache.js';
import { createEmbeddingProvider } from '../factory.js';
import type { EmbeddingProvider } from '../types.js';

// ---------------------------------------------------------------------------
// MockEmbeddingProvider
// ---------------------------------------------------------------------------
describe('MockEmbeddingProvider', () => {
  it('returns a vector of the correct length (dimensions=4)', async () => {
    const provider = new MockEmbeddingProvider();
    const vec = await provider.embed('hello world');
    expect(vec).toHaveLength(provider.dimensions);
    expect(vec).toHaveLength(4);
  });

  it('is deterministic: same input → same vector', async () => {
    const provider = new MockEmbeddingProvider();
    const a = await provider.embed('foo');
    const b = await provider.embed('foo');
    expect(a).toEqual(b);
  });

  it('embedBatch returns one vector per input', async () => {
    const provider = new MockEmbeddingProvider();
    const texts = ['alpha', 'beta', 'gamma'];
    const results = await provider.embedBatch(texts);
    expect(results).toHaveLength(texts.length);
    for (const vec of results) {
      expect(vec).toHaveLength(provider.dimensions);
    }
  });

  it('ensureModel is a no-op and resolves without error', async () => {
    const provider = new MockEmbeddingProvider();
    await expect(provider.ensureModel()).resolves.toBeUndefined();
    await expect(provider.ensureModel()).resolves.toBeUndefined();
  });

  it('provider name is "mock"', () => {
    const provider = new MockEmbeddingProvider();
    expect(provider.name).toBe('mock');
  });
});

// ---------------------------------------------------------------------------
// MODEL_REGISTRY
// ---------------------------------------------------------------------------
describe('MODEL_REGISTRY', () => {
  it('contains at least one model', () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it('has exactly one default model', () => {
    const defaults = MODEL_REGISTRY.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it('DEFAULT_MODEL has expected id', () => {
    expect(DEFAULT_MODEL.id).toBe('Xenova/all-MiniLM-L6-v2');
    expect(DEFAULT_MODEL.dimensions).toBe(384);
  });

  it('getModelInfo finds a known model', () => {
    const info = getModelInfo('Xenova/all-MiniLM-L6-v2');
    expect(info).toBeDefined();
    expect(info?.dimensions).toBe(384);
  });

  it('getModelInfo returns undefined for unknown model', () => {
    expect(getModelInfo('unknown/model')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LocalHFProvider — the @huggingface/transformers pipeline is mocked at the
// module level so that no models are downloaded during unit tests.
// ---------------------------------------------------------------------------
vi.mock('@huggingface/transformers', () => {
  const fakePipelineFn = Object.assign(
    async (_text: string, _opts: unknown) => ({
      data: new Float32Array(384).fill(0.1),
    }),
    { model: 'mock' },
  );
  const pipelineMock = vi.fn().mockResolvedValue(fakePipelineFn);
  return { pipeline: pipelineMock, env: {} };
});

describe('LocalHFProvider (mocked pipeline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provider name is "local-hf"', () => {
    const provider = new LocalHFProvider();
    expect(provider.name).toBe('local-hf');
  });

  it('dimensions default to 384 for default model', () => {
    const provider = new LocalHFProvider();
    expect(provider.dimensions).toBe(384);
  });

  it('embed returns a vector of the correct dimensions', async () => {
    const provider = new LocalHFProvider('Xenova/all-MiniLM-L6-v2');
    const vec = await provider.embed('test sentence');
    expect(vec).toHaveLength(384);
  });

  it('embedBatch returns one vector per input', async () => {
    const provider = new LocalHFProvider();
    const results = await provider.embedBatch(['a', 'b', 'c']);
    expect(results).toHaveLength(3);
    for (const vec of results) {
      expect(vec).toHaveLength(384);
    }
  });

  it('ensureModel is idempotent (pipeline factory called only once)', async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const pipelineSpy = vi.mocked(pipeline);
    pipelineSpy.mockClear();

    const provider = new LocalHFProvider();
    await provider.ensureModel();
    await provider.ensureModel();
    await provider.ensureModel();

    expect(pipelineSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------
describe('OllamaProvider', () => {
  it('ensureModel is a no-op', async () => {
    const provider = new OllamaProvider();
    await expect(provider.ensureModel()).resolves.toBeUndefined();
  });

  it('embed throws on non-ok HTTP response', async () => {
    const provider = new OllamaProvider('nomic-embed-text', 'http://localhost:11434');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, statusText: 'Service Unavailable' }));
    await expect(provider.embed('hello')).rejects.toThrow('Ollama error');
    vi.unstubAllGlobals();
  });

  it('embed returns the embedding from the response', async () => {
    const provider = new OllamaProvider();
    const fakeVec = new Array<number>(768).fill(0.5);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: fakeVec }),
    }));
    const vec = await provider.embed('test');
    expect(vec).toEqual(fakeVec);
    vi.unstubAllGlobals();
  });

  it('embedBatch calls embed for each text', async () => {
    const provider = new OllamaProvider();
    const fakeVec = [0.1, 0.2, 0.3];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: fakeVec }),
    }));
    const results = await provider.embedBatch(['a', 'b', 'c']);
    expect(results).toHaveLength(3);
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// createEmbeddingProvider factory
// ---------------------------------------------------------------------------
describe('createEmbeddingProvider', () => {
  it('returns LocalHFProvider for provider="local"', () => {
    const provider = createEmbeddingProvider({
      provider: 'local',
      model: 'Xenova/all-MiniLM-L6-v2',
      ollama_base_url: 'http://localhost:11434',
      cache_enabled: false,
    });
    expect(provider).toBeInstanceOf(LocalHFProvider);
    expect(provider.name).toBe('local-hf');
  });

  it('returns OllamaProvider for provider="ollama"', () => {
    const provider = createEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      ollama_base_url: 'http://localhost:11434',
      cache_enabled: false,
    });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe('ollama');
  });

  it('throws when provider="openai" and no api key', () => {
    expect(() =>
      createEmbeddingProvider({
        provider: 'openai',
        model: 'text-embedding-3-small',
        ollama_base_url: 'http://localhost:11434',
        cache_enabled: false,
      }),
    ).toThrow('openai_api_key');
  });

  it('provider name is "local-hf" for default local provider', () => {
    const provider = createEmbeddingProvider({
      provider: 'local',
      model: 'Xenova/all-MiniLM-L6-v2',
      ollama_base_url: 'http://localhost:11434',
      cache_enabled: false,
    });
    expect(provider.name).toBe('local-hf');
  });
});

// ---------------------------------------------------------------------------
// makeCacheKey
// ---------------------------------------------------------------------------
describe('makeCacheKey', () => {
  it('returns a string containing the modelId', () => {
    const key = makeCacheKey('Xenova/all-MiniLM-L6-v2', 'hello');
    expect(key).toContain('Xenova/all-MiniLM-L6-v2');
  });

  it('is deterministic for same inputs', () => {
    expect(makeCacheKey('model', 'text')).toBe(makeCacheKey('model', 'text'));
  });

  it('differs for different texts', () => {
    expect(makeCacheKey('m', 'a')).not.toBe(makeCacheKey('m', 'b'));
  });
});

// ---------------------------------------------------------------------------
// CachedEmbeddingProvider
// ---------------------------------------------------------------------------
describe('CachedEmbeddingProvider', () => {
  let inner: EmbeddingProvider;
  let callCount: number;

  beforeEach(() => {
    callCount = 0;
    inner = {
      name: 'test',
      dimensions: 4,
      ensureModel: async () => {},
      embed: async (text: string) => {
        callCount++;
        return [text.length, 0, 0, 0];
      },
      embedBatch: async (texts: string[]) => Promise.all(texts.map((t) => inner.embed(t))),
    };
  });

  it('forwards name and dimensions from inner provider', () => {
    const cache = new Map<string, number[]>();
    const cacheImpl = {
      get: async (k: string) => cache.get(k),
      set: async (k: string, v: number[]) => { cache.set(k, v); },
    };
    const provider = new CachedEmbeddingProvider(inner, cacheImpl, 'model');
    expect(provider.name).toBe('test');
    expect(provider.dimensions).toBe(4);
  });

  it('calls inner.embed on cache miss then returns cached result on hit', async () => {
    const cache = new Map<string, number[]>();
    const cacheImpl = {
      get: async (k: string) => cache.get(k),
      set: async (k: string, v: number[]) => { cache.set(k, v); },
    };
    const provider = new CachedEmbeddingProvider(inner, cacheImpl, 'model');

    const first = await provider.embed('hello');
    expect(callCount).toBe(1);

    const second = await provider.embed('hello');
    expect(callCount).toBe(1); // still 1 — served from cache
    expect(first).toEqual(second);
  });

  it('embedBatch returns one vector per input', async () => {
    const cacheImpl = {
      get: async (_k: string) => undefined as number[] | undefined,
      set: async (_k: string, _v: number[]) => {},
    };
    const provider = new CachedEmbeddingProvider(inner, cacheImpl, 'model');
    const results = await provider.embedBatch(['a', 'bb', 'ccc']);
    expect(results).toHaveLength(3);
    expect(results[0]).toHaveLength(4);
  });
});
