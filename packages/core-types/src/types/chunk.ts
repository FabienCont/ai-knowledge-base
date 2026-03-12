import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const ChunkSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  source_path: z.string().min(1),
  content: z.string().min(1),
  hash: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/),
  index: z.number().int().nonnegative(),
  line_start: z.number().int().nonnegative().optional(),
  line_end: z.number().int().nonnegative().optional(),
  language: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Chunk = z.infer<typeof ChunkSchema>;

export function createChunk(fields: Omit<Chunk, 'id'>): Chunk {
  return ChunkSchema.parse({
    ...fields,
    id: randomUUID(),
  });
}
