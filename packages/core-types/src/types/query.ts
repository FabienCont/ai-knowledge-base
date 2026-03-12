import { z } from 'zod';
import { ChunkSchema } from './chunk.js';

export const QuerySchema = z.object({
  text: z.string().min(1),
  top_k: z.number().int().positive().default(10),
  filter: z.record(z.unknown()).optional(),
  min_score: z.number().min(0).max(1).optional(),
});
export type Query = z.infer<typeof QuerySchema>;

export const ResultItemSchema = z.object({
  chunk: ChunkSchema,
  score: z.number().min(0).max(1),
});
export type ResultItem = z.infer<typeof ResultItemSchema>;

export const QueryResultSchema = z.object({
  query: QuerySchema,
  items: z.array(ResultItemSchema),
  duration_ms: z.number().nonnegative(),
});
export type QueryResult = z.infer<typeof QueryResultSchema>;
