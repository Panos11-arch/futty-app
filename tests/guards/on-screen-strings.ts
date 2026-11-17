// Pulls the words a file can put on screen, for the U8 copy check
// (docs/specs/17-ui-prompts.md): JSX text, and every string or template
// literal that reads like prose. Not a test.
import ts from 'typescript';

export type ScreenString = { line: number; text: string };

/** A string reads like prose when it has a space or starts with a capital.
 *  Single lower-case tokens ('authorized', 'void', 'submit') are status
 *  keys, RPC names or enum values, never shown as they are. */
export const isProse = (text: string) => /[A-Za-z]/.test(text) && (/\s/.test(text.trim()) || /^[A-Z]/.test(text.trim()));

function skipped(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  // import x from '...', export ... from '...', require('...'), import('...')
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    const callee = parent.expression.getText();
    if (callee === 'require' || parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    // jest.mock('...') in non-test helpers
    if (/^jest\./.test(callee)) return true;
  }
  // type Status = 'authorized' | 'void'
  if (ts.isLiteralTypeNode(parent)) return true;
  // { 'some-key': ... } property names
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  return false;
}

export function screenStrings(fileName: string, source: string): ScreenString[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: ScreenString[] = [];
  const add = (node: ts.Node, text: string) => {
    if (!isProse(text)) return;
    out.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: text.trim() });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (node.text.trim()) add(node, node.text.replace(/\s+/g, ' '));
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !skipped(node)) {
      add(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      // The fixed parts, with each ${...} as a placeholder word.
      add(node, [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' x '));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}
