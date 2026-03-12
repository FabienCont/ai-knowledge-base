# ✅ Subplan E — Core Chunking

## Overview

Implement the text chunking library (`@aikb/core-chunking`) that reads a file from disk, splits it into overlapping chunks, attaches rich metadata (source path, language, line numbers), and computes deterministic SHA-256 hashes at both the document and chunk level. Chunking must be deterministic — same input always produces same chunks with same hashes.

---

## Dependencies

- Subplan A (monorepo foundation)
- Subplan B (`@aikb/core-types` — `Document`, `Chunk`, `FileEntry` types)
- Subplan D (`@aikb/core-fs-scan` — `FileEntry` for input)

---

## Detailed Tasks

### E1 ✅ Package scaffold

- Package name: `@aikb/core-chunking`
- Runtime dependencies:
  - `@aikb/core-types workspace:*`
  - `@aikb/core-fs-scan workspace:*`
- Built-in Node modules used: `node:crypto`, `node:fs/promises`, `node:path`

### E2 ✅ ChunkOptions interface

```ts
// src/types.ts
export type ChunkStrategy = 'fixed' | 'paragraph' | 'code-aware';

export interface ChunkOptions {
  /** Maximum characters per chunk (default: 1500) */
  maxChunkSize?: number;
  /** Overlap characters between adjacent chunks (default: 200) */
  overlap?: number;
  /** Chunking strategy (default: 'code-aware') */
  strategy?: ChunkStrategy;
  /** Override language detection */
  language?: string;
}
```

### E3 ✅ Language detection

```ts
// src/language.ts
export function detectLanguage(extension: string): string | undefined;
```

Map file extensions to language identifiers:

| Extensions | Language |
|-----------|---------|
| `.ts`, `.tsx` | `typescript` |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `javascript` |
| `.py` | `python` |
| `.rs` | `rust` |
| `.go` | `go` |
| `.java` | `java` |
| `.c`, `.h` | `c` |
| `.cpp`, `.cc`, `.hpp` | `cpp` |
| `.md`, `.mdx` | `markdown` |
| `.json` | `json` |
| `.yaml`, `.yml` | `yaml` |
| `.toml` | `toml` |
| `.sh`, `.bash` | `shell` |
| `.sql` | `sql` |
| `.html`, `.htm` | `html` |
| `.css`, `.scss`, `.less` | `css` |
| `.txt` | `text` |

Returns `undefined` for unknown extensions.

### E4 ✅ Chunking strategies

#### Strategy 1: `fixed`
Simple sliding window on characters:
```ts
function chunkFixed(text: string, maxSize: number, overlap: number): string[];
```
- Split at every `maxSize` character boundary
- Each chunk overlaps with previous by `overlap` characters
- Trim whitespace from chunk edges

#### Strategy 2: `paragraph`
Split on blank lines (`\n\n+`), then merge small paragraphs and split large ones:
```ts
function chunkByParagraph(text: string, maxSize: number, overlap: number): string[];
```
- Split on `\n\n+` to get paragraph boundaries
- Merge consecutive short paragraphs until `maxSize` would be exceeded
- If a single paragraph exceeds `maxSize`, fall back to fixed chunking for that paragraph
- Re-attach overlap text from the end of the previous chunk

#### Strategy 3: `code-aware`
Attempt to split at logical boundaries (function/class boundaries):
```ts
function chunkCodeAware(
  text: string,
  language: string | undefined,
  maxSize: number,
  overlap: number,
): string[];
```
Logic:
- For `markdown`: split on headings (`^#+ `) first, then paragraph within sections
- For code languages: split on top-level function/class definitions using line-based heuristics (lines matching `^(export )?(async )?function|^(export )?class|^def |^fn `)
- Fall back to paragraph strategy if no structural boundaries found
- Fall back to fixed strategy if chunks are still too large

### E5 ✅ Line number tracking

Compute `line_start` and `line_end` for each chunk:
```ts
function computeLineRange(
  fullText: string,
  chunkText: string,
  chunkCharOffset: number,
): { line_start: number; line_end: number };
```
- Count newlines from offset 0 to chunk start → `line_start`
- Count newlines from chunk start to chunk end → `line_end`
- Lines are 1-indexed

### E6 ✅ SHA-256 hashing

```ts
// src/hash.ts
import { createHash } from 'node:crypto';

/** Compute SHA-256 hex digest of a string (UTF-8 encoded) */
export function sha256(content: string): string;
```

- Document hash: `sha256(fileContent)`
- Chunk hash: `sha256(chunk.content)` — chunk text only (not metadata)

### E7 ✅ Main `loadAndChunk` function

```ts
// src/chunker.ts
import type { Document, Chunk } from '@aikb/core-types';
import type { FileEntry } from '@aikb/core-types';
import type { ChunkOptions } from './types.js';

export interface LoadAndChunkResult {
  document: Document;
  chunks: Chunk[];
}

/**
 * Read a file from disk, create a Document, and split into Chunks.
 */
export async function loadAndChunk(
  entry: FileEntry,
  options?: ChunkOptions,
): Promise<LoadAndChunkResult>;
```

Steps:
1. Read file content with `fs.readFile(entry.path, 'utf-8')`
2. Compute `documentHash = sha256(content)`
3. Detect language from `entry.extension`
4. Create `Document` object via `createDocument()`
5. Select chunking strategy (from options or default `code-aware`)
6. Run chosen strategy → array of chunk strings with char offsets
7. For each chunk string:
   - Compute `chunkHash = sha256(chunkText)`
   - Compute `{ line_start, line_end }` from char offset
   - Create `Chunk` object via `createChunk()`
8. Return `{ document, chunks }`

### E8 ✅ Unit tests — golden snapshots

`src/__tests__/chunker.test.ts`:

- Test `fixed` strategy: given 5000-char text + maxChunkSize=1500 + overlap=200, verify chunk count and overlap
- Test `paragraph` strategy: markdown text with clear `\n\n` boundaries
- Test `code-aware` strategy on a TypeScript file with functions and classes
- **Snapshot tests**: `loadAndChunk` on a known test fixture file → snapshot the `chunks` array → verify determinism across runs
- Test `sha256` consistency (same input → same output)
- Test `line_start` / `line_end` accuracy
- Test language detection for all mapped extensions
- Test empty file → single empty chunk or zero chunks (document still created)

---

## File Structure

```
packages/core-chunking/
├── src/
│   ├── index.ts          ← exports loadAndChunk, ChunkOptions, ChunkStrategy
│   ├── types.ts          ← ChunkOptions, ChunkStrategy
│   ├── chunker.ts        ← loadAndChunk implementation
│   ├── strategies/
│   │   ├── fixed.ts
│   │   ├── paragraph.ts
│   │   └── code-aware.ts
│   ├── language.ts       ← detectLanguage
│   ├── hash.ts           ← sha256 helper
│   ├── lines.ts          ← computeLineRange
│   └── __tests__/
│       ├── chunker.test.ts
│       └── fixtures/
│           ├── sample.ts
│           └── sample.md
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key APIs / Interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `loadAndChunk(entry, options?)` | `async function` | Load file and return Document + Chunks |
| `ChunkOptions` | interface | Chunking configuration |
| `ChunkStrategy` | `'fixed' \| 'paragraph' \| 'code-aware'` | Strategy enum |
| `detectLanguage(ext)` | `function` | Map extension to language string |
| `sha256(text)` | `function` | SHA-256 hex digest |

---

## Acceptance Criteria

- [x] `pnpm --filter @aikb/core-chunking build` succeeds
- [x] `pnpm --filter @aikb/core-chunking test` passes including snapshot tests
- [x] Same file always produces same chunks and hashes (determinism)
- [x] `line_start` / `line_end` are accurate (verified against test fixtures)
- [x] Chunks respect `maxChunkSize` (no chunk exceeds it by more than the overlap)
- [x] Adjacent chunks overlap by at most `overlap` characters
- [x] Empty files produce a `Document` with `chunks: []`
- [x] Binary files (detected by presence of null bytes) are skipped with a warning, not crashed on

---

## Notes for Implementers

- The `code-aware` strategy doesn't need to be a full AST parser — a line-based heuristic is good enough. Save full parsing for a future enhancement.
- Keep chunk metadata (`source_path`, `language`, `line_start`, `line_end`) on every chunk — the vector store and graph store depend on this for filtering and attribution.
- Do NOT deduplicate identical chunks — the `index` field preserves ordering and the consumer can deduplicate by `hash` if needed.
- Snapshot tests are critical — add them early and update them intentionally when chunking logic changes.
- For large files (>1MB), stream reading is more memory-efficient, but for simplicity start with `readFile` and add streaming later if needed.
