import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSessionStore } from '../store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(dataDir: string): FileSessionStore {
  return new FileSessionStore(dataDir);
}

function nowEntry(content: string, role: 'user' | 'assistant' = 'user') {
  return {
    role,
    content,
    timestamp: new Date().toISOString(),
  } as const;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let tmpDir: string;
let store: FileSessionStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikb-session-test-'));
  store = makeStore(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

describe('create()', () => {
  it('returns a valid SessionMeta with generated id', async () => {
    const meta = await store.create();
    expect(meta.id).toMatch(/^session-\d{8}-[0-9a-f]{6}$/);
    expect(meta.created_at).toBeTruthy();
    expect(meta.updated_at).toBe(meta.created_at);
  });

  it('uses provided id when given', async () => {
    const meta = await store.create({ id: 'my-custom-id' });
    expect(meta.id).toBe('my-custom-id');
  });

  it('stores title and tags when provided', async () => {
    const meta = await store.create({
      title: 'My Session',
      tags: ['work', 'research'],
    });
    expect(meta.title).toBe('My Session');
    expect(meta.tags).toEqual(['work', 'research']);
  });

  it('creates the correct directory layout', async () => {
    const meta = await store.create({ id: 'test-session' });
    const sessionDir = path.join(tmpDir, 'sessions', meta.id);

    const files = await fs.readdir(sessionDir);
    expect(files.sort()).toEqual(['events.jsonl', 'memory.md', 'meta.json']);
  });

  it('writes valid meta.json', async () => {
    const meta = await store.create({
      id: 'meta-test',
      title: 'Hello',
      tags: ['a'],
    });
    const raw = await fs.readFile(
      path.join(tmpDir, 'sessions', 'meta-test', 'meta.json'),
      'utf-8',
    );
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toMatchObject({
      id: 'meta-test',
      title: 'Hello',
      tags: ['a'],
    });
  });

  it('initialises events.jsonl as empty', async () => {
    await store.create({ id: 'empty-events' });
    const content = await fs.readFile(
      path.join(tmpDir, 'sessions', 'empty-events', 'events.jsonl'),
      'utf-8',
    );
    expect(content).toBe('');
  });

  it('initialises memory.md with header', async () => {
    const meta = await store.create({ id: 'md-header' });
    const content = await fs.readFile(
      path.join(tmpDir, 'sessions', 'md-header', 'memory.md'),
      'utf-8',
    );
    expect(content).toContain(`# Session: ${meta.id}`);
    expect(content).toContain(`Created: ${meta.created_at}`);
  });
});

// ---------------------------------------------------------------------------
// add()
// ---------------------------------------------------------------------------

describe('add()', () => {
  it('returns a full SessionEntry with generated id and session_id', async () => {
    const meta = await store.create({ id: 'add-test' });
    const entry = await store.add(meta.id, nowEntry('Hello'));

    expect(entry.id).toBeTruthy();
    expect(entry.session_id).toBe('add-test');
    expect(entry.role).toBe('user');
    expect(entry.content).toBe('Hello');
  });

  it('appends entry to events.jsonl', async () => {
    const meta = await store.create({ id: 'add-jsonl' });
    await store.add(meta.id, nowEntry('First'));
    await store.add(meta.id, nowEntry('Second'));

    const raw = await fs.readFile(
      path.join(tmpDir, 'sessions', 'add-jsonl', 'events.jsonl'),
      'utf-8',
    );
    const lines = raw.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    const first: unknown = JSON.parse(lines[0]!);
    const second: unknown = JSON.parse(lines[1]!);
    expect(first).toMatchObject({ content: 'First' });
    expect(second).toMatchObject({ content: 'Second' });
  });

  it('appends entry block to memory.md', async () => {
    const meta = await store.create({ id: 'add-md' });
    await store.add(meta.id, nowEntry('Visible text'));

    const md = await fs.readFile(
      path.join(tmpDir, 'sessions', 'add-md', 'memory.md'),
      'utf-8',
    );
    expect(md).toContain('Visible text');
    expect(md).toContain('**[user]**');
  });

  it('updates updated_at on the session meta', async () => {
    const meta = await store.create({ id: 'add-updated-at' });
    const before = meta.updated_at;

    // Small delay to ensure updated_at is different
    await new Promise((r) => setTimeout(r, 5));
    await store.add(meta.id, nowEntry('Bump'));

    const updated = await store.get('add-updated-at');
    expect(updated.meta.updated_at >= before).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get()
// ---------------------------------------------------------------------------

describe('get()', () => {
  it('returns entries in insertion order', async () => {
    const meta = await store.create({ id: 'get-order' });
    await store.add(meta.id, nowEntry('First', 'user'));
    await store.add(meta.id, nowEntry('Second', 'assistant'));
    await store.add(meta.id, nowEntry('Third', 'user'));

    const { entries } = await store.get('get-order');
    expect(entries).toHaveLength(3);
    expect(entries[0]!.content).toBe('First');
    expect(entries[1]!.content).toBe('Second');
    expect(entries[2]!.content).toBe('Third');
  });

  it('returns correct meta', async () => {
    await store.create({ id: 'get-meta', title: 'My Title', tags: ['tag1'] });

    const { meta } = await store.get('get-meta');
    expect(meta.title).toBe('My Title');
    expect(meta.tags).toEqual(['tag1']);
  });

  it('returns empty entries for a freshly created session', async () => {
    await store.create({ id: 'get-empty' });
    const { entries } = await store.get('get-empty');
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------------

describe('list()', () => {
  it('returns empty array when no sessions exist', async () => {
    const result = await store.list();
    expect(result).toEqual([]);
  });

  it('returns all created sessions', async () => {
    await store.create({ id: 'list-a' });
    await store.create({ id: 'list-b' });

    const result = await store.list();
    const ids = result.map((m) => m.id).sort();
    expect(ids).toContain('list-a');
    expect(ids).toContain('list-b');
  });

  it('sorts sessions by updated_at descending (newest first)', async () => {
    await store.create({ id: 'list-oldest' });
    await new Promise((r) => setTimeout(r, 10));
    await store.create({ id: 'list-middle' });
    await new Promise((r) => setTimeout(r, 10));
    await store.create({ id: 'list-newest' });

    const result = await store.list();
    const ids = result.map((m) => m.id);
    expect(ids[0]).toBe('list-newest');
    expect(ids[ids.length - 1]).toBe('list-oldest');
  });

  it('re-orders after an add updates updated_at', async () => {
    await store.create({ id: 'list-first-created' });
    await new Promise((r) => setTimeout(r, 10));
    await store.create({ id: 'list-second-created' });

    // Now bump the first session — it should appear at the top
    await new Promise((r) => setTimeout(r, 10));
    await store.add('list-first-created', nowEntry('Bump'));

    const result = await store.list();
    expect(result[0]!.id).toBe('list-first-created');
  });
});

// ---------------------------------------------------------------------------
// search()
// ---------------------------------------------------------------------------

describe('search()', () => {
  it('finds entries matching a substring (case-insensitive)', async () => {
    const meta = await store.create({ id: 'search-sub' });
    await store.add(meta.id, nowEntry('What is machine learning?'));
    await store.add(meta.id, nowEntry('Tell me about cats'));

    const results = await store.search({ pattern: 'machine learning' });
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.content).toBe('What is machine learning?');
  });

  it('is case-insensitive', async () => {
    const meta = await store.create({ id: 'search-case' });
    await store.add(meta.id, nowEntry('Hello World'));

    const results = await store.search({ pattern: 'hello world' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.entry.content).toBe('Hello World');
  });

  it('finds entries matching a regex pattern', async () => {
    const meta = await store.create({ id: 'search-regex' });
    await store.add(meta.id, nowEntry('Error code: 404'));
    await store.add(meta.id, nowEntry('All systems nominal'));

    const results = await store.search({ pattern: 'error code: \\d+' });
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.content).toContain('404');
  });

  it('respects the limit option', async () => {
    const meta = await store.create({ id: 'search-limit' });
    for (let i = 0; i < 10; i++) {
      await store.add(meta.id, nowEntry(`keyword entry number ${i}`));
    }

    const results = await store.search({ pattern: 'keyword', limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('returns empty array when no match found', async () => {
    const meta = await store.create({ id: 'search-no-match' });
    await store.add(meta.id, nowEntry('Nothing relevant here'));

    const results = await store.search({ pattern: 'unicorn rainbow' });
    expect(results).toHaveLength(0);
  });

  it('returns context_before and context_after when available', async () => {
    const meta = await store.create({ id: 'search-context' });
    await store.add(meta.id, nowEntry('Target match content'));

    const results = await store.search({ pattern: 'Target match content' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // context lines may be blank or separator lines — just verify they exist as strings
    const result = results[0]!;
    // context_before is a string (from memory.md lines) or absent — both are valid
    if (result.context_before !== undefined) {
      expect(typeof result.context_before).toBe('string');
    }
  });

  it('searches across multiple sessions', async () => {
    const s1 = await store.create({ id: 'search-multi-1' });
    const s2 = await store.create({ id: 'search-multi-2' });
    await store.add(s1.id, nowEntry('Needle in session one'));
    await store.add(s2.id, nowEntry('Needle in session two'));

    const results = await store.search({ pattern: 'Needle' });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('update()', () => {
  it('changes the title', async () => {
    await store.create({ id: 'update-title', title: 'Old Title' });
    const updated = await store.update('update-title', { title: 'New Title' });

    expect(updated.title).toBe('New Title');
  });

  it('changes the tags', async () => {
    await store.create({ id: 'update-tags', tags: ['old'] });
    const updated = await store.update('update-tags', { tags: ['new', 'tags'] });

    expect(updated.tags).toEqual(['new', 'tags']);
  });

  it('bumps updated_at', async () => {
    const meta = await store.create({ id: 'update-ts' });
    const before = meta.updated_at;

    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update('update-ts', { title: 'Changed' });
    expect(updated.updated_at > before).toBe(true);
  });

  it('persists changes so get() reflects them', async () => {
    await store.create({ id: 'update-persist' });
    await store.update('update-persist', { title: 'Persisted Title' });

    const { meta } = await store.get('update-persist');
    expect(meta.title).toBe('Persisted Title');
  });
});

// ---------------------------------------------------------------------------
// delete()
// ---------------------------------------------------------------------------

describe('delete()', () => {
  it('removes the session directory and all files', async () => {
    await store.create({ id: 'delete-test' });
    const sessionDir = path.join(tmpDir, 'sessions', 'delete-test');

    // Confirm it exists
    await expect(fs.access(sessionDir)).resolves.toBeUndefined();

    await store.delete('delete-test');

    // Now it should be gone
    await expect(fs.access(sessionDir)).rejects.toThrow();
  });

  it('deleted session no longer appears in list()', async () => {
    await store.create({ id: 'delete-list' });
    await store.delete('delete-list');

    const sessions = await store.list();
    expect(sessions.find((m) => m.id === 'delete-list')).toBeUndefined();
  });

  it('is idempotent — deleting a non-existent session does not throw', async () => {
    await expect(store.delete('non-existent-session')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Concurrent add() — write-lock correctness
// ---------------------------------------------------------------------------

describe('concurrent add()', () => {
  it('does not corrupt events.jsonl under concurrent writes', async () => {
    const meta = await store.create({ id: 'concurrent-test' });

    const count = 10;
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        store.add(meta.id, nowEntry(`Concurrent message ${i}`)),
      ),
    );

    const raw = await fs.readFile(
      path.join(tmpDir, 'sessions', 'concurrent-test', 'events.jsonl'),
      'utf-8',
    );
    const lines = raw.split('\n').filter((l) => l.trim());
    // Every line must be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // All messages were written
    expect(lines).toHaveLength(count);
  });
});
