export interface ExtractedCodeLine {
  readonly displayLine: number;
  readonly rawLine: number;
  readonly text: string;
}

function skipWhitespaceAndComments(src: string, idx: number): number {
  const n = src.length;
  let i = idx;
  while (i < n) {
    const ch = src[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function skipStringOrTemplate(src: string, idx: number, quote: string): number {
  const n = src.length;
  let i = idx + 1;
  while (i < n) {
    const ch = src[i]!;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && src[i + 1] === '{') {
      i = findStatementEnd(src, i + 2, 1);
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return n;
}

function findStatementEnd(src: string, idx: number, initialBraceDepth = 0): number {
  const n = src.length;
  let i = idx;
  let braceDepth = initialBraceDepth;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (i < n) {
    const ch = src[i]!;
    if (ch === '\'' || ch === '"' || ch === '`') {
      i = skipStringOrTemplate(src, i, ch);
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    if (ch === '{') braceDepth += 1;
    else if (ch === '}') {
      braceDepth -= 1;
      if (initialBraceDepth > 0 && braceDepth === 0) return i + 1;
    } else if (ch === '(') parenDepth += 1;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (
      ch === ';' &&
      braceDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0
    ) {
      return i + 1;
    }

    i += 1;
  }
  return n;
}

function lineNumberAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i += 1) {
    if (src[i] === '\n') line += 1;
  }
  return line;
}

function markRemovedRange(
  removedLines: Set<number>,
  src: string,
  startOffset: number,
  endOffset: number,
): void {
  const startLine = lineNumberAt(src, startOffset);
  const endLine = lineNumberAt(src, Math.max(startOffset, endOffset - 1));
  for (let l = startLine; l <= endLine; l += 1) {
    removedLines.add(l);
  }
}

/**
 * Strips top-level `import` declarations and `export const meta = ...` boilerplate
 * so students read only executable algorithm helpers and `search()`, while mapping
 * each displayed line back to its 1-based raw file line for active-step highlighting.
 */
export function extractAlgorithmCode(source: string): readonly ExtractedCodeLine[] {
  const removedLines = new Set<number>();
  const n = source.length;
  let i = 0;

  while (i < n) {
    i = skipWhitespaceAndComments(source, i);
    if (i >= n) break;

    const rest = source.slice(i);
    if (/^import\b/.test(rest)) {
      const end = findStatementEnd(source, i);
      markRemovedRange(removedLines, source, i, end);
      i = end;
      continue;
    }

    if (/^(export\s+)?const\s+meta\b/.test(rest)) {
      const end = findStatementEnd(source, i);
      markRemovedRange(removedLines, source, i, end);
      i = end;
      continue;
    }

    break;
  }

  const rawLines = source.trimEnd().split('\n');
  const kept: { rawLine: number; text: string }[] = [];
  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const rawLine = idx + 1;
    if (!removedLines.has(rawLine)) {
      kept.push({ rawLine, text: rawLines[idx]! });
    }
  }

  while (kept.length > 0 && kept[0]!.text.trim() === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1]!.text.trim() === '') kept.pop();

  const effective =
    kept.length > 0
      ? kept
      : rawLines.map((text, idx) => ({ rawLine: idx + 1, text }));

  return effective.map((entry, idx) => ({
    displayLine: idx + 1,
    rawLine: entry.rawLine,
    text: entry.text,
  }));
}
