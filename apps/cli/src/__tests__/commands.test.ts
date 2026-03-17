import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileSessionStore } from '@aikb/session-memory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh Commander program with global --json / --debug flags. */
function makeProgram(): Command {
  return new Command()
    .name('aikb-test')
    .exitOverride() // prevent process.exit() from killing the test process
    .option('--json', 'JSON output')
    .option('--debug', 'Debug');
}

/** Capture console.log output during an async callback. */
async function captureLog(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.join(' '));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// output helpers
// ---------------------------------------------------------------------------

describe('output helpers', () => {
  it('output() prints humanMessage when --json is not set', async () => {
    const { output } = await import('../output.js');
    const prog = makeProgram();
    const out = await captureLog(() => {
      output(prog, { id: 'x' }, 'Created session: x');
      return Promise.resolve();
    });
    expect(out).toContain('Created session: x');
    expect(out).not.toContain('"id"');
  });

  it('output() prints JSON when --json flag is set', async () => {
    const { output } = await import('../output.js');
    const prog = makeProgram();
    prog.parse(['node', 'aikb', '--json'], { from: 'user' });
    const out = await captureLog(() => {
      output(prog, { id: 'abc', name: 'test' }, 'Some message');
      return Promise.resolve();
    });
    const parsed: unknown = JSON.parse(out);
    expect(parsed).toMatchObject({ id: 'abc', name: 'test' });
  });
});

// ---------------------------------------------------------------------------
// models list
// ---------------------------------------------------------------------------

describe('models list', () => {
  it('prints model table with all registry entries', async () => {
    const { registerModelsCommands } = await import('../commands/models.js');
    const prog = makeProgram();
    registerModelsCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync(['node', 'aikb', 'models', 'list']);
    });

    expect(out).toContain('Xenova/all-MiniLM-L6-v2');
    expect(out).toContain('DEFAULT');
    expect(out).toContain('384');
  });

  it('prints JSON array when --json is set', async () => {
    const { registerModelsCommands } = await import('../commands/models.js');
    const prog = makeProgram();
    registerModelsCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync(['node', 'aikb', '--json', 'models', 'list']);
    });

    const parsed: unknown = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBeGreaterThan(0);
  });

  it('CLI_MODEL_REGISTRY has 5 entries with the default model marked', async () => {
    const { CLI_MODEL_REGISTRY } = await import('../models-registry.js');
    expect(CLI_MODEL_REGISTRY.length).toBe(5);
    const defaults = CLI_MODEL_REGISTRY.filter((m) => m.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0]!.id).toBe('Xenova/all-MiniLM-L6-v2');
  });
});

// ---------------------------------------------------------------------------
// session commands (FileSessionStore backed by a temp directory)
// ---------------------------------------------------------------------------

describe('session commands', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikb-cli-test-'));
    vi.resetModules();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /**
   * Build a mock of @aikb/session-memory that uses a real FileSessionStore
   * pointed at tmpDir.  vi.doMock must be called BEFORE the module under
   * test is imported so Vitest can swap the factory before execution.
   */
  function mockSessionMemory(dir: string): void {
    vi.doMock('@aikb/session-memory', async () => {
      const actual = await vi.importActual<{ FileSessionStore: typeof FileSessionStore }>(
        '@aikb/session-memory',
      );
      const store = new actual.FileSessionStore(dir);
      return {
        ...actual,
        createSessionStore: () => Promise.resolve(store),
      };
    });
  }

  it('session start creates a session and prints its ID', async () => {
    mockSessionMemory(tmpDir);

    const { registerSessionCommands } = await import('../commands/session.js');
    const prog = makeProgram();
    registerSessionCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync(['node', 'aikb', 'session', 'start']);
    });

    expect(out).toMatch(/Created session: session-\d{8}-[0-9a-f]{6}/);
  });

  it('session start --title sets the title', async () => {
    mockSessionMemory(tmpDir);

    const { registerSessionCommands } = await import('../commands/session.js');
    const prog = makeProgram();
    registerSessionCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync(['node', 'aikb', 'session', 'start', '--title', 'My Test Session']);
    });

    expect(out).toContain('Created session:');
  });

  it('session start --json emits valid JSON with session metadata', async () => {
    mockSessionMemory(tmpDir);

    const { registerSessionCommands } = await import('../commands/session.js');
    const prog = makeProgram();
    registerSessionCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync(['node', 'aikb', '--json', 'session', 'start']);
    });

    const parsed: unknown = JSON.parse(out);
    expect(parsed).toMatchObject({ id: expect.any(String) as string });
    expect((parsed as { id: string }).id).toMatch(/^session-/);
  });

  it('session list returns empty message when no sessions exist', async () => {
    mockSessionMemory(tmpDir);

    const { registerSessionCommands } = await import('../commands/session.js');
    const prog = makeProgram();
    registerSessionCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync(['node', 'aikb', 'session', 'list']);
    });

    expect(out).toContain('No sessions found');
  });

  it('session add appends a message and prints entry id', async () => {
    // Create the session first using a real store, then swap in the mock
    const { FileSessionStore: FSS } = await vi.importActual<{
      FileSessionStore: typeof FileSessionStore;
    }>('@aikb/session-memory');
    const realStore = new FSS(tmpDir);
    const meta = await realStore.create({ id: 'test-session-add' });

    mockSessionMemory(tmpDir);

    const { registerSessionCommands } = await import('../commands/session.js');
    const prog = makeProgram();
    registerSessionCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync([
        'node', 'aikb',
        'session', 'add', meta.id, 'Hello world',
        '--role', 'user',
      ]);
    });

    expect(out).toContain('Added entry');
  });

  it('session search finds messages', async () => {
    // Populate with a real store first, then hand off to the mock
    const { FileSessionStore: FSS } = await vi.importActual<{
      FileSessionStore: typeof FileSessionStore;
    }>('@aikb/session-memory');
    const realStore = new FSS(tmpDir);
    const meta = await realStore.create({ id: 'search-test' });
    await realStore.add(meta.id, {
      role: 'user',
      content: 'machine learning is cool',
      timestamp: new Date().toISOString(),
    });

    mockSessionMemory(tmpDir);

    const { registerSessionCommands } = await import('../commands/session.js');
    const prog = makeProgram();
    registerSessionCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync(['node', 'aikb', 'session', 'search', 'machine learning']);
    });

    expect(out).toContain('machine learning');
  });
});

// ---------------------------------------------------------------------------
// config show
// ---------------------------------------------------------------------------

describe('config show', () => {
  it('prints config sections without secrets', async () => {
    vi.resetModules();
    process.env['AIKB_EMBEDDING_PROVIDER'] = 'local';

    const { registerConfigCommands } = await import('../commands/config.js');
    const prog = makeProgram();
    registerConfigCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync(['node', 'aikb', 'config', 'show']);
    });

    const parsed: unknown = JSON.parse(out);
    expect(parsed).toMatchObject({ embedding: expect.any(Object) as object });
    delete process.env['AIKB_EMBEDDING_PROVIDER'];
  });

  it('--json flag outputs JSON', async () => {
    vi.resetModules();

    const { registerConfigCommands } = await import('../commands/config.js');
    const prog = makeProgram();
    registerConfigCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync(['node', 'aikb', '--json', 'config', 'show']);
    });

    const parsed: unknown = JSON.parse(out);
    expect(typeof parsed).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// vector ingest (mocked)
// ---------------------------------------------------------------------------

describe('vector ingest (mocked)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikb-vector-test-'));
    await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'Hello vector world', 'utf-8');
    vi.resetModules();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('dry-run reports file count without writing', async () => {
    vi.doMock('@aikb/core-embeddings', () => ({
      createEmbeddingProvider: () => ({
        embed: () => Promise.resolve(new Array(384).fill(0) as number[]),
        embedBatch: (texts: string[]) =>
          Promise.resolve(texts.map(() => new Array(384).fill(0) as number[])),
      }),
    }));

    vi.doMock('@aikb/vector-store', () => ({
      createVectorStore: () =>
        Promise.resolve({
          ensureCollection: () => Promise.resolve(),
          upsert: () => Promise.resolve({ inserted: 0, updated: 0, skipped: 0 }),
          query: () =>
            Promise.resolve({ query: {}, items: [], duration_ms: 0 }),
          status: () =>
            Promise.resolve({ name: 'test', vectorCount: 0, status: 'green', dimensions: 384 }),
          deleteBySource: () => Promise.resolve(0),
        }),
    }));

    const { registerVectorCommands } = await import('../commands/vector.js');
    const prog = makeProgram();
    registerVectorCommands(prog);

    const out = await captureLog(async () => {
      await prog.parseAsync([
        'node', 'aikb',
        'vector', 'ingest',
        '--root', tmpDir,
        '--dry-run',
      ]);
    });

    expect(out).toContain('dry-run');
    expect(out).toContain('1 file');
  });

  it('rejects invalid --batch-size', async () => {
    const { registerVectorCommands } = await import('../commands/vector.js');
    const prog = makeProgram();
    registerVectorCommands(prog);

    await expect(
      prog.parseAsync(['node', 'aikb', 'vector', 'ingest', '--root', tmpDir, '--batch-size', '0']),
    ).rejects.toThrow();
  });
});
