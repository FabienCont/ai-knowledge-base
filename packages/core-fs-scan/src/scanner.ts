import type { FileEntry } from '@aikb/core-types';
import { opendir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import micromatch from 'micromatch';
import { GitignoreManager } from './gitignore.js';
import { toFileEntry } from './metadata.js';
import { DEFAULT_IGNORE, type ScanOptions } from './types.js';

/**
 * Recursively scan a directory and yield FileEntry objects.
 * Output is sorted deterministically by relative_path.
 */
export async function* scanFolder(
  options: ScanOptions,
): AsyncGenerator<FileEntry> {
  const root = resolve(options.root);
  const useGitignore = options.useGitignore ?? true;
  const followSymlinks = options.followSymlinks ?? false;
  const maxDepth = options.maxDepth ?? 20;
  const maxFileSize = options.maxFileSize ?? 5 * 1024 * 1024;
  const include = options.include ?? ['**/*'];
  const exclude = options.exclude ?? [];
  const defaultIgnore = options.defaultIgnore ?? DEFAULT_IGNORE;

  const gitignoreManager = useGitignore ? new GitignoreManager() : null;

  // Collect all entries, sort globally, then yield
  const allEntries: FileEntry[] = [];
  await collectDir(root, root, 0, allEntries);

  allEntries.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  for (const entry of allEntries) {
    yield entry;
  }

  async function collectDir(
    dir: string,
    rootPath: string,
    depth: number,
    results: FileEntry[],
  ): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    if (gitignoreManager !== null) {
      await gitignoreManager.load(dir);
    }

    let dirHandle;
    try {
      dirHandle = await opendir(dir);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT' || nodeErr.code === 'EACCES') {
        console.warn(`[core-fs-scan] Skipping ${dir}: ${nodeErr.message}`);
        return;
      }
      throw err;
    }

    try {
      for await (const entry of dirHandle) {
        const absolutePath = join(dir, entry.name);
        const relativePath = relative(rootPath, absolutePath).replace(
          /\\/g,
          '/',
        );

        // Check defaultIgnore patterns against the entry name and relative path
        if (
          micromatch.isMatch(entry.name, defaultIgnore) ||
          micromatch.isMatch(relativePath, defaultIgnore)
        ) {
          continue;
        }

        // Check gitignore
        if (
          gitignoreManager !== null &&
          gitignoreManager.isIgnored(absolutePath, relativePath)
        ) {
          continue;
        }

        if (entry.isSymbolicLink()) {
          if (!followSymlinks) {
            continue;
          }
          // Resolve symlink and handle as file or directory
          let targetStat;
          try {
            targetStat = await stat(absolutePath);
          } catch {
            // Broken symlink — skip silently
            continue;
          }
          if (targetStat.isDirectory()) {
            if (depth < maxDepth) {
              await collectDir(absolutePath, rootPath, depth + 1, results);
            }
          } else if (targetStat.isFile()) {
            await processFile(absolutePath, relativePath, rootPath, results);
          }
        } else if (entry.isDirectory()) {
          if (depth < maxDepth) {
            await collectDir(absolutePath, rootPath, depth + 1, results);
          }
        } else if (entry.isFile()) {
          await processFile(absolutePath, relativePath, rootPath, results);
        }
      }
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT' || nodeErr.code === 'EACCES') {
        console.warn(
          `[core-fs-scan] Error reading ${dir}: ${nodeErr.message}`,
        );
        return;
      }
      throw err;
    }
  }

  async function processFile(
    absolutePath: string,
    relativePath: string,
    rootPath: string,
    results: FileEntry[],
  ): Promise<void> {
    // Check include/exclude globs
    if (!micromatch.isMatch(relativePath, include)) {
      return;
    }
    if (exclude.length > 0 && micromatch.isMatch(relativePath, exclude)) {
      return;
    }

    let fileEntry: FileEntry;
    try {
      fileEntry = await toFileEntry(absolutePath, rootPath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT' || nodeErr.code === 'EACCES') {
        console.warn(
          `[core-fs-scan] Skipping ${absolutePath}: ${nodeErr.message}`,
        );
        return;
      }
      throw err;
    }

    if (fileEntry.size_bytes > maxFileSize) {
      return;
    }

    results.push(fileEntry);
  }
}
