import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { lock, unlock } from 'proper-lockfile';
import type { SessionEntry, SessionMeta } from '@aikb/core-types';
import { SessionEntrySchema, SessionMetaSchema } from '@aikb/core-types';
import type {
  CreateSessionOptions,
  SearchOptions,
  SearchResult,
  SessionStore,
} from './types.js';
import { formatEntryBlock, formatMemoryHeader } from './format.js';

function generateSessionId(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex');
  return `session-${dateStr}-${rand}`;
}

export class FileSessionStore implements SessionStore {
  constructor(private readonly dataDir: string) {}

  private sessionDir(sessionId: string): string {
    return path.join(this.dataDir, 'sessions', sessionId);
  }

  private metaPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'meta.json');
  }

  private eventsPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'events.jsonl');
  }

  private memoryPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'memory.md');
  }

  private async readMeta(sessionId: string): Promise<SessionMeta> {
    const raw = await fs.readFile(this.metaPath(sessionId), 'utf-8');
    return SessionMetaSchema.parse(JSON.parse(raw));
  }

  private async writeMeta(
    sessionId: string,
    meta: SessionMeta,
  ): Promise<void> {
    await fs.writeFile(
      this.metaPath(sessionId),
      JSON.stringify(meta, null, 2),
      'utf-8',
    );
  }

  async create(options?: CreateSessionOptions): Promise<SessionMeta> {
    const id = options?.id ?? generateSessionId();
    const dir = this.sessionDir(id);
    await fs.mkdir(dir, { recursive: true });

    const now = new Date().toISOString();
    const meta: SessionMeta = SessionMetaSchema.parse({
      id,
      created_at: now,
      updated_at: now,
      ...(options?.title !== undefined ? { title: options.title } : {}),
      ...(options?.tags !== undefined ? { tags: options.tags } : {}),
    });

    await this.writeMeta(id, meta);
    await fs.writeFile(this.memoryPath(id), formatMemoryHeader(meta), 'utf-8');
    await fs.writeFile(this.eventsPath(id), '', 'utf-8');

    return meta;
  }

  async add(
    sessionId: string,
    entry: Omit<SessionEntry, 'id' | 'session_id'>,
  ): Promise<SessionEntry> {
    const eventsFile = this.eventsPath(sessionId);

    await lock(eventsFile, { retries: { retries: 5, minTimeout: 50 } });
    try {
      const full: SessionEntry = SessionEntrySchema.parse({
        ...entry,
        id: crypto.randomUUID(),
        session_id: sessionId,
      });

      await fs.appendFile(eventsFile, JSON.stringify(full) + '\n', 'utf-8');
      await fs.appendFile(
        this.memoryPath(sessionId),
        formatEntryBlock(full),
        'utf-8',
      );

      const meta = await this.readMeta(sessionId);
      await this.writeMeta(sessionId, {
        ...meta,
        updated_at: new Date().toISOString(),
      });

      return full;
    } finally {
      await unlock(eventsFile);
    }
  }

  async get(
    sessionId: string,
  ): Promise<{ meta: SessionMeta; entries: SessionEntry[] }> {
    const meta = await this.readMeta(sessionId);
    const raw = await fs.readFile(this.eventsPath(sessionId), 'utf-8');
    const entries: SessionEntry[] = raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => SessionEntrySchema.parse(JSON.parse(line)));
    return { meta, entries };
  }

  async list(): Promise<SessionMeta[]> {
    const sessionsDir = path.join(this.dataDir, 'sessions');
    let entries: string[];
    try {
      entries = await fs.readdir(sessionsDir);
    } catch {
      return [];
    }

    const metas: SessionMeta[] = [];
    for (const entry of entries) {
      try {
        const meta = await this.readMeta(entry);
        metas.push(meta);
      } catch {
        // skip sessions with unreadable metadata
      }
    }

    return metas.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const limit = options.limit ?? 20;
    const sessions = await this.list();
    const results: SearchResult[] = [];
    const regex = new RegExp(options.pattern, 'i');

    for (const session of sessions) {
      if (results.length >= limit) break;

      const memoryContent = await fs.readFile(
        this.memoryPath(session.id),
        'utf-8',
      );
      const lines = memoryContent.split('\n');
      const eventsRaw = await fs.readFile(
        this.eventsPath(session.id),
        'utf-8',
      );
      const entries: SessionEntry[] = eventsRaw
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => SessionEntrySchema.parse(JSON.parse(l)));

      // Pre-build a map from each non-empty trimmed content line → entry
      const lineToEntry = new Map<string, SessionEntry>();
      for (const entry of entries) {
        for (const cl of entry.content.split('\n')) {
          const trimmed = cl.trim();
          if (trimmed.length > 0) {
            lineToEntry.set(trimmed, entry);
          }
        }
      }

      for (let i = 0; i < lines.length; i++) {
        if (results.length >= limit) break;
        const line = lines[i];
        if (line === undefined) continue;
        if (!regex.test(line)) continue;

        // Find an entry whose content line appears in the matching memory.md line
        let matchedEntry: SessionEntry | undefined;
        for (const [contentLine, entry] of lineToEntry) {
          if (line.includes(contentLine)) {
            matchedEntry = entry;
            break;
          }
        }
        if (!matchedEntry) continue;

        const result: SearchResult = { entry: matchedEntry };
        const before = lines[i - 1];
        const after = lines[i + 1];
        if (i > 0 && before !== undefined) {
          result.context_before = before;
        }
        if (i < lines.length - 1 && after !== undefined) {
          result.context_after = after;
        }
        results.push(result);
      }
    }

    return results;
  }

  async update(
    sessionId: string,
    patch: Partial<Pick<SessionMeta, 'title' | 'tags'>>,
  ): Promise<SessionMeta> {
    const meta = await this.readMeta(sessionId);
    const updated: SessionMeta = SessionMetaSchema.parse({
      ...meta,
      ...patch,
      updated_at: new Date().toISOString(),
    });
    await this.writeMeta(sessionId, updated);
    return updated;
  }

  async delete(sessionId: string): Promise<void> {
    await fs.rm(this.sessionDir(sessionId), { recursive: true, force: true });
  }
}
