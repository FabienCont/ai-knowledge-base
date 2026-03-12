import { z } from 'zod';

export const EntitySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
  source_chunk_ids: z.array(z.string().uuid()),
  metadata: z.record(z.unknown()).optional(),
});
export type Entity = z.infer<typeof EntitySchema>;

export const RelationSchema = z.object({
  id: z.string().uuid(),
  subject_id: z.string().uuid(),
  predicate: z.string().min(1),
  object_id: z.string().uuid(),
  source_chunk_ids: z.array(z.string().uuid()),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type Relation = z.infer<typeof RelationSchema>;
