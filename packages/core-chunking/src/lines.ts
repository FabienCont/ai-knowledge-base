/**
 * Compute the 1-indexed line range for a chunk given:
 * - the full file text
 * - the character offset where the chunk starts
 * - the length of the chunk text
 */
export function computeLineRange(
  fullText: string,
  chunkCharOffset: number,
  chunkLength: number,
): { line_start: number; line_end: number } {
  let line = 1;
  for (let i = 0; i < chunkCharOffset && i < fullText.length; i++) {
    if (fullText[i] === '\n') line++;
  }
  const line_start = line;
  const chunkEnd = chunkCharOffset + chunkLength;
  for (let i = chunkCharOffset; i < chunkEnd && i < fullText.length; i++) {
    if (fullText[i] === '\n') line++;
  }
  return { line_start, line_end: line };
}
