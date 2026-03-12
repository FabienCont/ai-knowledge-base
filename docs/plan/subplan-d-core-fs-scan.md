# ⬜ Subplan D — Core FS Scan

## Overview

Implement a recursive, configurable file-system scanner (`@aikb/core-fs-scan`) that yields `FileEntry` objects as an `AsyncIterable`. The scanner respects `.gitignore` files, supports include/exclude glob patterns, and produces deterministic output (sorted by path) suitable for incremental ingestion pipelines.

---

## Dependencies

- Subplan A (monorepo foundation)
- Subplan B (`@aikb/core-types` — `FileEntry` type)

---

## Detailed Tasks

### D1 ⬜ Package scaffold

- Create `packages/core-fs-scan/` using the Subplan A template
- Package name: `@aikb/core-fs-scan`
- Runtime dependencies:
  - `@aikb/core-types workspace:*`
  - `ignore ^5.3` — `.gitignore`-style pattern matching
  - `micromatch ^4.0` — glob matching for include/exclude
- Dev dependencies: `tmp-promise ^3.0` (for test temp dirs)

### D2 ⬜ ScanOptions interface

```ts
// src/types.ts
export interface ScanOptions {
  /** Glob patterns to include (default: ['**\/*']) */
  include?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
  /** Whether to read .gitignore files in each directory (default: true) */
  useGitignore?: boolean;
  /** Additional patterns to always ignore */
  defaultIgnore?: string[];
  /** Follow symlinks (default: false) */
  followSymlinks?: boolean;
  /** Maximum recursion depth (default: 20) */
  maxDepth?: number;
  /** Skip files larger than this (bytes, default: 5MB) */
  maxFileSize?: number;
  /** Root path (absolute). Required. */
  root: string;
}
```

Default ignore list (applied even when `useGitignore: false`):
```ts
export const DEFAULT_IGNORE = [
  '.git',
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.nyc_output',
  '*.tsbuildinfo',
  '.DS_Store',
  'Thumbs.db',
];
```

### D3 ⬜ GitignoreManager

```ts
// src/gitignore.ts
import ignore from 'ignore';

export class GitignoreManager {
  private readonly cache = new Map<string, ReturnType<typeof ignore>>();

  /** Load (and cache) the .gitignore for the given directory */
  async load(dir: string): Promise<void>;

  /** Returns true if the path should be ignored */
  isIgnored(absolutePath: string, relativePath: string): boolean;
}
```

- Use the `ignore` package to parse `.gitignore` content.
- Cache per-directory to avoid re-reading on every file.
- Walk up the directory tree to check parent `.gitignore` files (up to root).

### D4 ⬜ Core `scanFolder` function

```ts
// src/scanner.ts
import type { FileEntry } from '@aikb/core-types';
import type { ScanOptions } from './types.js';

/**
 * Recursively scan a directory and yield FileEntry objects.
 * Output is sorted deterministically by relative_path.
 */
export async function* scanFolder(
  options: ScanOptions,
): AsyncIterable<FileEntry>;
```

Implementation details:
1. Resolve `options.root` to an absolute path
2. Build a `GitignoreManager` instance (if `useGitignore` is true)
3. BFS or DFS traversal using `fs.opendir()` (Node 20 native async iterator)
4. For each entry:
   - Check `maxDepth`
   - Check `defaultIgnore` + `.gitignore` rules → skip if ignored
   - Check `include` globs via `micromatch`
   - Check `exclude` globs via `micromatch`
   - Check `maxFileSize` via `stat.size`
   - Check `followSymlinks` (use `lstat` to detect symlinks)
5. Collect all passing entries into an array, **sort by `relative_path`**, then yield
6. Handle ENOENT and EACCESS gracefully (log warning, continue)

> **Note on sorting**: To keep output deterministic, collect all entries in a directory before yielding them sorted. This trades some memory for determinism — acceptable for typical codebases.

### D5 ⬜ File metadata extraction

```ts
// src/metadata.ts
import type { FileEntry } from '@aikb/core-types';
import { extname, relative } from 'node:path';
import { stat } from 'node:fs/promises';

export async function toFileEntry(
  absolutePath: string,
  root: string,
): Promise<FileEntry>;
```

Fields:
- `path`: absolute path
- `relative_path`: `path.relative(root, absolutePath)`
- `size_bytes`: from `stat.size`
- `modified_at`: from `stat.mtime.toISOString()`
- `extension`: `path.extname(absolutePath)` (includes dot, e.g. `.ts`)

### D6 ⬜ Unit tests

`src/__tests__/scanner.test.ts`:

- Create temp directory structures with `tmp-promise` or Node `fs/promises`
- Test basic scan yields all files
- Test `exclude` glob filters out files
- Test `include` glob filters to only matching files
- Test `.gitignore` is respected (create a `.gitignore` in temp dir)
- Test `maxDepth` limits recursion
- Test `maxFileSize` skips large files
- Test symlinks: skipped when `followSymlinks: false`, followed when `true`
- Test output is **sorted** by `relative_path`
- Test `EACCESS` on a directory doesn't crash the scan
- Performance smoke test: scan a directory with 1000+ files completes within 2 seconds

---

## File Structure

```
packages/core-fs-scan/
├── src/
│   ├── index.ts          ← exports scanFolder, ScanOptions, DEFAULT_IGNORE
│   ├── types.ts          ← ScanOptions interface
│   ├── scanner.ts        ← scanFolder implementation
│   ├── gitignore.ts      ← GitignoreManager
│   ├── metadata.ts       ← toFileEntry helper
│   └── __tests__/
│       └── scanner.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key APIs / Interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `scanFolder(options)` | `async function*` | Main scan entry point |
| `ScanOptions` | interface | Scanner configuration |
| `DEFAULT_IGNORE` | `string[]` | Default patterns always ignored |
| `GitignoreManager` | class | Manages `.gitignore` reading/caching |

---

## Acceptance Criteria

- [ ] `pnpm --filter @aikb/core-fs-scan build` succeeds
- [ ] `pnpm --filter @aikb/core-fs-scan test` passes all cases
- [ ] Scanner yields `FileEntry` objects sorted deterministically by `relative_path`
- [ ] `.gitignore` files in scanned directories are respected
- [ ] `node_modules`, `.git`, `dist` are excluded by default
- [ ] Handles 10 000+ file trees without crashing or excessive memory use
- [ ] Symlinks are not followed by default
- [ ] Files exceeding `maxFileSize` are skipped (not an error)
- [ ] Inaccessible directories emit a warning and are skipped (no crash)

---

## Notes for Implementers

- Use `fs.opendir()` with `{ recursive: false }` and manual recursion rather than `fs.readdir({ recursive: true })` — it gives more control over depth, symlinks, and early-exit.
- The `ignore` package (used by git itself) handles `.gitignore` glob syntax correctly including negation (`!pattern`) — prefer it over manual glob matching for gitignore.
- Do **not** use `glob` packages that shell out or use regex — they're slower and less portable.
- Consider streaming output: yield as entries are found (after per-directory sorting) rather than collecting everything first, to support large codebases.
- The `relative_path` should always use forward slashes (`/`) even on Windows, for cross-platform consistency.
