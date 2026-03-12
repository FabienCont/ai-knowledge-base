import type { FileEntry } from '@aikb/core-types';
import { extname, relative } from 'node:path';
import { stat } from 'node:fs/promises';

export async function toFileEntry(
  absolutePath: string,
  root: string,
): Promise<FileEntry> {
  const stats = await stat(absolutePath);
  const rel = relative(root, absolutePath).replace(/\\/g, '/');
  return {
    path: absolutePath,
    relative_path: rel,
    size_bytes: stats.size,
    modified_at: stats.mtime.toISOString(),
    extension: extname(absolutePath),
  };
}
