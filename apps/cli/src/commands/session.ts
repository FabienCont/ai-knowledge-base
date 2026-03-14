import type { Command } from 'commander';
import { createSessionStore } from '@aikb/session-memory';
import { output, exitError } from '../output.js';

export function registerSessionCommands(program: Command): void {
  const session = program
    .command('session')
    .description('Session memory operations');

  // ---------------------------------------------------------------------------
  // session start
  // ---------------------------------------------------------------------------
  session
    .command('start')
    .description('Create a new session')
    .option('--title <title>', 'Session title')
    .option('--tag <tag...>', 'Session tags (repeatable)')
    .action(async (opts: { title?: string; tag?: string[] }) => {
      try {
        const store = await createSessionStore();
        const meta = await store.create({
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.tag !== undefined ? { tags: opts.tag } : {}),
        });
        output(program, meta, `Created session: ${meta.id}`);
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });

  // ---------------------------------------------------------------------------
  // session add
  // ---------------------------------------------------------------------------
  session
    .command('add <session-id> <message>')
    .description('Append a message to a session')
    .requiredOption('--role <role>', 'Message role: user, assistant, system, tool')
    .action(async (sessionId: string, message: string, opts: { role: string }) => {
      try {
        const store = await createSessionStore();
        const entry = await store.add(sessionId, {
          role: opts.role as 'user' | 'assistant' | 'system' | 'tool',
          content: message,
          timestamp: new Date().toISOString(),
        });
        output(program, entry, `Added entry ${entry.id}`);
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });

  // ---------------------------------------------------------------------------
  // session show
  // ---------------------------------------------------------------------------
  session
    .command('show <session-id>')
    .description('Display a session\'s content')
    .option('--format <format>', 'Output format: md or json', 'md')
    .action(async (sessionId: string, opts: { format: string }) => {
      try {
        const store = await createSessionStore();
        const { meta, entries } = await store.get(sessionId);
        if (opts.format === 'json' || program.opts<{ json?: boolean }>().json) {
          console.log(JSON.stringify({ meta, entries }, null, 2));
        } else {
          console.log(`# Session: ${meta.id}`);
          if (meta.title) console.log(`Title: ${meta.title}`);
          if (meta.tags && meta.tags.length > 0) {
            console.log(`Tags: ${meta.tags.join(', ')}`);
          }
          console.log(`Created: ${meta.created_at}`);
          console.log(`Updated: ${meta.updated_at}`);
          console.log('---');
          for (const entry of entries) {
            console.log(`[${entry.role}] ${entry.timestamp}`);
            console.log(entry.content);
            console.log('');
          }
        }
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });

  // ---------------------------------------------------------------------------
  // session list
  // ---------------------------------------------------------------------------
  session
    .command('list')
    .description('List all sessions')
    .option('--limit <n>', 'Maximum number of sessions to show', '20')
    .action(async (opts: { limit: string }) => {
      try {
        const store = await createSessionStore();
        const all = await store.list();
        const limit = parseInt(opts.limit, 10);
        const sessions = all.slice(0, limit);
        output(
          program,
          sessions,
          sessions.length === 0
            ? 'No sessions found.'
            : sessions
                .map(
                  (s) =>
                    `${s.id}${s.title ? ` — ${s.title}` : ''}  (${s.updated_at.slice(0, 10)})`,
                )
                .join('\n'),
        );
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });

  // ---------------------------------------------------------------------------
  // session search
  // ---------------------------------------------------------------------------
  session
    .command('search <pattern>')
    .description('Full-text search across all sessions')
    .option('--limit <n>', 'Maximum number of results', '20')
    .action(async (pattern: string, opts: { limit: string }) => {
      try {
        const store = await createSessionStore();
        const limit = parseInt(opts.limit, 10);
        const results = await store.search({ pattern, limit });
        output(
          program,
          results,
          results.length === 0
            ? 'No results found.'
            : results
                .map(
                  (r) =>
                    `[${r.entry.session_id}] [${r.entry.role}] ${r.entry.content}`,
                )
                .join('\n'),
        );
      } catch (err) {
        exitError(err instanceof Error ? err.message : String(err));
      }
    });
}
