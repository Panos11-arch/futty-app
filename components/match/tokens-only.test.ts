// Guard for docs/specs/15-design.md section 3: components/match takes
// tokens, never raw colours, numeric font sizes or corner radii, its own
// shadows or emoji, and never shows the word "void" (17, rules for every
// prompt).
import fs from 'node:fs';
import path from 'node:path';

const dir = __dirname;
const sources = fs
  .readdirSync(dir)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
  .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')] as const);

const banned = {
  'hex colour': /#[0-9a-f]{3,8}\b/gi,
  'numeric fontSize': /fontSize\s*:\s*\d/g,
  /** Corners come from radius in constants/futty-theme.ts. */
  'numeric borderRadius': /border(?:Top|Bottom)?(?:Left|Right|Start|End)?Radius\s*:\s*\d/g,
  /** The one soft shadow comes from Card (shadow in the theme); no component sets its own. */
  'shadow style': /\b(?:shadow(?:Color|Offset|Opacity|Radius)|elevation|boxShadow)\s*:/g,
  emoji: /\p{Extended_Pictographic}/gu,
};

const find = (pattern: RegExp, text: string) => text.match(new RegExp(pattern.source, pattern.flags));

describe('components/match uses tokens only', () => {
  it('finds the component files', () => {
    expect(sources.map(([f]) => f)).toEqual(
      expect.arrayContaining(['form-chips.tsx', 'match-row.tsx', 'score-line.tsx']),
    );
  });

  describe.each(Object.entries(banned))('no %s', (_, pattern) => {
    it.each(sources)('%s', (__, text) => {
      expect(find(pattern, text)).toBeNull();
    });
  });

  it.each([
    ['numeric borderRadius', 'borderRadius: 12'],
    ['numeric borderRadius', 'borderTopLeftRadius:8'],
    ['shadow style', 'shadowColor: colors.ink'],
    ['shadow style', 'shadowOffset: { width: 0, height: 2 }'],
    ['shadow style', 'shadowOpacity: 0.1'],
    ['shadow style', 'shadowRadius: 4'],
    ['shadow style', 'elevation: 3'],
  ] as const)('the %s guard catches `%s`', (name, sample) => {
    expect(find(banned[name], `const s = { ${sample} };`)).not.toBeNull();
  });

  it.each([
    ['numeric borderRadius', 'borderRadius: radius.pill'],
    ['shadow style', '...shadow'],
  ] as const)('the %s guard allows the token `%s`', (name, sample) => {
    expect(find(banned[name], `const s = { ${sample} };`)).toBeNull();
  });

  it.each(sources)('%s never puts "void" in on-screen words', (_, text) => {
    const strings = text.match(/(['"`])(?:(?!\1).)*\1/g) ?? [];
    expect(strings.filter((s) => /void/i.test(s) && !/^['"`]void['"`]$/.test(s))).toEqual([]);
  });
});
