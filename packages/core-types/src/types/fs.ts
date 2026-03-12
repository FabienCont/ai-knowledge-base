import { z } from 'zod';

export const FileEntrySchema = z.object({
  path: z.string().min(1),
  relative_path: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  modified_at: z.string().datetime(),
  extension: z.string(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;
