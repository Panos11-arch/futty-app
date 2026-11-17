// Finds every pressable element in a file and what makes it readable to
// VoiceOver and TalkBack, for the U8 accessibility check
// (docs/specs/17-ui-prompts.md). Not a test.
import ts from 'typescript';

/** Elements a player can press. IconButton requires accessibilityLabel in
 *  its props type, so TypeScript already covers it. */
export const PRESSABLE_TAGS = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback'];

export type PressableUse = {
  line: number;
  tag: string;
  /** accessibilityLabel (or aria-label) is set. */
  labelled: boolean;
  /** A visible text child: JSX text, <Text>, or a component given a
   *  label/title/message string. */
  hasText: boolean;
  /** The children are passed through ({children}), so the caller supplies the text. */
  passesChildren: boolean;
  /** Numeric width or height under 44 in an inline style. */
  smallSide: number | null;
  hasHitSlop: boolean;
};

const TEXT_TAGS = /^(Text|ThemedText|Animated\.Text)$/;
const TEXT_PROPS = new Set(['label', 'title', 'message', 'text', 'subtitle']);

function attributes(node: ts.JsxElement | ts.JsxSelfClosingElement) {
  return (ts.isJsxElement(node) ? node.openingElement : node).attributes.properties;
}

function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement) {
  return (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText();
}

function hasAttr(node: ts.JsxElement | ts.JsxSelfClosingElement, names: string[]) {
  return attributes(node).some((a) => ts.isJsxAttribute(a) && names.includes(a.name.getText()));
}

function hasVisibleText(node: ts.Node): { text: boolean; passes: boolean } {
  let text = false;
  let passes = false;
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && n.text.trim()) text = true;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (TEXT_TAGS.test(tagName(n))) text = true;
      for (const a of attributes(n)) {
        if (ts.isJsxAttribute(a) && TEXT_PROPS.has(a.name.getText()) && a.initializer) text = true;
      }
    }
    if (ts.isJsxExpression(n) && n.expression && /^(props\.)?children$/.test(n.expression.getText())) passes = true;
    ts.forEachChild(n, visit);
  };
  if (ts.isJsxElement(node)) node.children.forEach(visit);
  return { text, passes };
}

const SIZE = /\b(?:width|height|minWidth|minHeight)\s*:\s*(\d+)\b/g;

/** The body of each entry in this file's StyleSheet.create({...}). */
function styleSheet(file: ts.SourceFile): Map<string, string> {
  const entries = new Map<string, string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(file) === 'StyleSheet.create') {
      const arg = n.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const p of arg.properties) {
          if (ts.isPropertyAssignment(p)) entries.set(p.name.getText(file), p.initializer.getText(file));
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return entries;
}

/** The smallest numeric width or height under 44 the style prop sets, inline
 *  or through styles.x from this file's StyleSheet. */
function smallestSide(node: ts.JsxElement | ts.JsxSelfClosingElement, sheet: Map<string, string>): number | null {
  const style = attributes(node).find((a) => ts.isJsxAttribute(a) && a.name.getText() === 'style');
  if (!style) return null;
  const text = style.getText();
  const referenced = [...text.matchAll(/\bstyles\.(\w+)/g)].map((m) => sheet.get(m[1]) ?? '');
  const sizes = [text, ...referenced].flatMap((t) => [...t.matchAll(SIZE)].map((m) => Number(m[1])));
  const small = sizes.filter((n) => n < 44);
  return small.length ? Math.min(...small) : null;
}

export function pressables(fileName: string, source: string): PressableUse[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sheet = styleSheet(file);
  const out: PressableUse[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && PRESSABLE_TAGS.includes(tagName(node))) {
      const { text, passes } = hasVisibleText(node);
      out.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        tag: tagName(node),
        labelled: hasAttr(node, ['accessibilityLabel', 'aria-label']),
        hasText: text,
        passesChildren: passes,
        smallSide: smallestSide(node, sheet),
        hasHitSlop: hasAttr(node, ['hitSlop']),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}
