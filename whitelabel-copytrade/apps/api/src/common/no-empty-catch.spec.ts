// # Responsibility: rejects empty and default-only catch blocks in money-path modules unless explicitly marked intentional.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const moduleRoot = path.resolve(__dirname, '../modules');
const ownedModules = [
  'billing',
  'custody',
  'oms',
  'copy-trading',
  'portfolio-accounting',
  'exchanges',
  'risk-management',
  'risk',
];

function collectSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (!entry.isFile() || !/\.(service|repository|processor)\.ts$/.test(entry.name)) return [];
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.controller.ts')) return [];
    return [fullPath];
  });
}

function isDefaultOnlyCatch(clause: ts.CatchClause): boolean {
  const statements = clause.block.statements;
  if (statements.length === 0) return true;
  if (statements.length !== 1 || !ts.isExpressionStatement(statements[0])) return false;
  const expression = statements[0].expression;
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  const value = expression.right;
  if (ts.isArrayLiteralExpression(value) && value.elements.length === 0) return true;
  if (value.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isNumericLiteral(value) && value.text === '0') return true;
  if (ts.isStringLiteral(value) && value.text.length === 0) return true;
  return ts.isIdentifier(value) && value.text === 'undefined';
}

describe('money-path catch blocks', () => {
  it('logs and propagates errors instead of silently swallowing or defaulting them', () => {
    const violations: string[] = [];
    const files = ownedModules.flatMap((moduleName) => collectSourceFiles(path.join(moduleRoot, moduleName)));

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const visit = (node: ts.Node): void => {
        if (ts.isCatchClause(node) && isDefaultOnlyCatch(node)) {
          const catchText = source.slice(node.getStart(parsed), node.end);
          if (!catchText.includes('intentionally-ignored:')) {
            const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
            violations.push(`${path.relative(moduleRoot, file)}:${line}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }

    expect(violations).toEqual([]);
  });
});
