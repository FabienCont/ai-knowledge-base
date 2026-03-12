import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  source_path: z.string().min(1),
  content: z.string(),
  language: z.string().optional(),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().nonnegative(),
  hash: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/),
  ingested_at: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

export type Document = z.infer<typeof DocumentSchema>;

export function createDocument(
  fields: Omit<Document, 'id' | 'ingested_at'>,
): Document {
  return DocumentSchema.parse({
    ...fields,
    id: randomUUID(),
    ingested_at: new Date().toISOString(),
  });
}
