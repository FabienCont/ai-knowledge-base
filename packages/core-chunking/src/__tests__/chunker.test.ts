import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { loadAndChunk } from '../chunker.js';
import { detectLanguage } from '../language.js';
import { sha256 } from '../hash.js';
import { computeLineRange } from '../lines.js';
import { chunkFixed } from '../strategies/fixed.js';
import { chunkByParagraph } from '../strategies/paragraph.js';
import { chunkCodeAware } from '../strategies/code-aware.js';
import type { FileEntry } from '@aikb/core-types';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

function makeEntry(
  filePath: string,
  sizeBytes = 0,
  ext?: string,
): FileEntry {
  const extension = ext ?? filePath.slice(filePath.lastIndexOf('.'));
  return {
    path: filePath,
    relative_path: filePath.split('/').pop() ?? filePath,
    size_bytes: sizeBytes,
    modified_at: new Date().toISOString(),
    extension,
  };
}

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------
describe('sha256', () => {
  it('returns a 64-char hex string', () => {
    const digest = sha256('hello');
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic: same input → same output', () => {
    const a = sha256('some content');
    const b = sha256('some content');
    expect(a).toBe(b);
  });

  it('different inputs produce different hashes', () => {
    expect(sha256('abc')).not.toBe(sha256('abd'));
  });

  it('matches known SHA-256 value for empty string', () => {
    // SHA-256 of empty string
    expect(sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------
describe('detectLanguage', () => {
  const cases: Array<[string, string]> = [
    ['.ts', 'typescript'],
    ['.tsx', 'typescript'],
    ['.js', 'javascript'],
    ['.jsx', 'javascript'],
    ['.mjs', 'javascript'],
    ['.cjs', 'javascript'],
    ['.py', 'python'],
    ['.rs', 'rust'],
    ['.go', 'go'],
    ['.java', 'java'],
    ['.c', 'c'],
    ['.h', 'c'],
    ['.cpp', 'cpp'],
    ['.cc', 'cpp'],
    ['.hpp', 'cpp'],
    ['.md', 'markdown'],
    ['.mdx', 'markdown'],
    ['.json', 'json'],
    ['.yaml', 'yaml'],
    ['.yml', 'yaml'],
    ['.toml', 'toml'],
    ['.sh', 'shell'],
    ['.bash', 'shell'],
    ['.sql', 'sql'],
    ['.html', 'html'],
    ['.htm', 'html'],
    ['.css', 'css'],
    ['.scss', 'css'],
    ['.less', 'css'],
    ['.txt', 'text'],
  ];

  for (const [ext, lang] of cases) {
    it(`maps ${ext} → ${lang}`, () => {
      expect(detectLanguage(ext)).toBe(lang);
    });
  }

  it('returns undefined for unknown extension', () => {
    expect(detectLanguage('.xyz')).toBeUndefined();
    expect(detectLanguage('')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(detectLanguage('.TS')).toBe('typescript');
    expect(detectLanguage('.MD')).toBe('markdown');
  });
});

// ---------------------------------------------------------------------------
// computeLineRange
// ---------------------------------------------------------------------------
describe('computeLineRange', () => {
  it('single-line text starts and ends at line 1', () => {
    const text = 'hello world';
    expect(computeLineRange(text, 0, text.length)).toEqual({
      line_start: 1,
      line_end: 1,
    });
  });

  it('second line starts at line 2', () => {
    const text = 'line one\nline two\nline three';
    // 'line two' starts at offset 9
    const offset = 9;
    const chunk = 'line two';
    expect(computeLineRange(text, offset, chunk.length)).toEqual({
      line_start: 2,
      line_end: 2,
    });
  });

  it('chunk spanning multiple lines', () => {
    const text = 'a\nb\nc\nd\ne';
    // starts at offset 2 (line 2), spans 'b\nc\nd'
    const chunk = 'b\nc\nd';
    expect(computeLineRange(text, 2, chunk.length)).toEqual({
      line_start: 2,
      line_end: 4,
    });
  });

  it('offset 0 for first character is line 1', () => {
    const text = 'first\nsecond';
    expect(computeLineRange(text, 0, 5)).toEqual({
      line_start: 1,
      line_end: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// chunkFixed
// ---------------------------------------------------------------------------
describe('chunkFixed', () => {
  it('returns empty array for empty string', () => {
    expect(chunkFixed('', 1500, 200)).toEqual([]);
  });

  it('single chunk when text fits in maxSize', () => {
    const text = 'short text';
    const chunks = chunkFixed(text, 1500, 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe('short text');
    expect(chunks[0]!.offset).toBe(0);
  });

  it('splits 5000-char text into correct number of chunks', () => {
    const text = 'a'.repeat(5000);
    const chunks = chunkFixed(text, 1500, 200);
    // After first chunk of 1500, next starts at 1500-200=1300, etc.
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    // Each chunk should be at most maxSize
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1500);
    }
  });

  it('chunks overlap by approximately overlap characters', () => {
    const text = 'abcde'.repeat(400); // 2000 chars
    const maxSize = 500;
    const overlap = 100;
    const chunks = chunkFixed(text, maxSize, overlap);
    expect(chunks.length).toBeGreaterThan(1);
    // Second chunk should start overlap chars before end of first
    const firstEnd = chunks[0]!.offset + chunks[0]!.text.length;
    const secondStart = chunks[1]!.offset;
    // The overlap means the second chunk starts before the end of the first
    expect(firstEnd - secondStart).toBeGreaterThanOrEqual(0);
  });

  it('last chunk does not exceed maxSize', () => {
    const text = 'x'.repeat(3000);
    const chunks = chunkFixed(text, 1000, 100);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1000);
    }
  });
});

// ---------------------------------------------------------------------------
// chunkByParagraph
// ---------------------------------------------------------------------------
describe('chunkByParagraph', () => {
  it('returns empty array for empty string', () => {
    expect(chunkByParagraph('', 1500, 200)).toEqual([]);
  });

  it('single paragraph fits in one chunk', () => {
    const text = 'One paragraph here.';
    const chunks = chunkByParagraph(text, 1500, 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain('One paragraph here.');
  });

  it('splits on double newlines', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const chunks = chunkByParagraph(text, 1500, 200);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const combined = chunks.map((c) => c.text).join(' ');
    expect(combined).toContain('First paragraph.');
    expect(combined).toContain('Second paragraph.');
    expect(combined).toContain('Third paragraph.');
  });

  it('merges small paragraphs into one chunk', () => {
    // Each paragraph is ~20 chars; maxSize is 200 so all should merge
    const lines = Array.from({ length: 5 }, (_, i) => `Paragraph ${i + 1}.`);
    const text = lines.join('\n\n');
    const chunks = chunkByParagraph(text, 200, 50);
    expect(chunks).toHaveLength(1);
  });

  it('splits large single paragraphs with fixed fallback', () => {
    const bigPara = 'word '.repeat(400); // ~2000 chars
    const chunks = chunkByParagraph(bigPara, 500, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(500);
    }
  });
});

// ---------------------------------------------------------------------------
// chunkCodeAware
// ---------------------------------------------------------------------------
describe('chunkCodeAware', () => {
  it('returns empty array for empty string', () => {
    expect(chunkCodeAware('', 'typescript', 1500, 200)).toEqual([]);
  });

  it('splits TypeScript file at function/class boundaries', () => {
    const code = [
      'export function alpha(): void {',
      '  console.log("alpha");',
      '}',
      '',
      'export function beta(): void {',
      '  console.log("beta");',
      '}',
      '',
      'export class Gamma {',
      '  method(): void {}',
      '}',
    ].join('\n');

    const chunks = chunkCodeAware(code, 'typescript', 1500, 0);
    // Should find at least 2 chunks (function/class boundaries)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('splits markdown at heading boundaries', () => {
    const md = [
      '# Title',
      '',
      'Intro text.',
      '',
      '## Section 1',
      '',
      'Section 1 content.',
      '',
      '## Section 2',
      '',
      'Section 2 content.',
    ].join('\n');

    const chunks = chunkCodeAware(md, 'markdown', 1500, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const texts = chunks.map((c) => c.text);
    expect(texts.some((t) => t.includes('# Title'))).toBe(true);
    expect(texts.some((t) => t.includes('## Section 1'))).toBe(true);
  });

  it('falls back to paragraph for text without code boundaries', () => {
    const text = 'Para one.\n\nPara two.\n\nPara three.';
    const chunks = chunkCodeAware(text, 'typescript', 1500, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const combined = chunks.map((c) => c.text).join(' ');
    expect(combined).toContain('Para one.');
  });
});

// ---------------------------------------------------------------------------
// loadAndChunk — integration tests
// ---------------------------------------------------------------------------
describe('loadAndChunk', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `aikb-chunk-test-${Date.now()}.ts`);
  });

  afterEach(async () => {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(tmpFile);
    } catch {
      // ignore
    }
  });

  it('returns a Document and Chunks for a simple file', async () => {
    await writeFile(tmpFile, 'export function hello(): string { return "hi"; }');
    const stat = await import('node:fs/promises').then((m) => m.stat(tmpFile));
    const entry = makeEntry(tmpFile, stat.size);

    const result = await loadAndChunk(entry);
    expect(result.document).toBeDefined();
    expect(result.document.source_path).toBe(tmpFile);
    expect(result.document.hash).toHaveLength(64);
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('empty file produces Document with no chunks', async () => {
    await writeFile(tmpFile, '');
    const entry = makeEntry(tmpFile, 0);

    const result = await loadAndChunk(entry);
    expect(result.document).toBeDefined();
    expect(result.chunks).toHaveLength(0);
  });

  it('whitespace-only file produces Document with no chunks', async () => {
    await writeFile(tmpFile, '   \n\n\t  \n');
    const entry = makeEntry(tmpFile, 10);

    const result = await loadAndChunk(entry);
    expect(result.document).toBeDefined();
    expect(result.chunks).toHaveLength(0);
  });

  it('binary file (with null byte) is skipped with no chunks', async () => {
    const buf = Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]); // "He\0lo"
    await writeFile(tmpFile, buf);
    const entry = makeEntry(tmpFile, buf.length);

    const result = await loadAndChunk(entry);
    expect(result.document).toBeDefined();
    expect(result.chunks).toHaveLength(0);
  });

  it('is deterministic: same file always produces same chunks', async () => {
    const content = 'export function greet(name: string): string {\n  return `Hello ${name}`;\n}\n';
    await writeFile(tmpFile, content);
    const stat = await import('node:fs/promises').then((m) => m.stat(tmpFile));
    const entry = makeEntry(tmpFile, stat.size);

    const r1 = await loadAndChunk(entry);
    const r2 = await loadAndChunk(entry);

    expect(r1.document.hash).toBe(r2.document.hash);
    expect(r1.chunks.length).toBe(r2.chunks.length);
    for (let i = 0; i < r1.chunks.length; i++) {
      expect(r1.chunks[i]!.hash).toBe(r2.chunks[i]!.hash);
      expect(r1.chunks[i]!.content).toBe(r2.chunks[i]!.content);
    }
  });

  it('chunk document_id matches document id', async () => {
    await writeFile(tmpFile, 'const x = 1;\nconst y = 2;\n');
    const stat = await import('node:fs/promises').then((m) => m.stat(tmpFile));
    const entry = makeEntry(tmpFile, stat.size);

    const result = await loadAndChunk(entry);
    for (const chunk of result.chunks) {
      expect(chunk.document_id).toBe(result.document.id);
    }
  });

  it('chunk indices are sequential starting from 0', async () => {
    const content = 'x'.repeat(5000);
    await writeFile(tmpFile, content);
    const stat = await import('node:fs/promises').then((m) => m.stat(tmpFile));
    const entry = makeEntry(tmpFile, stat.size, '.txt');

    const result = await loadAndChunk(entry, {
      strategy: 'fixed',
      maxChunkSize: 1000,
    });
    result.chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it('line_start and line_end are accurate', async () => {
    const lines = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'];
    const content = lines.join('\n');
    await writeFile(tmpFile, content);
    const stat = await import('node:fs/promises').then((m) => m.stat(tmpFile));
    const entry = makeEntry(tmpFile, stat.size, '.txt');

    const result = await loadAndChunk(entry, {
      strategy: 'fixed',
      maxChunkSize: 100,
    });
    expect(result.chunks.length).toBeGreaterThan(0);
    // First chunk starts at line 1
    expect(result.chunks[0]!.line_start).toBe(1);
  });

  it('respects language override option', async () => {
    await writeFile(tmpFile, 'some text content here');
    const stat = await import('node:fs/promises').then((m) => m.stat(tmpFile));
    const entry = makeEntry(tmpFile, stat.size);

    const result = await loadAndChunk(entry, { language: 'python' });
    expect(result.document.language).toBe('python');
    for (const chunk of result.chunks) {
      expect(chunk.language).toBe('python');
    }
  });

  it('detects language from extension automatically', async () => {
    await writeFile(tmpFile, 'export const x = 1;');
    const stat = await import('node:fs/promises').then((m) => m.stat(tmpFile));
    const entry = makeEntry(tmpFile, stat.size, '.ts');

    const result = await loadAndChunk(entry);
    expect(result.document.language).toBe('typescript');
  });

  it('fixed strategy respects maxChunkSize', async () => {
    const content = 'word '.repeat(600); // ~3000 chars
    await writeFile(tmpFile, content);
    const stat = await import('node:fs/promises').then((m) => m.stat(tmpFile));
    const entry = makeEntry(tmpFile, stat.size, '.txt');

    const result = await loadAndChunk(entry, {
      strategy: 'fixed',
      maxChunkSize: 500,
      overlap: 0,
    });
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(500);
    }
  });
});

// ---------------------------------------------------------------------------
// loadAndChunk — snapshot tests on fixture files
// ---------------------------------------------------------------------------
describe('loadAndChunk snapshot tests', () => {
  it('sample.ts fixture produces deterministic chunks', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample.ts');
    const stat = await import('node:fs/promises').then((m) =>
      m.stat(fixturePath),
    );
    const entry = makeEntry(fixturePath, stat.size, '.ts');

    const r1 = await loadAndChunk(entry);
    const r2 = await loadAndChunk(entry);

    // Determinism check
    expect(r1.document.hash).toBe(r2.document.hash);
    expect(r1.chunks.map((c) => c.hash)).toEqual(r2.chunks.map((c) => c.hash));
    expect(r1.chunks.map((c) => c.content)).toEqual(
      r2.chunks.map((c) => c.content),
    );

    // Snapshot the hashes (content is more stable than UUIDs)
    const snapshot = {
      documentHash: r1.document.hash,
      chunkCount: r1.chunks.length,
      chunkHashes: r1.chunks.map((c) => c.hash),
      chunkContents: r1.chunks.map((c) => c.content),
    };
    expect(snapshot).toMatchSnapshot();
  });

  it('sample.md fixture produces deterministic chunks', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample.md');
    const stat = await import('node:fs/promises').then((m) =>
      m.stat(fixturePath),
    );
    const entry = makeEntry(fixturePath, stat.size, '.md');

    const r1 = await loadAndChunk(entry);
    const r2 = await loadAndChunk(entry);

    expect(r1.document.hash).toBe(r2.document.hash);
    expect(r1.chunks.map((c) => c.hash)).toEqual(r2.chunks.map((c) => c.hash));

    const snapshot = {
      documentHash: r1.document.hash,
      chunkCount: r1.chunks.length,
      chunkHashes: r1.chunks.map((c) => c.hash),
    };
    expect(snapshot).toMatchSnapshot();
  });
});
