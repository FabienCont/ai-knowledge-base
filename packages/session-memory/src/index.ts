import { getConfig } from '@aikb/core-config';
import { FileSessionStore } from './store.js';
import type { SessionStore } from './types.js';

export async function createSessionStore(): Promise<SessionStore> {
  const config = await getConfig();
  return new FileSessionStore(config.session.data_dir);
}

export { FileSessionStore } from './store.js';
export type {
  SessionStore,
  CreateSessionOptions,
  SearchOptions,
  SearchResult,
} from './types.js';
