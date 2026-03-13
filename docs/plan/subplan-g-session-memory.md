# ✅ Subplan G — Session Memory

## Overview

Implement a flat-text, file-based session memory store (`@aikb/session-memory`) that saves conversation turns as both human-readable Markdown and structured JSONL. The store supports create, add, get, list, and search operations with concurrency safety via file locks.

---

## Dependencies

- Subplan A (monorepo foundation)
- Subplan B (`@aikb/core-types` — `SessionEntry`, `SessionMeta`)
- Subplan C (`@aikb/core-config` — `SessionConfig`)

---

## Detailed Tasks

### G1 ✅ Package scaffold

- Package name: `@aikb/session-memory`
- Runtime dependencies:
  - `@aikb/core-types workspace:*`
  - `@aikb/core-config workspace:*`
  - `proper-lockfile ^4.1` — file-based locking for concurrent writes
- Built-in modules: `node:fs/promises`, `node:path`, `node:crypto`

### G2 ✅ Storage layout

```
{dataDir}/sessions/
├── {sessionId}/
│   ├── memory.md     ← human-readable transcript (append-only)
│   ├── events.jsonl  ← structured events (one JSON per line, append-only)
│   └── meta.json     ← session metadata (rewritten on update)
```

`memory.md` format:
```markdown
# Session: {sessionId}
Created: {createdAt}

---

**[user]** 2024-01-01T10:00:00Z

Hello, world!

---

**[assistant]** 2024-01-01T10:00:01Z

Hello! How can I help?

---
```

`events.jsonl` format (one `SessionEntry` JSON per line):
```jsonl
{"id":"uuid","session_id":"...","role":"user","content":"Hello","timestamp":"..."}
{"id":"uuid","session_id":"...","role":"assistant","content":"Hi!","timestamp":"..."}
```

`meta.json` format:
```json
{
  "id": "session-20240101-abc123",
  "created_at": "2024-01-01T10:00:00Z",
  "updated_at": "2024-01-01T10:05:00Z",
  "title": "My first session",
  "tags": ["work", "research"]
}
```

### G3 ✅ SessionStore interface

```ts
// src/types.ts
import type { SessionEntry, SessionMeta } from '@aikb/core-types';

export interface CreateSessionOptions {
  id?: string;      // auto-generated if omitted: 'session-{yyyymmdd}-{random6}'
  title?: string;
  tags?: string[];
}

export interface SearchOptions {
  /** Substring or regex pattern (as string, case-insensitive) */
  pattern: string;
  /** Max results to return (default: 20) */
  limit?: number;
}

export interface SearchResult {
  entry: SessionEntry;
  context_before?: string;  // text from memory.md around the match
  context_after?: string;
}

export interface SessionStore {
  /** Create a new session, return its metadata */
  create(options?: CreateSessionOptions): Promise<SessionMeta>;

  /** Append a new entry to an existing session */
  add(sessionId: string, entry: Omit<SessionEntry, 'id' | 'session_id'>): Promise<SessionEntry>;

  /** Get all entries for a session, in order */
  get(sessionId: string): Promise<{ meta: SessionMeta; entries: SessionEntry[] }>;

  /** List all sessions (meta only), sorted by updated_at desc */
  list(): Promise<SessionMeta[]>;

  /** Search across all sessions' memory.md content */
  search(options: SearchOptions): Promise<SearchResult[]>;

  /** Update session metadata (title, tags) */
  update(sessionId: string, patch: Partial<Pick<SessionMeta, 'title' | 'tags'>>): Promise<SessionMeta>;

  /** Delete a session and all its files */
  delete(sessionId: string): Promise<void>;
}
```

### G4 ✅ FileSessionStore implementation

```ts
// src/store.ts
import { lock, unlock } from 'proper-lockfile';

export class FileSessionStore implements SessionStore {
  constructor(private readonly dataDir: string) {}

  private sessionDir(sessionId: string): string {
    return path.join(this.dataDir, 'sessions', sessionId);
  }

  async create(options?: CreateSessionOptions): Promise<SessionMeta> {
    const id = options?.id ?? generateSessionId();
    const dir = this.sessionDir(id);
    await fs.mkdir(dir, { recursive: true });
    const meta: SessionMeta = {
      id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      title: options?.title,
      tags: options?.tags,
    };
    await this.writeMeta(id, meta);
    await this.initMemoryMd(id, meta);
    await fs.writeFile(path.join(dir, 'events.jsonl'), '', 'utf-8');
    return meta;
  }

  async add(
    sessionId: string,
    entry: Omit<SessionEntry, 'id' | 'session_id'>,
  ): Promise<SessionEntry> {
    const dir = this.sessionDir(sessionId);
    const lockFile = path.join(dir, 'events.jsonl');
    await lock(lockFile, { retries: { retries: 5, minTimeout: 50 } });
    try {
      const full: SessionEntry = {
        ...entry,
        id: crypto.randomUUID(),
        session_id: sessionId,
      };
      // Append to events.jsonl
      await fs.appendFile(lockFile, JSON.stringify(full) + '\n', 'utf-8');
      // Append to memory.md
      await this.appendToMemoryMd(sessionId, full);
      // Update meta.updated_at
      const meta = await this.readMeta(sessionId);
      await this.writeMeta(sessionId, { ...meta, updated_at: new Date().toISOString() });
      return full;
    } finally {
      await unlock(lockFile);
    }
  }

  // ... remaining methods
}
```

### G5 ✅ Session ID generation

```ts
function generateSessionId(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex');
  return `session-${dateStr}-${rand}`;
}
// Example: 'session-20240101-a3f7c1'
```

### G6 ✅ Search implementation

Search is done by:
1. Reading `memory.md` for each session
2. Splitting into lines
3. Matching each line against the pattern (substring or `new RegExp(pattern, 'i')`)
4. Locating the corresponding `SessionEntry` in `events.jsonl` (match by content substring)
5. Returning `SearchResult` with `context_before`/`context_after` lines

```ts
async search(options: SearchOptions): Promise<SearchResult[]> {
  const sessions = await this.list();
  const results: SearchResult[] = [];
  const regex = new RegExp(options.pattern, 'i');
  for (const session of sessions) {
    const content = await fs.readFile(
      path.join(this.sessionDir(session.id), 'memory.md'), 'utf-8'
    );
    // ... match and collect results
    if (results.length >= (options.limit ?? 20)) break;
  }
  return results.slice(0, options.limit ?? 20);
}
```

### G7 ✅ Factory function

```ts
// src/index.ts
import { getConfig } from '@aikb/core-config';

export async function createSessionStore(): Promise<SessionStore> {
  const config = await getConfig();
  return new FileSessionStore(config.session.data_dir);
}
```

### G8 ✅ Unit tests

`src/__tests__/store.test.ts`:

- Use a temp directory per test (via `beforeEach`/`afterEach` with `fs.mkdtemp`)
- Test `create()` produces correct directory layout and `meta.json`
- Test `add()` appends to both `events.jsonl` and `memory.md`
- Test `get()` returns entries in order
- Test `list()` returns sessions sorted by `updated_at` desc
- Test `search()` finds entries matching substring
- Test `search()` with regex pattern
- Test `search()` limit is respected
- Test `update()` changes title/tags and updates `updated_at`
- Test `delete()` removes all session files
- Test concurrent `add()` calls don't corrupt `events.jsonl` (write lock test)

---

## File Structure

```
packages/session-memory/
├── src/
│   ├── index.ts          ← exports createSessionStore, SessionStore, FileSessionStore
│   ├── types.ts          ← SessionStore interface, CreateSessionOptions, SearchOptions
│   ├── store.ts          ← FileSessionStore implementation
│   ├── format.ts         ← memory.md formatter
│   └── __tests__/
│       └── store.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key APIs / Interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `createSessionStore()` | `async function` | Factory — reads config, returns store |
| `FileSessionStore` | class | File-based implementation |
| `SessionStore` | interface | Store contract |
| `CreateSessionOptions` | interface | Options for `create()` |
| `SearchOptions` | interface | Options for `search()` |
| `SearchResult` | interface | Search result item |

---

## Acceptance Criteria

- [x] `pnpm --filter @aikb/session-memory build` succeeds
- [x] `pnpm --filter @aikb/session-memory test` passes all tests
- [x] `create()` → `add()` → `get()` round-trip works correctly
- [x] `search()` finds text in memory.md (substring match)
- [x] Concurrent writes don't corrupt `events.jsonl`
- [x] `list()` returns sessions newest first
- [x] Deleting a session removes all files and directory
- [x] Storage layout matches the spec above exactly

---

## Notes for Implementers

- The `memory.md` file is the human-friendly format — it should be readable by a person in any text editor. Keep it clean and well-formatted.
- `events.jsonl` is the machine-readable source of truth — always parse from JSONL, not from the markdown.
- `proper-lockfile` creates a `.lock` file alongside the target file. Clean up lock files in CI.
- Keep the search implementation simple (line-by-line regex) — no need for full-text search infrastructure at this stage. Vector search for session memory can come later.
- Session IDs should be URL-safe (no special chars) since they appear in file paths.
- Consider adding a `compact()` method in the future to merge identical entries, but keep JSONL append-only for now.
