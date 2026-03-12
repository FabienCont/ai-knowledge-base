import { z } from 'zod';

export const SessionEntrySchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});
export type SessionEntry = z.infer<typeof SessionEntrySchema>;

export const SessionMetaSchema = z.object({
  id: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;
