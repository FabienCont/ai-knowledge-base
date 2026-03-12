import type { TextChunk } from './fixed.js';
import { chunkFixed } from './fixed.js';
import { chunkByParagraph } from './paragraph.js';

/**
 * Regex patterns for top-level code structure boundaries.
 * Matches:
 *   - function/async function declarations (with optional export/default)
 *   - class declarations (with optional export/abstract)
 *   - Python def statements
 *   - Rust fn / pub fn / pub async fn statements
 *   - Arrow-function variable declarations (const/let/var = (async) ()=>)
 */
const CODE_BOUNDARY_RE =
  /^(export\s+)?(default\s+)?(async\s+)?function\b|^(export\s+)?(abstract\s+)?class\b|^def\s+\w|^fn\s+\w|^pub\s+(async\s+)?fn\s+\w|^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/m;

/** Regex for markdown headings */
const HEADING_RE = /^#{1,6}\s+/m;

/**
 * Split text at logical code/document boundaries.
 * Falls back to paragraph strategy when no structural boundaries found,
 * and to fixed strategy when chunks are still too large.
 */
export function chunkCodeAware(
  text: string,
  language: string | undefined,
  maxSize: number,
  overlap: number,
): TextChunk[] {
  if (text.length === 0) return [];

  if (language === 'markdown') {
    return chunkMarkdown(text, maxSize, overlap);
  }

  const isCodeLanguage = language !== undefined && language !== 'text';
  if (isCodeLanguage) {
    const result = chunkByCodeBoundaries(text, maxSize, overlap);
    if (result !== null) return result;
  }

  // Fall back to paragraph strategy
  const paraChunks = chunkByParagraph(text, maxSize, overlap);
  if (paraChunks.length > 0) return paraChunks;

  // Final fallback: fixed
  return chunkFixed(text, maxSize, overlap);
}

function chunkMarkdown(
  text: string,
  maxSize: number,
  overlap: number,
): TextChunk[] {
  // Split on headings while preserving them
  const sections: Array<{ text: string; offset: number }> = [];
  const re = /(?=^#{1,6}\s+)/gm;
  const parts = text.split(re);
  let offset = 0;

  for (const part of parts) {
    if (part.trim().length > 0) {
      sections.push({ text: part, offset });
    }
    offset += part.length;
  }

  if (sections.length <= 1 || !HEADING_RE.test(text)) {
    // No headings found; use paragraph strategy
    return chunkByParagraph(text, maxSize, overlap);
  }

  const chunks: TextChunk[] = [];
  let prevEnd = '';

  for (const section of sections) {
    if (section.text.length <= maxSize) {
      const overlapText =
        prevEnd.length > 0 ? prevEnd.slice(-overlap) + '\n\n' : '';
      const content = (overlapText + section.text).trim();
      chunks.push({ text: content, offset: section.offset });
      prevEnd = section.text;
    } else {
      // Large section: split by paragraphs within the section
      const subChunks = chunkByParagraph(section.text, maxSize, overlap);
      for (const sub of subChunks) {
        chunks.push({ text: sub.text, offset: section.offset + sub.offset });
      }
      prevEnd = section.text.slice(-overlap);
    }
  }

  return chunks;
}

function chunkByCodeBoundaries(
  text: string,
  maxSize: number,
  overlap: number,
): TextChunk[] | null {
  const lines = text.split('\n');
  const boundaryIndices: number[] = [];
  let charOffset = 0;
  const lineOffsets: number[] = [];

  for (const line of lines) {
    lineOffsets.push(charOffset);
    charOffset += line.length + 1; // +1 for \n
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (CODE_BOUNDARY_RE.test(line)) {
      boundaryIndices.push(i);
    }
  }

  if (boundaryIndices.length < 2) {
    return null;
  }

  const sections: Array<{ text: string; offset: number }> = [];
  for (let b = 0; b < boundaryIndices.length; b++) {
    const startLine = boundaryIndices[b]!;
    const endLine =
      b + 1 < boundaryIndices.length ? boundaryIndices[b + 1]! : lines.length;
    const sectionLines = lines.slice(startLine, endLine);
    const sectionText = sectionLines.join('\n').trim();
    if (sectionText.length > 0) {
      sections.push({ text: sectionText, offset: lineOffsets[startLine]! });
    }
  }

  // Also include any preamble before the first boundary
  if (boundaryIndices[0]! > 0) {
    const preambleLines = lines.slice(0, boundaryIndices[0]);
    const preambleText = preambleLines.join('\n').trim();
    if (preambleText.length > 0) {
      sections.unshift({ text: preambleText, offset: 0 });
    }
  }

  if (sections.length === 0) return null;

  const chunks: TextChunk[] = [];
  let prevEnd = '';

  for (const section of sections) {
    if (section.text.length <= maxSize) {
      const overlapText =
        prevEnd.length > 0 ? prevEnd.slice(-overlap) + '\n\n' : '';
      const content = (overlapText + section.text).trim();
      chunks.push({ text: content, offset: section.offset });
      prevEnd = section.text;
    } else {
      // Oversized section: use paragraph fallback, then fixed
      const subChunks = chunkByParagraph(section.text, maxSize, overlap);
      const toUse =
        subChunks.length > 0
          ? subChunks
          : chunkFixed(section.text, maxSize, overlap);
      for (const sub of toUse) {
        chunks.push({ text: sub.text, offset: section.offset + sub.offset });
      }
      prevEnd = section.text.slice(-overlap);
    }
  }

  return chunks.length > 0 ? chunks : null;
}
