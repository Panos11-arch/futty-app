// U8 (docs/specs/17-ui-prompts.md, step 4, and the rules for every prompt):
// every pressable can be read by VoiceOver and TalkBack, every touch target
// is at least 44 x 44, and text is free to grow with Dynamic Type. IconButton
// is covered by its props type (accessibilityLabel is required) and
// components/ui/icon-button.test.tsx; components/ui has its own tests.
//
// Clipping at Dynamic Type XL can't be seen from Jest: check each screen on
// the phone (the list is in the U8 pull request).
import { pressables } from './pressables';
import { ALL_SOURCES, NON_UI_SOURCES } from './sources';

const MIN_TOUCH = 44;

/** Fail on anything that stops text growing with the system text size.
 *  A cap of 1.5x or more is allowed: past that, layouts may cap on purpose. */
function fontScalingBlocks(text: string): string[] {
  const off = text.match(/allowFontScaling\s*=\s*\{\s*false\s*\}|allowFontScaling\s*:\s*false/g) ?? [];
  const caps = [...text.matchAll(/maxFontSizeMultiplier\s*[=:]\s*\{?\s*(\d+(?:\.\d+)?)/g)]
    .filter((m) => Number(m[1]) < 1.5)
    .map((m) => m[0]);
  return [...off, ...caps];
}

describe('the accessibility check', () => {
  it('finds pressables, labels and text', () => {
    const [labelled, withText, bare, passes] = pressables(
      'planted.tsx',
      `const a = <Pressable accessibilityLabel="Close" onPress={f}><Icon /></Pressable>;
       const b = <Pressable onPress={f}><Text>Open</Text></Pressable>;
       const c = <TouchableOpacity onPress={f}><Icon /></TouchableOpacity>;
       const d = <Pressable onPress={f}>{children}</Pressable>;`,
    );
    expect(labelled).toMatchObject({ labelled: true, hasText: false });
    expect(withText).toMatchObject({ labelled: false, hasText: true });
    expect(bare).toMatchObject({ tag: 'TouchableOpacity', labelled: false, hasText: false, passesChildren: false });
    expect(passes).toMatchObject({ passesChildren: true });
  });

  it('counts a child component given a label or title as visible text', () => {
    const [row] = pressables('planted.tsx', '<Pressable onPress={f}><ListRow title="Payments" /></Pressable>');
    expect(row.hasText).toBe(true);
  });

  it('reads small sizes inline and from the StyleSheet', () => {
    const [inline, sheet, big] = pressables(
      'planted.tsx',
      `const a = <Pressable style={{ width: 24, height: 24 }} />;
       const b = <Pressable style={({ pressed }) => [styles.dot, pressed && styles.on]} />;
       const c = <Pressable style={styles.row} />;
       const styles = StyleSheet.create({ dot: { width: 32, height: 32 }, on: {}, row: { minHeight: 44 } });`,
    );
    expect(inline.smallSide).toBe(24);
    expect(sheet.smallSide).toBe(32);
    expect(big.smallSide).toBeNull();
  });

  it('catches text that is stopped from growing', () => {
    expect(fontScalingBlocks('<Text allowFontScaling={false}>x</Text>')).not.toEqual([]);
    expect(fontScalingBlocks('<Text maxFontSizeMultiplier={1.2}>x</Text>')).not.toEqual([]);
    expect(fontScalingBlocks('<Text maxFontSizeMultiplier={2}>x</Text>')).toEqual([]);
  });
});

/** QA 24 November, bug 8: a testID is for the Maestro tests, never spoken.
 *  React Native gives Android's accessibility tree a testID only as the
 *  view's resource id (ReactAccessibilityDelegate), which TalkBack doesn't
 *  read; it's spoken only if a screen copies it into a label. Flags labels
 *  built from a testID, and kebab-case labels that read like one. */
function testIdLabels(text: string): string[] {
  const fromTestId = text.match(/(?:accessibilityLabel|aria-label)\s*=\s*\{[^}]*testID[^}]*\}/g) ?? [];
  const kebab = text.match(/(?:accessibilityLabel|aria-label)\s*=\s*["'][a-z0-9]+(?:-[a-z0-9]+)+["']/g) ?? [];
  return [...fromTestId, ...kebab];
}

describe('the testID check', () => {
  it('catches a label taken from a testID or written like one', () => {
    expect(testIdLabels('<View accessibilityLabel={testID} />')).toHaveLength(1);
    expect(testIdLabels('<View accessibilityLabel={props.testID ?? title} />')).toHaveLength(1);
    expect(testIdLabels('<View accessibilityLabel="player-level" />')).toHaveLength(1);
    expect(testIdLabels('<View testID="player-level" accessibilityLabel="Level 6.4" />')).toEqual([]);
  });
});

describe.each(ALL_SOURCES)('%s', (file, text) => {
  it('never reads a testID aloud', () => {
    expect(testIdLabels(text)).toEqual([]);
  });
});

describe.each(NON_UI_SOURCES)('%s', (file, text) => {
  const found = pressables(file, text);

  it('every pressable has an accessibilityLabel or visible text', () => {
    // A wrapper that passes {children} gets its text from the caller.
    const unreadable = found.filter((p) => !p.labelled && !p.hasText && !p.passesChildren);
    expect(unreadable.map((p) => `${file}:${p.line} <${p.tag}>`)).toEqual([]);
  });

  it(`every pressable is at least ${MIN_TOUCH} x ${MIN_TOUCH}, or has a hitSlop`, () => {
    const small = found.filter((p) => p.smallSide !== null && !p.hasHitSlop);
    expect(small.map((p) => `${file}:${p.line} <${p.tag}> ${p.smallSide}pt`)).toEqual([]);
  });

  it('lets text grow with Dynamic Type', () => {
    expect(fontScalingBlocks(text)).toEqual([]);
  });
});
