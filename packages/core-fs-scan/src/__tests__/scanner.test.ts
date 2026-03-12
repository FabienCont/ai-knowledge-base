import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanFolder } from '../scanner.js';
import type { FileEntry } from '@aikb/core-types';

async function collectScan(
  options: Parameters<typeof scanFolder>[0],
): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  for await (const entry of scanFolder(options)) {
    results.push(entry);
  }
  return results;
}

describe('scanFolder', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'aikb-scan-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('yields all files in a flat directory', async () => {
    await writeFile(join(tmpDir, 'a.ts'), 'hello');
    await writeFile(join(tmpDir, 'b.ts'), 'world');
    await writeFile(join(tmpDir, 'c.json'), '{}');

    const entries = await collectScan({ root: tmpDir });

    expect(entries).toHaveLength(3);
    const names = entries.map((e) => e.relative_path);
    expect(names).toContain('a.ts');
    expect(names).toContain('b.ts');
    expect(names).toContain('c.json');
  });

  it('exclude glob filters out matching files', async () => {
    await writeFile(join(tmpDir, 'keep.ts'), 'keep');
    await writeFile(join(tmpDir, 'skip.log'), 'skip');
    await writeFile(join(tmpDir, 'also.log'), 'skip');

    const entries = await collectScan({ root: tmpDir, exclude: ['**/*.log'] });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.relative_path).toBe('keep.ts');
  });

  it('include glob filters to only matching files', async () => {
    await writeFile(join(tmpDir, 'main.ts'), 'ts');
    await writeFile(join(tmpDir, 'README.md'), 'md');
    await writeFile(join(tmpDir, 'config.json'), 'json');

    const entries = await collectScan({
      root: tmpDir,
      include: ['**/*.ts'],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.relative_path).toBe('main.ts');
  });

  it('respects .gitignore file in scanned directory', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(tmpDir, 'ignored.txt'), 'ignored');
    await writeFile(join(tmpDir, 'kept.ts'), 'kept');

    const entries = await collectScan({ root: tmpDir });

    const paths = entries.map((e) => e.relative_path);
    expect(paths).not.toContain('ignored.txt');
    expect(paths).toContain('kept.ts');
  });

  it('maxDepth limits recursion depth', async () => {
    // depth 0: root
    // depth 1: subdir/
    // depth 2: subdir/nested/
    await mkdir(join(tmpDir, 'subdir', 'nested'), { recursive: true });
    await writeFile(join(tmpDir, 'root.ts'), 'root');
    await writeFile(join(tmpDir, 'subdir', 'sub.ts'), 'sub');
    await writeFile(join(tmpDir, 'subdir', 'nested', 'deep.ts'), 'deep');

    const entries = await collectScan({ root: tmpDir, maxDepth: 1 });
    const paths = entries.map((e) => e.relative_path);

    expect(paths).toContain('root.ts');
    expect(paths).toContain('subdir/sub.ts');
    expect(paths).not.toContain('subdir/nested/deep.ts');
  });

  it('maxFileSize skips files larger than the limit', async () => {
    await writeFile(join(tmpDir, 'small.txt'), 'hi');
    await writeFile(join(tmpDir, 'big.txt'), 'x'.repeat(1000));

    const entries = await collectScan({ root: tmpDir, maxFileSize: 100 });
    const paths = entries.map((e) => e.relative_path);

    expect(paths).toContain('small.txt');
    expect(paths).not.toContain('big.txt');
  });

  it('skips symlinks when followSymlinks is false (default)', async () => {
    await writeFile(join(tmpDir, 'real.ts'), 'real');
    await symlink(
      join(tmpDir, 'real.ts'),
      join(tmpDir, 'link.ts'),
    );

    const entries = await collectScan({ root: tmpDir, followSymlinks: false });
    const paths = entries.map((e) => e.relative_path);

    expect(paths).toContain('real.ts');
    expect(paths).not.toContain('link.ts');
  });

  it('follows symlinks when followSymlinks is true', async () => {
    await writeFile(join(tmpDir, 'real.ts'), 'real');
    await symlink(
      join(tmpDir, 'real.ts'),
      join(tmpDir, 'link.ts'),
    );

    const entries = await collectScan({ root: tmpDir, followSymlinks: true });
    const paths = entries.map((e) => e.relative_path);

    expect(paths).toContain('real.ts');
    expect(paths).toContain('link.ts');
  });

  it('output is sorted by relative_path', async () => {
    await writeFile(join(tmpDir, 'z.ts'), 'z');
    await writeFile(join(tmpDir, 'a.ts'), 'a');
    await writeFile(join(tmpDir, 'm.ts'), 'm');
    await mkdir(join(tmpDir, 'dir'));
    await writeFile(join(tmpDir, 'dir', 'b.ts'), 'b');

    const entries = await collectScan({ root: tmpDir });
    const paths = entries.map((e) => e.relative_path);

    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    expect(paths).toEqual(sorted);
  });

  it("EACCES on a directory doesn't crash the scan", async () => {
    // Skip if running as root (root bypasses permissions)
    if (process.getuid !== undefined && process.getuid() === 0) {
      return;
    }

    await mkdir(join(tmpDir, 'restricted'));
    await writeFile(join(tmpDir, 'restricted', 'secret.ts'), 'secret');
    await writeFile(join(tmpDir, 'normal.ts'), 'normal');
    await chmod(join(tmpDir, 'restricted'), 0o000);

    let entries: FileEntry[] = [];
    try {
      entries = await collectScan({ root: tmpDir });
    } finally {
      // Restore permissions so cleanup can remove it
      await chmod(join(tmpDir, 'restricted'), 0o755);
    }

    const paths = entries.map((e) => e.relative_path);
    expect(paths).toContain('normal.ts');
    expect(paths).not.toContain('restricted/secret.ts');
  });

  it('performance smoke test: scan directory with 100+ files completes', async () => {
    // Create 110 files across a few subdirectories
    await mkdir(join(tmpDir, 'batch1'));
    await mkdir(join(tmpDir, 'batch2'));
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 50; i++) {
      writes.push(writeFile(join(tmpDir, `file-${i}.ts`), `content-${i}`));
    }
    for (let i = 0; i < 30; i++) {
      writes.push(
        writeFile(join(tmpDir, 'batch1', `b1-${i}.ts`), `content-${i}`),
      );
    }
    for (let i = 0; i < 30; i++) {
      writes.push(
        writeFile(join(tmpDir, 'batch2', `b2-${i}.ts`), `content-${i}`),
      );
    }
    await Promise.all(writes);

    const entries = await collectScan({ root: tmpDir });
    expect(entries.length).toBeGreaterThanOrEqual(110);
  });

  it('file entries have correct metadata fields', async () => {
    await writeFile(join(tmpDir, 'sample.ts'), 'hello world');

    const entries = await collectScan({ root: tmpDir });

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.path).toContain('sample.ts');
    expect(entry.relative_path).toBe('sample.ts');
    expect(entry.extension).toBe('.ts');
    expect(entry.size_bytes).toBeGreaterThan(0);
    expect(entry.modified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('uses forward slashes in relative_path for nested files', async () => {
    await mkdir(join(tmpDir, 'a', 'b'), { recursive: true });
    await writeFile(join(tmpDir, 'a', 'b', 'file.ts'), 'content');

    const entries = await collectScan({ root: tmpDir });
    const entry = entries.find((e) => e.relative_path.endsWith('file.ts'));

    expect(entry).toBeDefined();
    expect(entry?.relative_path).toBe('a/b/file.ts');
    expect(entry?.relative_path).not.toContain('\\');
  });

  it('default ignore excludes node_modules and .git directories', async () => {
    await mkdir(join(tmpDir, 'node_modules', 'some-pkg'), { recursive: true });
    await writeFile(
      join(tmpDir, 'node_modules', 'some-pkg', 'index.js'),
      'pkg',
    );
    await mkdir(join(tmpDir, '.git'));
    await writeFile(join(tmpDir, '.git', 'config'), 'git config');
    await writeFile(join(tmpDir, 'src.ts'), 'source');

    const entries = await collectScan({ root: tmpDir });
    const paths = entries.map((e) => e.relative_path);

    expect(paths).toContain('src.ts');
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.git/'))).toBe(false);
  });
});
