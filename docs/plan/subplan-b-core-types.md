# ⬜ Subplan B — Core Types

## Overview

Define the canonical TypeScript types and Zod schemas used by every package in the monorepo. This package (`@aikb/core-types`) is the **single source of truth** for all domain objects. It has no runtime dependencies beyond Zod.

---

## Dependencies

- Subplan A (monorepo foundation) must be complete

---

## Detailed Tasks

### B1 ⬜ Package scaffold

- Create `packages/core-types/` using the template from Subplan A
- `package.json` name: `@aikb/core-types`
- Runtime dependency: `zod ^3.22`
- No other runtime dependencies

### B2 ⬜ Document type

Represents a single ingested file before chunking.

```ts
// src/types/document.ts
import { z } from 'zod';

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  source_path: z.string().min(1),
  content: z.string(),
  language: z.string().optional(),   // e.g. "typescript", "markdown"
  mime_type: z.string().optional(),  // e.g. "text/plain"
  size_bytes: z.number().int().nonnegative(),
  hash: z.string().length(64),       // SHA-256 hex
  ingested_at: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

export type Document = z.infer<typeof DocumentSchema>;
```

Factory:
```ts
export function createDocument(fields: Omit<Document, 'id' | 'ingested_at'>): Document;
```

### B3 ⬜ Chunk type

Represents a subsection of a Document.

```ts
// src/types/chunk.ts
export const ChunkSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  source_path: z.string().min(1),
  content: z.string().min(1),
  hash: z.string().length(64),       // SHA-256 of chunk content
  index: z.number().int().nonnegative(),  // chunk order within document
  line_start: z.number().int().nonnegative().optional(),
  line_end: z.number().int().nonnegative().optional(),
  language: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Chunk = z.infer<typeof ChunkSchema>;
```

Factory: `createChunk(fields: Omit<Chunk, 'id'>): Chunk`

### B4 ⬜ Query & result types

```ts
// src/types/query.ts
export const QuerySchema = z.object({
  text: z.string().min(1),
  top_k: z.number().int().positive().default(10),
  filter: z.record(z.unknown()).optional(),
  min_score: z.number().min(0).max(1).optional(),
});
export type Query = z.infer<typeof QuerySchema>;

export const ResultItemSchema = z.object({
  chunk: ChunkSchema,
  score: z.number().min(0).max(1),
});
export type ResultItem = z.infer<typeof ResultItemSchema>;

export const QueryResultSchema = z.object({
  query: QuerySchema,
  items: z.array(ResultItemSchema),
  duration_ms: z.number().nonnegative(),
});
export type QueryResult = z.infer<typeof QueryResultSchema>;
```

### B5 ⬜ SessionEntry type

```ts
// src/types/session.ts
export const SessionEntrySchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});
export type SessionEntry = z.infer<typeof SessionEntrySchema>;

export const SessionMetaSchema = z.object({
  id: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;
```

### B6 ⬜ Entity & Relation types (for graph store)

```ts
// src/types/graph.ts
export const EntitySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: z.string().min(1),        // e.g. "Person", "Concept", "Technology"
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
  source_chunk_ids: z.array(z.string().uuid()),
  metadata: z.record(z.unknown()).optional(),
});
export type Entity = z.infer<typeof EntitySchema>;

export const RelationSchema = z.object({
  id: z.string().uuid(),
  subject_id: z.string().uuid(),  // Entity id
  predicate: z.string().min(1),   // e.g. "USES", "DEPENDS_ON", "AUTHORED_BY"
  object_id: z.string().uuid(),   // Entity id
  source_chunk_ids: z.array(z.string().uuid()),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type Relation = z.infer<typeof RelationSchema>;
```

### B7 ⬜ FileEntry type (for fs-scan)

```ts
// src/types/fs.ts
export const FileEntrySchema = z.object({
  path: z.string().min(1),         // absolute path
  relative_path: z.string().min(1),// relative to scan root
  size_bytes: z.number().int().nonnegative(),
  modified_at: z.string().datetime(),
  extension: z.string(),            // e.g. ".ts", ".md"
});
export type FileEntry = z.infer<typeof FileEntrySchema>;
```

### B8 ⬜ Barrel exports

`src/index.ts` re-exports all types and schemas:
```ts
export * from './types/document.js';
export * from './types/chunk.js';
export * from './types/query.js';
export * from './types/session.js';
export * from './types/graph.js';
export * from './types/fs.js';
```

### B9 ⬜ Unit tests

Test file: `src/__tests__/schemas.test.ts`

- Test `DocumentSchema.parse()` accepts valid data
- Test `DocumentSchema.safeParse()` rejects invalid data (missing fields, wrong types)
- Test `ChunkSchema` validation
- Test `QuerySchema` default values (e.g. `top_k` defaults to 10)
- Test factory helpers produce correct shapes
- Target: **100% branch coverage** on all validators

---

## File Structure

```
packages/core-types/
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── document.ts
│   │   ├── chunk.ts
│   │   ├── query.ts
│   │   ├── session.ts
│   │   ├── graph.ts
│   │   └── fs.ts
│   └── __tests__/
│       └── schemas.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key APIs / Interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `Document`, `DocumentSchema` | type + zod | Ingested file |
| `Chunk`, `ChunkSchema` | type + zod | Text chunk from a document |
| `Query`, `QuerySchema` | type + zod | Search query |
| `QueryResult`, `QueryResultSchema` | type + zod | Search result set |
| `ResultItem`, `ResultItemSchema` | type + zod | Single result in a query |
| `SessionEntry`, `SessionEntrySchema` | type + zod | One memory entry |
| `SessionMeta`, `SessionMetaSchema` | type + zod | Session metadata |
| `Entity`, `EntitySchema` | type + zod | Graph entity |
| `Relation`, `RelationSchema` | type + zod | Graph relation |
| `FileEntry`, `FileEntrySchema` | type + zod | Scanned file |
| `createDocument()` | factory | Creates Document with generated id/timestamp |
| `createChunk()` | factory | Creates Chunk with generated id |

---

## Acceptance Criteria

- [ ] `pnpm --filter @aikb/core-types build` succeeds — emits ESM + CJS + `.d.ts`
- [ ] `pnpm --filter @aikb/core-types test` passes with 100% coverage on schema validators
- [ ] All types are importable as `import { Document } from '@aikb/core-types'`
- [ ] Invalid data is rejected by Zod with descriptive error messages
- [ ] No runtime imports beyond `zod` (keep bundle tiny)

---

## Notes for Implementers

- Prefer `z.object()` over `z.interface()` — it has better default behavior for `parse` vs `safeParse`.
- Use `.datetime()` for all timestamps — this validates ISO 8601 format.
- The `hash` field is always a **lowercase hex SHA-256** (64 chars). Use `z.string().length(64).regex(/^[0-9a-f]+$/)` for extra safety.
- Factory helpers should use `crypto.randomUUID()` (Node 20 built-in) for IDs and `new Date().toISOString()` for timestamps.
- Keep this package **pure types + validators** — no file I/O, no network, no heavy dependencies.
