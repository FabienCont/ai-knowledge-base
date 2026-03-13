import type { SessionEntry, SessionMeta } from '@aikb/core-types';

export interface CreateSessionOptions {
  /** Auto-generated if omitted: 'session-{yyyymmdd}-{random6}' */
  id?: string;
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
  context_before?: string;
  context_after?: string;
}

export interface SessionStore {
  /** Create a new session, return its metadata */
  create(options?: CreateSessionOptions): Promise<SessionMeta>;

  /** Append a new entry to an existing session */
  add(
    sessionId: string,
    entry: Omit<SessionEntry, 'id' | 'session_id'>,
  ): Promise<SessionEntry>;

  /** Get all entries for a session, in order */
  get(
    sessionId: string,
  ): Promise<{ meta: SessionMeta; entries: SessionEntry[] }>;

  /** List all sessions (meta only), sorted by updated_at desc */
  list(): Promise<SessionMeta[]>;

  /** Search across all sessions' memory.md content */
  search(options: SearchOptions): Promise<SearchResult[]>;

  /** Update session metadata (title, tags) */
  update(
    sessionId: string,
    patch: Partial<Pick<SessionMeta, 'title' | 'tags'>>,
  ): Promise<SessionMeta>;

  /** Delete a session and all its files */
  delete(sessionId: string): Promise<void>;
}
