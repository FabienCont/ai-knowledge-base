import type { SessionEntry, SessionMeta } from '@aikb/core-types';

/**
 * Format the initial memory.md header for a new session.
 */
export function formatMemoryHeader(meta: SessionMeta): string {
  return `# Session: ${meta.id}\nCreated: ${meta.created_at}\n\n---\n`;
}

/**
 * Format a single SessionEntry as a memory.md block.
 */
export function formatEntryBlock(entry: SessionEntry): string {
  return `\n**[${entry.role}]** ${entry.timestamp}\n\n${entry.content}\n\n---\n`;
}
