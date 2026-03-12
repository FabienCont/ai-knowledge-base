import type { TextChunk } from './fixed.js';
import { chunkFixed } from './fixed.js';

/**
 * Split text on blank lines (\n\n+), merge short paragraphs, split large ones.
 * Returns chunks with their start offset in the original text.
 */
export function chunkByParagraph(
  text: string,
  maxSize: number,
  overlap: number,
): TextChunk[] {
  if (text.length === 0) return [];

  // Split into paragraphs preserving offsets
  const paragraphs: Array<{ text: string; offset: number }> = [];
  const re = /\n{2,}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const para = text.slice(lastIndex, match.index);
    if (para.trim().length > 0) {
      paragraphs.push({ text: para.trim(), offset: lastIndex });
    }
    lastIndex = match.index + match[0].length;
  }
  const tail = text.slice(lastIndex);
  if (tail.trim().length > 0) {
    paragraphs.push({ text: tail.trim(), offset: lastIndex });
  }

  if (paragraphs.length === 0) return [];

  const chunks: TextChunk[] = [];
  let currentText = '';
  let currentOffset = paragraphs[0]!.offset;
  let prevChunkEnd = '';

  for (const para of paragraphs) {
    const separator = currentText.length > 0 ? '\n\n' : '';
    const candidate = currentText + separator + para.text;

    if (candidate.length <= maxSize) {
      if (currentText.length === 0) {
        currentOffset = para.offset;
      }
      currentText = candidate;
    } else {
      // Flush current accumulated text
      if (currentText.length > 0) {
        // Prepend overlap from previous chunk
        const overlapText =
          prevChunkEnd.length > 0
            ? prevChunkEnd.slice(-overlap) + '\n\n'
            : '';
        const chunkContent = (overlapText + currentText).trim();
        chunks.push({ text: chunkContent, offset: currentOffset });
        prevChunkEnd = currentText;
        currentText = '';
      }

      // If the single paragraph exceeds maxSize, use fixed chunking for it
      if (para.text.length > maxSize) {
        const subChunks = chunkFixed(para.text, maxSize, overlap);
        for (const sub of subChunks) {
          chunks.push({ text: sub.text, offset: para.offset + sub.offset });
        }
        prevChunkEnd = para.text.slice(-overlap);
        currentText = '';
        currentOffset = para.offset;
      } else {
        currentText = para.text;
        currentOffset = para.offset;
      }
    }
  }

  // Flush remainder
  if (currentText.length > 0) {
    const overlapText =
      prevChunkEnd.length > 0 ? prevChunkEnd.slice(-overlap) + '\n\n' : '';
    const chunkContent = (overlapText + currentText).trim();
    chunks.push({ text: chunkContent, offset: currentOffset });
  }

  return chunks;
}
