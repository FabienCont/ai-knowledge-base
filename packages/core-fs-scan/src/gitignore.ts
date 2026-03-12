import { type Ignore } from 'ignore';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Use createRequire to load the CJS ignore package safely under NodeNext module resolution
const _require = createRequire(import.meta.url);
const createIgnore = _require('ignore') as () => Ignore;

export class GitignoreManager {
  private readonly cache = new Map<string, Ignore>();

  /** Load (and cache) the .gitignore for the given directory */
  async load(dir: string): Promise<void> {
    if (this.cache.has(dir)) {
      return;
    }
    const gitignorePath = join(dir, '.gitignore');
    try {
      const content = await readFile(gitignorePath, 'utf8');
      const ig = createIgnore();
      ig.add(content);
      this.cache.set(dir, ig);
    } catch {
      // No .gitignore or unreadable — that's fine
    }
  }

  /** Returns true if the path should be ignored by any cached .gitignore rule */
  isIgnored(absolutePath: string, relativePath: string): boolean {
    // Walk up the directory tree checking each cached gitignore
    let dir = dirname(absolutePath);
    while (dir !== dirname(dir)) {
      const ig = this.cache.get(dir);
      if (ig !== undefined) {
        // Use forward-slash paths for ignore package compatibility
        const rel = relativePath.replace(/\\/g, '/');
        if (ig.ignores(rel)) {
          return true;
        }
      }
      dir = dirname(dir);
    }
    return false;
  }
}
