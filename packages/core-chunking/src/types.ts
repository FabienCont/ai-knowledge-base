export type ChunkStrategy = 'fixed' | 'paragraph' | 'code-aware';

export interface ChunkOptions {
  /** Maximum characters per chunk (default: 1500) */
  maxChunkSize?: number;
  /** Overlap characters between adjacent chunks (default: 200) */
  overlap?: number;
  /** Chunking strategy (default: 'code-aware') */
  strategy?: ChunkStrategy;
  /** Override language detection */
  language?: string;
}
