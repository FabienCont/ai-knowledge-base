import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_EMBEDDING_DIM = 384;

// ---------------------------------------------------------------------------
// Minimal McpServer stub
// ---------------------------------------------------------------------------

type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;
type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: true;
};

/**
 * Lightweight stub for McpServer that records registered tools and lets us
 * invoke them directly — no network / transport layer needed.
 */
class StubMcpServer {
  private readonly _tools = new Map<string, ToolHandler>();

  tool(
    name: string,
    _description: string,
    _schema: unknown,
    handler: (params: Record<string, unknown>) => Promise<ToolResult>,
  ): void {
    this._tools.set(name, handler);
  }

  async call(name: string, params: Record<string, unknown> = {}): Promise<ToolResult> {
    const handler = this._tools.get(name);
    if (!handler) throw new Error(`Tool not registered: ${name}`);
    return handler(params);
  }

  has(name: string): boolean {
    return this._tools.has(name);
  }

  toolNames(): string[] {
    return [...this._tools.keys()];
  }
}

// ---------------------------------------------------------------------------
// Helper: parse the first text item from a tool result
// ---------------------------------------------------------------------------

function parseText(result: ToolResult): unknown {
  const text = result.content[0]?.text ?? '';
  return JSON.parse(text);
}

// ===========================================================================
// Session tools
// ===========================================================================

describe('session tools', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikb-mcp-session-'));
    vi.resetModules();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function mockSessionMemory(dir: string): void {
    vi.doMock('@aikb/session-memory', async () => {
      const actual = await vi.importActual<
        typeof import('@aikb/session-memory')
      >('@aikb/session-memory');
      const store = new actual.FileSessionStore(dir);
      return { ...actual, createSessionStore: () => Promise.resolve(store) };
    });
  }

  it('registers all 4 session tools', async () => {
    mockSessionMemory(tmpDir);
    const { registerSessionTools } = await import('../tools/session.js');
    const server = new StubMcpServer();
    registerSessionTools(server as never);

    expect(server.has('session_memory_add')).toBe(true);
    expect(server.has('session_memory_get')).toBe(true);
    expect(server.has('session_memory_list')).toBe(true);
    expect(server.has('session_memory_search')).toBe(true);
  });

  it('session_memory_list returns empty array when no sessions exist', async () => {
    mockSessionMemory(tmpDir);
    const { registerSessionTools } = await import('../tools/session.js');
    const server = new StubMcpServer();
    registerSessionTools(server as never);

    const result = await server.call('session_memory_list', {});
    expect(result.isError).toBeUndefined();
    const data = parseText(result);
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBe(0);
  });

  it('session_memory_add then session_memory_get round-trips content', async () => {
    mockSessionMemory(tmpDir);
    const { registerSessionTools } = await import('../tools/session.js');
    const server = new StubMcpServer();
    registerSessionTools(server as never);

    // Create a session using the real store so we have a valid session id
    const { FileSessionStore } = await vi.importActual<
      typeof import('@aikb/session-memory')
    >('@aikb/session-memory');
    const realStore = new FileSessionStore(tmpDir);
    const meta = await realStore.create({ id: 'test-mcp-session' });

    const addResult = await server.call('session_memory_add', {
      session_id: meta.id,
      role: 'user',
      content: 'Hello MCP world',
    });
    expect(addResult.isError).toBeUndefined();
    const addedEntry = parseText(addResult) as { content: string };
    expect(addedEntry.content).toBe('Hello MCP world');

    const getResult = await server.call('session_memory_get', {
      session_id: meta.id,
    });
    expect(getResult.isError).toBeUndefined();
    const session = parseText(getResult) as {
      entries: Array<{ content: string }>;
    };
    expect(session.entries[0]?.content).toBe('Hello MCP world');
  });

  it('session_memory_list respects limit parameter', async () => {
    mockSessionMemory(tmpDir);
    const { registerSessionTools } = await import('../tools/session.js');
    const server = new StubMcpServer();
    registerSessionTools(server as never);

    // Create three sessions
    const { FileSessionStore } = await vi.importActual<
      typeof import('@aikb/session-memory')
    >('@aikb/session-memory');
    const realStore = new FileSessionStore(tmpDir);
    await realStore.create({});
    await realStore.create({});
    await realStore.create({});

    const result = await server.call('session_memory_list', { limit: 2 });
    const data = parseText(result) as unknown[];
    expect(data.length).toBeLessThanOrEqual(2);
  });

  it('session_memory_search finds matching entries', async () => {
    mockSessionMemory(tmpDir);
    const { registerSessionTools } = await import('../tools/session.js');
    const server = new StubMcpServer();
    registerSessionTools(server as never);

    const { FileSessionStore } = await vi.importActual<
      typeof import('@aikb/session-memory')
    >('@aikb/session-memory');
    const realStore = new FileSessionStore(tmpDir);
    const meta = await realStore.create({});
    await realStore.add(meta.id, {
      role: 'user',
      content: 'vector databases are powerful',
      timestamp: new Date().toISOString(),
    });

    const result = await server.call('session_memory_search', {
      pattern: 'vector databases',
    });
    expect(result.isError).toBeUndefined();
    const results = parseText(result) as Array<{ entry: { content: string } }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.entry.content).toContain('vector databases');
  });

  it('session_memory_add returns isError:true for unknown session', async () => {
    mockSessionMemory(tmpDir);
    const { registerSessionTools } = await import('../tools/session.js');
    const server = new StubMcpServer();
    registerSessionTools(server as never);

    const result = await server.call('session_memory_add', {
      session_id: 'non-existent-session',
      role: 'user',
      content: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Error:/);
  });
});

// ===========================================================================
// Vector tools
// ===========================================================================

describe('vector tools (mocked store)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockVectorDeps(tmpDir: string): void {
    vi.doMock('@aikb/core-embeddings', () => ({
      createEmbeddingProvider: () => ({
        embed: () => Promise.resolve(new Array(TEST_EMBEDDING_DIM).fill(0) as number[]),
        embedBatch: (texts: string[]) =>
          Promise.resolve(texts.map(() => new Array(TEST_EMBEDDING_DIM).fill(0) as number[])),
      }),
    }));

    vi.doMock('@aikb/vector-store', () => ({
      createVectorStore: () =>
        Promise.resolve({
          ensureCollection: () => Promise.resolve(),
          upsert: () => Promise.resolve({ inserted: 3, updated: 0, skipped: 0 }),
          query: () =>
            Promise.resolve({ query: {}, items: [], duration_ms: 0 }),
          status: () =>
            Promise.resolve({
              name: 'test-collection',
              vectorCount: 42,
              status: 'green',
              dimensions: TEST_EMBEDDING_DIM,
            }),
          deleteBySource: () => Promise.resolve(0),
        }),
    }));

    vi.doMock('@aikb/core-fs-scan', () => ({
      scanFolder: function* () {
        yield { path: path.join(tmpDir, 'file.txt'), name: 'file.txt', ext: '.txt', size: 10 };
      },
    }));

    vi.doMock('@aikb/core-chunking', () => ({
      loadAndChunk: () =>
        Promise.resolve({
          chunks: [
            {
              id: 'c1',
              content: 'hello world',
              source_path: path.join(tmpDir, 'file.txt'),
              hash: 'abc',
              strategy: 'fixed',
            },
          ],
        }),
    }));
  }

  it('registers all 3 vector tools', async () => {
    vi.doMock('@aikb/vector-store', () => ({
      createVectorStore: () => Promise.resolve({}),
    }));
    const { registerVectorTools } = await import('../tools/vector.js');
    const server = new StubMcpServer();
    registerVectorTools(server as never);

    expect(server.has('vector_ingest')).toBe(true);
    expect(server.has('vector_query')).toBe(true);
    expect(server.has('vector_status')).toBe(true);
  });

  it('vector_status returns collection info', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikb-mcp-vec-'));
    mockVectorDeps(tmpDir);

    const { registerVectorTools } = await import('../tools/vector.js');
    const server = new StubMcpServer();
    registerVectorTools(server as never);

    const result = await server.call('vector_status', {});
    expect(result.isError).toBeUndefined();
    const data = parseText(result) as { name: string; vectorCount: number };
    expect(data.name).toBe('test-collection');
    expect(data.vectorCount).toBe(42);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('vector_ingest returns summary with files/chunks counts', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikb-mcp-vec2-'));
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'Hello vector world');
    mockVectorDeps(tmpDir);

    const { registerVectorTools } = await import('../tools/vector.js');
    const server = new StubMcpServer();
    registerVectorTools(server as never);

    const result = await server.call('vector_ingest', { root: tmpDir });
    expect(result.isError).toBeUndefined();
    const data = parseText(result) as {
      files_processed: number;
      chunks_inserted: number;
    };
    expect(data.files_processed).toBeGreaterThanOrEqual(0);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('vector_query returns result structure', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikb-mcp-vec3-'));
    mockVectorDeps(tmpDir);

    const { registerVectorTools } = await import('../tools/vector.js');
    const server = new StubMcpServer();
    registerVectorTools(server as never);

    const result = await server.call('vector_query', { text: 'semantic search', top_k: 5 });
    expect(result.isError).toBeUndefined();
    const data = parseText(result) as { items: unknown[] };
    expect(Array.isArray(data.items)).toBe(true);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('vector_status returns isError:true on store failure', async () => {
    vi.doMock('@aikb/vector-store', () => ({
      createVectorStore: () => Promise.reject(new Error('Qdrant unavailable')),
    }));

    const { registerVectorTools } = await import('../tools/vector.js');
    const server = new StubMcpServer();
    registerVectorTools(server as never);

    const result = await server.call('vector_status', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Qdrant unavailable/);
  });
});

// ===========================================================================
// Graph tools
// ===========================================================================

describe('graph tools (mocked store)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockGraphDeps(tmpDir: string): void {
    vi.doMock('@aikb/core-embeddings', () => ({
      createEmbeddingProvider: () => ({
        embed: () => Promise.resolve(new Array(TEST_EMBEDDING_DIM).fill(0) as number[]),
        embedBatch: (texts: string[]) =>
          Promise.resolve(texts.map(() => new Array(TEST_EMBEDDING_DIM).fill(0) as number[])),
      }),
    }));

    vi.doMock('@aikb/graph-store', () => ({
      createGraphStore: () =>
        Promise.resolve({
          connect: () => Promise.resolve(),
          ensureSchema: () => Promise.resolve(),
          upsertEntities: () => Promise.resolve(),
          upsertRelations: () => Promise.resolve(),
          queryCypher: (cypher: string) =>
            Promise.resolve([{ node: 'result', cypher }]),
          stats: () =>
            Promise.resolve({ entityCount: 5, relationCount: 3, chunkCount: 2 }),
          close: () => Promise.resolve(),
        }),
      createExtractor: () =>
        Promise.resolve({
          extract: () =>
            Promise.resolve({ entities: [], relations: [] }),
        }),
      ingestChunks: () =>
        Promise.resolve({ entities: 2, relations: 1 }),
    }));

    vi.doMock('@aikb/core-fs-scan', () => ({
      scanFolder: function* () {
        yield { path: path.join(tmpDir, 'doc.txt'), name: 'doc.txt', ext: '.txt', size: 10 };
      },
    }));

    vi.doMock('@aikb/core-chunking', () => ({
      loadAndChunk: () =>
        Promise.resolve({
          chunks: [
            {
              id: 'c1',
              content: 'Alice knows Bob',
              source_path: path.join(tmpDir, 'doc.txt'),
              hash: 'xyz',
              strategy: 'fixed',
            },
          ],
        }),
    }));
  }

  it('registers all 3 graph tools', async () => {
    vi.doMock('@aikb/graph-store', () => ({
      createGraphStore: () => Promise.resolve({}),
      createExtractor: () => Promise.resolve({}),
      ingestChunks: () => Promise.resolve({}),
    }));
    const { registerGraphTools } = await import('../tools/graph.js');
    const server = new StubMcpServer();
    registerGraphTools(server as never);

    expect(server.has('graph_ingest')).toBe(true);
    expect(server.has('graph_query')).toBe(true);
    expect(server.has('graph_ask')).toBe(true);
  });

  it('graph_query returns records', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikb-mcp-graph-'));
    mockGraphDeps(tmpDir);

    const { registerGraphTools } = await import('../tools/graph.js');
    const server = new StubMcpServer();
    registerGraphTools(server as never);

    const result = await server.call('graph_query', {
      cypher: 'MATCH (n) RETURN n LIMIT 5',
    });
    expect(result.isError).toBeUndefined();
    const data = parseText(result) as Array<Record<string, unknown>>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('graph_ingest returns files/entities/relations summary', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikb-mcp-graph2-'));
    mockGraphDeps(tmpDir);

    const { registerGraphTools } = await import('../tools/graph.js');
    const server = new StubMcpServer();
    registerGraphTools(server as never);

    const result = await server.call('graph_ingest', { root: tmpDir });
    expect(result.isError).toBeUndefined();
    const data = parseText(result) as {
      files_processed: number;
      entities: number;
      relations: number;
    };
    expect(typeof data.files_processed).toBe('number');
    expect(typeof data.entities).toBe('number');
    expect(typeof data.relations).toBe('number');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('graph_query returns isError:true on Neo4j failure', async () => {
    vi.doMock('@aikb/graph-store', () => ({
      createGraphStore: () =>
        Promise.resolve({
          connect: () => Promise.reject(new Error('Neo4j unavailable')),
          close: () => Promise.resolve(),
        }),
      createExtractor: () => Promise.resolve({}),
      ingestChunks: () => Promise.resolve({}),
    }));

    const { registerGraphTools } = await import('../tools/graph.js');
    const server = new StubMcpServer();
    registerGraphTools(server as never);

    const result = await server.call('graph_query', {
      cypher: 'MATCH (n) RETURN n',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Neo4j unavailable/);
  });
});

// ===========================================================================
// Models tools
// ===========================================================================

describe('models tools', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers both models tools', async () => {
    const { registerModelsTools } = await import('../tools/models.js');
    const server = new StubMcpServer();
    registerModelsTools(server as never);

    expect(server.has('models_list')).toBe(true);
    expect(server.has('models_download')).toBe(true);
  });

  it('models_list returns model registry array', async () => {
    vi.doMock('@aikb/core-embeddings', () => ({
      MODEL_REGISTRY: [
        { id: 'Xenova/all-MiniLM-L6-v2', dimensions: TEST_EMBEDDING_DIM, isDefault: true },
        { id: 'Xenova/bge-small-en-v1.5', dimensions: TEST_EMBEDDING_DIM, isDefault: false },
      ],
      createEmbeddingProvider: () => ({
        embed: () => Promise.resolve(new Array(TEST_EMBEDDING_DIM).fill(0) as number[]),
      }),
    }));

    const { registerModelsTools } = await import('../tools/models.js');
    const server = new StubMcpServer();
    registerModelsTools(server as never);

    const result = await server.call('models_list', {});
    expect(result.isError).toBeUndefined();
    const data = parseText(result) as Array<{ id: string }>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0]!.id).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('models_download calls provider.embed and returns success message', async () => {
    const embedMock = vi.fn().mockResolvedValue(new Array(TEST_EMBEDDING_DIM).fill(0) as number[]);
    vi.doMock('@aikb/core-embeddings', () => ({
      createEmbeddingProvider: () => ({ embed: embedMock }),
      MODEL_REGISTRY: [],
    }));

    const { registerModelsTools } = await import('../tools/models.js');
    const server = new StubMcpServer();
    registerModelsTools(server as never);

    const result = await server.call('models_download', {
      model_id: 'Xenova/all-MiniLM-L6-v2',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Downloaded');
    expect(result.content[0]?.text).toContain('Xenova/all-MiniLM-L6-v2');
    expect(embedMock).toHaveBeenCalled();
  });

  it('models_download returns isError:true on failure', async () => {
    vi.doMock('@aikb/core-embeddings', () => ({
      createEmbeddingProvider: () => ({
        embed: () => Promise.reject(new Error('download failed')),
      }),
      MODEL_REGISTRY: [],
    }));

    const { registerModelsTools } = await import('../tools/models.js');
    const server = new StubMcpServer();
    registerModelsTools(server as never);

    const result = await server.call('models_download', {
      model_id: 'bad/model',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/download failed/);
  });
});

// ===========================================================================
// Total tool count
// ===========================================================================

describe('all tools registered', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers exactly 12 tools across all groups', async () => {
    vi.doMock('@aikb/session-memory', () => ({
      createSessionStore: () => Promise.resolve({}),
    }));
    vi.doMock('@aikb/vector-store', () => ({
      createVectorStore: () => Promise.resolve({}),
    }));
    vi.doMock('@aikb/graph-store', () => ({
      createGraphStore: () => Promise.resolve({}),
      createExtractor: () => Promise.resolve({}),
      ingestChunks: () => Promise.resolve({}),
    }));
    vi.doMock('@aikb/core-embeddings', () => ({
      MODEL_REGISTRY: [],
      createEmbeddingProvider: () => ({}),
    }));

    const [
      { registerSessionTools },
      { registerVectorTools },
      { registerGraphTools },
      { registerModelsTools },
    ] = await Promise.all([
      import('../tools/session.js'),
      import('../tools/vector.js'),
      import('../tools/graph.js'),
      import('../tools/models.js'),
    ]);

    const server = new StubMcpServer();
    registerSessionTools(server as never);
    registerVectorTools(server as never);
    registerGraphTools(server as never);
    registerModelsTools(server as never);

    const expected = [
      'session_memory_add',
      'session_memory_get',
      'session_memory_list',
      'session_memory_search',
      'vector_ingest',
      'vector_query',
      'vector_status',
      'graph_ingest',
      'graph_query',
      'graph_ask',
      'models_list',
      'models_download',
    ];

    expect(server.toolNames().sort()).toEqual(expected.sort());
    expect(server.toolNames().length).toBe(12);
  });
});
