import { readFile } from 'node:fs/promises';
import { createDocument, createChunk } from '@aikb/core-types';
import type { Document, Chunk, FileEntry } from '@aikb/core-types';
import type { ChunkOptions } from './types.js';
import { detectLanguage } from './language.js';
import { sha256 } from './hash.js';
import { computeLineRange } from './lines.js';
import { chunkFixed } from './strategies/fixed.js';
import { chunkByParagraph } from './strategies/paragraph.js';
import { chunkCodeAware } from './strategies/code-aware.js';

export interface LoadAndChunkResult {
  document: Document;
  chunks: Chunk[];
}

/**
 * Read a file from disk, create a Document, and split into Chunks.
 * Binary files (containing null bytes) are skipped: returns Document with empty chunks array.
 */
export async function loadAndChunk(
  entry: FileEntry,
  options?: ChunkOptions,
): Promise<LoadAndChunkResult> {
  const maxChunkSize = options?.maxChunkSize ?? 1500;
  const overlap = options?.overlap ?? 200;
  const strategy = options?.strategy ?? 'code-aware';

  const rawBuffer = await readFile(entry.path);

  // Detect binary files by presence of null bytes
  if (rawBuffer.includes(0)) {
    console.warn(`[core-chunking] Skipping binary file: ${entry.path}`);
    const content = '';
    const document = createDocument({
      source_path: entry.path,
      content,
      language: options?.language ?? detectLanguage(entry.extension),
      size_bytes: entry.size_bytes,
      hash: sha256(content),
    });
    return { document, chunks: [] };
  }

  const content = rawBuffer.toString('utf-8');
  const documentHash = sha256(content);
  const language = options?.language ?? detectLanguage(entry.extension);

  const document = createDocument({
    source_path: entry.path,
    content,
    language,
    size_bytes: entry.size_bytes,
    hash: documentHash,
  });

  // Empty file → no chunks
  if (content.trim().length === 0) {
    return { document, chunks: [] };
  }

  // Select and run strategy
  let rawChunks: Array<{ text: string; offset: number }>;
  if (strategy === 'fixed') {
    rawChunks = chunkFixed(content, maxChunkSize, overlap);
  } else if (strategy === 'paragraph') {
    rawChunks = chunkByParagraph(content, maxChunkSize, overlap);
  } else {
    rawChunks = chunkCodeAware(content, language, maxChunkSize, overlap);
  }

  const chunks: Chunk[] = rawChunks.map((raw, index) => {
    const chunkHash = sha256(raw.text);
    const { line_start, line_end } = computeLineRange(
      content,
      raw.offset,
      raw.text.length,
    );
    return createChunk({
      document_id: document.id,
      source_path: entry.path,
      content: raw.text,
      hash: chunkHash,
      index,
      line_start,
      line_end,
      language,
    });
  });

  return { document, chunks };
}
