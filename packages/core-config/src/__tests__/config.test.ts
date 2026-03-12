import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dotenv so .env files on disk don't bleed into tests
vi.mock('dotenv', () => ({ config: vi.fn() }));

// Mock loadFromFile to control what "file" is read in unit tests
vi.mock('../file.js', () => ({
  loadFromFile: vi.fn(async () => ({})),
}));

import { getConfig, resetConfig } from '../config.js';
import { ConfigError } from '../errors.js';
import * as fileModule from '../file.js';

describe('getConfig / resetConfig', () => {
  beforeEach(() => {
    resetConfig();
    // Clear relevant env vars before each test
    for (const key of [
      'AIKB_EMBEDDING_PROVIDER',
      'AIKB_EMBEDDING_MODEL',
      'OPENAI_API_KEY',
      'AIKB_QDRANT_URL',
      'AIKB_QDRANT_API_KEY',
      'AIKB_NEO4J_URI',
      'AIKB_NEO4J_USER',
      'AIKB_NEO4J_PASSWORD',
      'AIKB_LLM_PROVIDER',
      'AIKB_LLM_MODEL',
      'AIKB_LOG_LEVEL',
      'AIKB_DATA_DIR',
    ]) {
      delete process.env[key];
    }
    vi.mocked(fileModule.loadFromFile).mockResolvedValue({});
  });

  afterEach(() => {
    resetConfig();
  });

  it('returns defaults when no env or file is present', async () => {
    const config = await getConfig();
    expect(config.embedding.provider).toBe('local');
    expect(config.embedding.model).toBe('Xenova/all-MiniLM-L6-v2');
    expect(config.vector.provider).toBe('qdrant');
    expect(config.vector.qdrant_url).toBe('http://localhost:6333');
    expect(config.graph.provider).toBe('neo4j');
    expect(config.llm.provider).toBe('none');
    expect(config.log_level).toBe('info');
    expect(config.data_dir).toBe('.aikb');
  });

  it('applies env var overrides', async () => {
    process.env['AIKB_EMBEDDING_PROVIDER'] = 'openai';
    process.env['AIKB_LOG_LEVEL'] = 'debug';
    process.env['AIKB_DATA_DIR'] = '/tmp/custom-aikb';

    const config = await getConfig();
    expect(config.embedding.provider).toBe('openai');
    expect(config.log_level).toBe('debug');
    expect(config.data_dir).toBe('/tmp/custom-aikb');
  });

  it('maps OPENAI_API_KEY to both embedding.openai_api_key and llm.api_key', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-key';

    const config = await getConfig();
    expect(config.embedding.openai_api_key).toBe('sk-test-key');
    expect(config.llm.api_key).toBe('sk-test-key');
  });

  it('applies config file overrides', async () => {
    vi.mocked(fileModule.loadFromFile).mockResolvedValue({
      embedding: { provider: 'ollama', model: 'custom-model' },
      log_level: 'warn',
    });

    const config = await getConfig();
    expect(config.embedding.provider).toBe('ollama');
    expect(config.embedding.model).toBe('custom-model');
    expect(config.log_level).toBe('warn');
  });

  it('CLI overrides take highest priority over env and file', async () => {
    process.env['AIKB_LOG_LEVEL'] = 'debug';
    vi.mocked(fileModule.loadFromFile).mockResolvedValue({ log_level: 'warn' });

    const config = await getConfig({ log_level: 'error' });
    expect(config.log_level).toBe('error');
  });

  it('env vars take priority over file config', async () => {
    process.env['AIKB_EMBEDDING_PROVIDER'] = 'openai';
    vi.mocked(fileModule.loadFromFile).mockResolvedValue({
      embedding: { provider: 'ollama' },
    });

    const config = await getConfig();
    expect(config.embedding.provider).toBe('openai');
  });

  it('throws ConfigError with field-level message for invalid config', async () => {
    await expect(
      // @ts-expect-error intentionally invalid
      getConfig({ log_level: 'invalid-level' }),
    ).rejects.toThrow(ConfigError);

    resetConfig();
    await expect(
      // @ts-expect-error intentionally invalid
      getConfig({ log_level: 'invalid-level' }),
    ).rejects.toThrow('Invalid configuration');
  });

  it('resetConfig() clears the singleton so next call reloads', async () => {
    const config1 = await getConfig();
    resetConfig();
    process.env['AIKB_LOG_LEVEL'] = 'debug';
    const config2 = await getConfig();
    expect(config1.log_level).toBe('info');
    expect(config2.log_level).toBe('debug');
  });

  it('returns cached singleton on repeated calls', async () => {
    const config1 = await getConfig();
    const config2 = await getConfig();
    expect(config1).toBe(config2);
  });
});

describe('loadFromFile (integration)', () => {
  let tmpFile: string;

  afterEach(async () => {
    if (tmpFile) {
      await rm(tmpFile, { force: true });
    }
  });

  it('loads and parses a JSON config file', async () => {
    // Import the real implementation directly (vi.mock is in outer scope but
    // we can call the real function by importing the actual module path)
    const { loadFromFile } = await import('../file.js');

    tmpFile = join(tmpdir(), `aikb-test-${Date.now()}.json`);
    await writeFile(
      tmpFile,
      JSON.stringify({ log_level: 'warn', data_dir: '/tmp/test-aikb' }),
    );

    // The mock returns {} by default; override to call the real file
    vi.mocked(loadFromFile).mockImplementationOnce(async (path) => {
      const { loadFromFile: real } = await vi.importActual<typeof import('../file.js')>(
        '../file.js',
      );
      return real(path);
    });

    const result = await loadFromFile(tmpFile);
    expect(result.log_level).toBe('warn');
    expect(result.data_dir).toBe('/tmp/test-aikb');
  });
});

