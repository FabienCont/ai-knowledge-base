import { describe, it, expect } from 'vitest';
import {
  DocumentSchema,
  createDocument,
  ChunkSchema,
  createChunk,
  QuerySchema,
  ResultItemSchema,
  QueryResultSchema,
  SessionEntrySchema,
  SessionMetaSchema,
  EntitySchema,
  RelationSchema,
  FileEntrySchema,
} from '../index.js';

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
const VALID_UUID_2 = '00000000-0000-4000-8000-000000000002';
const VALID_HASH = 'a'.repeat(64);
const VALID_DATETIME = '2024-01-01T00:00:00.000Z';

// ---------------------------------------------------------------------------
// DocumentSchema
// ---------------------------------------------------------------------------
describe('DocumentSchema', () => {
  const validDoc = {
    id: VALID_UUID,
    source_path: '/foo/bar.md',
    content: 'hello world',
    size_bytes: 11,
    hash: VALID_HASH,
    ingested_at: VALID_DATETIME,
  };

  it('accepts valid document data', () => {
    expect(() => DocumentSchema.parse(validDoc)).not.toThrow();
  });

  it('accepts optional fields', () => {
    const result = DocumentSchema.parse({
      ...validDoc,
      language: 'markdown',
      mime_type: 'text/plain',
      metadata: { key: 'value' },
    });
    expect(result.language).toBe('markdown');
    expect(result.mime_type).toBe('text/plain');
  });

  it('rejects missing required fields', () => {
    const result = DocumentSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid uuid', () => {
    const result = DocumentSchema.safeParse({ ...validDoc, id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects empty source_path', () => {
    const result = DocumentSchema.safeParse({ ...validDoc, source_path: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative size_bytes', () => {
    const result = DocumentSchema.safeParse({ ...validDoc, size_bytes: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects hash of wrong length', () => {
    const result = DocumentSchema.safeParse({ ...validDoc, hash: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects non-hex hash', () => {
    const result = DocumentSchema.safeParse({
      ...validDoc,
      hash: 'Z'.repeat(64),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid datetime', () => {
    const result = DocumentSchema.safeParse({
      ...validDoc,
      ingested_at: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer size_bytes', () => {
    const result = DocumentSchema.safeParse({ ...validDoc, size_bytes: 1.5 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createDocument factory
// ---------------------------------------------------------------------------
describe('createDocument', () => {
  it('produces a valid Document with generated id and ingested_at', () => {
    const doc = createDocument({
      source_path: '/foo/bar.ts',
      content: 'export {}',
      size_bytes: 9,
      hash: VALID_HASH,
    });
    expect(doc.id).toBeDefined();
    expect(doc.ingested_at).toBeDefined();
    expect(() => DocumentSchema.parse(doc)).not.toThrow();
  });

  it('generates a unique id on each call', () => {
    const fields = {
      source_path: '/a.ts',
      content: '',
      size_bytes: 0,
      hash: VALID_HASH,
    };
    const a = createDocument(fields);
    const b = createDocument(fields);
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// ChunkSchema
// ---------------------------------------------------------------------------
describe('ChunkSchema', () => {
  const validChunk = {
    id: VALID_UUID,
    document_id: VALID_UUID_2,
    source_path: '/foo/bar.md',
    content: 'some chunk text',
    hash: VALID_HASH,
    index: 0,
  };

  it('accepts valid chunk data', () => {
    expect(() => ChunkSchema.parse(validChunk)).not.toThrow();
  });

  it('accepts optional fields', () => {
    const result = ChunkSchema.parse({
      ...validChunk,
      line_start: 1,
      line_end: 5,
      language: 'typescript',
      metadata: {},
    });
    expect(result.line_start).toBe(1);
  });

  it('rejects empty content', () => {
    const result = ChunkSchema.safeParse({ ...validChunk, content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative index', () => {
    const result = ChunkSchema.safeParse({ ...validChunk, index: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid document_id uuid', () => {
    const result = ChunkSchema.safeParse({
      ...validChunk,
      document_id: 'bad-uuid',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createChunk factory
// ---------------------------------------------------------------------------
describe('createChunk', () => {
  it('produces a valid Chunk with generated id', () => {
    const chunk = createChunk({
      document_id: VALID_UUID_2,
      source_path: '/a.ts',
      content: 'hello',
      hash: VALID_HASH,
      index: 0,
    });
    expect(chunk.id).toBeDefined();
    expect(() => ChunkSchema.parse(chunk)).not.toThrow();
  });

  it('generates a unique id on each call', () => {
    const fields = {
      document_id: VALID_UUID_2,
      source_path: '/a.ts',
      content: 'hello',
      hash: VALID_HASH,
      index: 0,
    };
    const a = createChunk(fields);
    const b = createChunk(fields);
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// QuerySchema
// ---------------------------------------------------------------------------
describe('QuerySchema', () => {
  it('accepts valid query with defaults', () => {
    const result = QuerySchema.parse({ text: 'what is AI?' });
    expect(result.top_k).toBe(10);
  });

  it('accepts explicit top_k', () => {
    const result = QuerySchema.parse({ text: 'q', top_k: 5 });
    expect(result.top_k).toBe(5);
  });

  it('rejects empty text', () => {
    const result = QuerySchema.safeParse({ text: '' });
    expect(result.success).toBe(false);
  });

  it('rejects zero top_k', () => {
    const result = QuerySchema.safeParse({ text: 'q', top_k: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects min_score out of range', () => {
    const result = QuerySchema.safeParse({ text: 'q', min_score: 1.5 });
    expect(result.success).toBe(false);
  });

  it('accepts min_score at boundaries', () => {
    expect(QuerySchema.safeParse({ text: 'q', min_score: 0 }).success).toBe(
      true,
    );
    expect(QuerySchema.safeParse({ text: 'q', min_score: 1 }).success).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// ResultItemSchema & QueryResultSchema
// ---------------------------------------------------------------------------
describe('ResultItemSchema', () => {
  const validChunk = {
    id: VALID_UUID,
    document_id: VALID_UUID_2,
    source_path: '/a.md',
    content: 'text',
    hash: VALID_HASH,
    index: 0,
  };

  it('accepts valid result item', () => {
    expect(() =>
      ResultItemSchema.parse({ chunk: validChunk, score: 0.9 }),
    ).not.toThrow();
  });

  it('rejects score > 1', () => {
    const result = ResultItemSchema.safeParse({
      chunk: validChunk,
      score: 1.1,
    });
    expect(result.success).toBe(false);
  });
});

describe('QueryResultSchema', () => {
  it('accepts valid query result', () => {
    expect(() =>
      QueryResultSchema.parse({
        query: { text: 'q', top_k: 10 },
        items: [],
        duration_ms: 42,
      }),
    ).not.toThrow();
  });

  it('rejects negative duration_ms', () => {
    const result = QueryResultSchema.safeParse({
      query: { text: 'q', top_k: 10 },
      items: [],
      duration_ms: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionEntrySchema & SessionMetaSchema
// ---------------------------------------------------------------------------
describe('SessionEntrySchema', () => {
  const validEntry = {
    id: VALID_UUID,
    session_id: 'session-abc',
    role: 'user' as const,
    content: 'hello',
    timestamp: VALID_DATETIME,
  };

  it('accepts valid session entry', () => {
    expect(() => SessionEntrySchema.parse(validEntry)).not.toThrow();
  });

  it('accepts all roles', () => {
    for (const role of ['user', 'assistant', 'system', 'tool'] as const) {
      expect(
        SessionEntrySchema.safeParse({ ...validEntry, role }).success,
      ).toBe(true);
    }
  });

  it('rejects invalid role', () => {
    const result = SessionEntrySchema.safeParse({
      ...validEntry,
      role: 'admin',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty content', () => {
    const result = SessionEntrySchema.safeParse({ ...validEntry, content: '' });
    expect(result.success).toBe(false);
  });
});

describe('SessionMetaSchema', () => {
  it('accepts valid session meta', () => {
    expect(() =>
      SessionMetaSchema.parse({
        id: 'session-1',
        created_at: VALID_DATETIME,
        updated_at: VALID_DATETIME,
      }),
    ).not.toThrow();
  });

  it('accepts optional title and tags', () => {
    const result = SessionMetaSchema.parse({
      id: 'session-1',
      created_at: VALID_DATETIME,
      updated_at: VALID_DATETIME,
      title: 'My session',
      tags: ['ai', 'test'],
    });
    expect(result.tags).toEqual(['ai', 'test']);
  });
});

// ---------------------------------------------------------------------------
// EntitySchema & RelationSchema
// ---------------------------------------------------------------------------
describe('EntitySchema', () => {
  const validEntity = {
    id: VALID_UUID,
    name: 'TypeScript',
    type: 'Technology',
    source_chunk_ids: [VALID_UUID_2],
  };

  it('accepts valid entity', () => {
    expect(() => EntitySchema.parse(validEntity)).not.toThrow();
  });

  it('rejects empty name', () => {
    const result = EntitySchema.safeParse({ ...validEntity, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty type', () => {
    const result = EntitySchema.safeParse({ ...validEntity, type: '' });
    expect(result.success).toBe(false);
  });
});

describe('RelationSchema', () => {
  const validRelation = {
    id: VALID_UUID,
    subject_id: VALID_UUID,
    predicate: 'USES',
    object_id: VALID_UUID_2,
    source_chunk_ids: [VALID_UUID],
  };

  it('accepts valid relation', () => {
    expect(() => RelationSchema.parse(validRelation)).not.toThrow();
  });

  it('accepts optional confidence', () => {
    const result = RelationSchema.parse({
      ...validRelation,
      confidence: 0.85,
    });
    expect(result.confidence).toBe(0.85);
  });

  it('rejects confidence out of range', () => {
    const result = RelationSchema.safeParse({
      ...validRelation,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty predicate', () => {
    const result = RelationSchema.safeParse({
      ...validRelation,
      predicate: '',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FileEntrySchema
// ---------------------------------------------------------------------------
describe('FileEntrySchema', () => {
  const validFile = {
    path: '/home/user/docs/readme.md',
    relative_path: 'docs/readme.md',
    size_bytes: 1024,
    modified_at: VALID_DATETIME,
    extension: '.md',
  };

  it('accepts valid file entry', () => {
    expect(() => FileEntrySchema.parse(validFile)).not.toThrow();
  });

  it('rejects empty path', () => {
    const result = FileEntrySchema.safeParse({ ...validFile, path: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty relative_path', () => {
    const result = FileEntrySchema.safeParse({
      ...validFile,
      relative_path: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative size_bytes', () => {
    const result = FileEntrySchema.safeParse({ ...validFile, size_bytes: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer size_bytes', () => {
    const result = FileEntrySchema.safeParse({
      ...validFile,
      size_bytes: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty string extension (no extension files)', () => {
    const result = FileEntrySchema.safeParse({
      ...validFile,
      extension: '',
    });
    expect(result.success).toBe(true);
  });
});
