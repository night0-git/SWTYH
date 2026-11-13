import ts from 'typescript';

interface EditOp {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function isSkippableDeclaration(stmt: ts.Statement): boolean {
  return (
    ts.isImportDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isFunctionDeclaration(stmt) ||
    ts.isEmptyStatement(stmt)
  );
}

function collectStatementListEdits(
  statements: readonly ts.Statement[],
  sf: ts.SourceFile,
  edits: EditOp[],
): void {
  for (const stmt of statements) {
    if (isSkippableDeclaration(stmt)) continue;
    const start = stmt.getStart(sf);
    const line = sf.getLineAndCharacterOfPosition(start).line + 1;
    edits.push({ start, end: start, text: `__traceLine(${line}); ` });
  }
}

function isInsideMetaInitializer(node: ts.Node): boolean {
  let curr: ts.Node | undefined = node.parent;
  while (curr) {
    if (
      ts.isVariableDeclaration(curr) &&
      ts.isIdentifier(curr.name) &&
      curr.name.text === 'meta'
    ) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

/**
 * Instruments executable statements inside `/src/algorithms/` TypeScript files
 * with `__traceLine(rawLine)` calls without altering `?raw` source text.
 */
export function instrumentAlgorithmSource(
  code: string,
  fileName = 'algorithm.ts',
  traceLineImportPath = '/src/engine/traceLine',
): string {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const edits: EditOp[] = [];

  const instrumentSingleBody = (body: ts.Statement) => {
    if (ts.isBlock(body) || isSkippableDeclaration(body)) return;
    const start = body.getStart(sf);
    const end = body.getEnd();
    const line = sf.getLineAndCharacterOfPosition(start).line + 1;
    edits.push({ start, end: start, text: `{ __traceLine(${line}); ` });
    edits.push({ start: end, end, text: ' }' });
  };

  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      isInsideMetaInitializer(node)
    ) {
      return;
    }

    if (ts.isBlock(node)) {
      collectStatementListEdits(node.statements, sf, edits);
    } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      collectStatementListEdits(node.statements, sf, edits);
    } else if (ts.isIfStatement(node)) {
      instrumentSingleBody(node.thenStatement);
      if (node.elseStatement && !ts.isIfStatement(node.elseStatement)) {
        instrumentSingleBody(node.elseStatement);
      }
    } else if (
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      instrumentSingleBody(node.statement);
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);

  if (edits.length === 0) return code;

  // Sort descending by position; for identical offsets, end-wrap (' }') comes before start-wrap ('{ ...')?
  // Wait: if two edits share the same offset (e.g. nested brace-less statements), apply outer-before-inner cleanly:
  // closing brace at `end` runs before opening brace at an earlier `start`, so descending `start` works cleanly.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);

  let out = code;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }

  return `import { __traceLine } from '${traceLineImportPath}';\n${out}`;
}
