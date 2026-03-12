export interface TextChunk {
  text: string;
  offset: number;
}

/**
 * Simple sliding-window character chunking.
 * Returns chunks with their start offset in the original text.
 */
export function chunkFixed(
  text: string,
  maxSize: number,
  overlap: number,
): TextChunk[] {
  if (text.length === 0) return [];

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxSize, text.length);
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      // Find offset of trimmed content within original
      const leadingSpaces = raw.length - raw.trimStart().length;
      chunks.push({ text: trimmed, offset: start + leadingSpaces });
    }
    if (end === text.length) break;
    start = end - overlap;
    if (start <= (chunks[chunks.length - 1]?.offset ?? -1)) {
      // Avoid infinite loop: ensure forward progress
      start = end;
    }
  }

  return chunks;
}
