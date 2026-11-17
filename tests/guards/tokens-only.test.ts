// U8 (docs/specs/17-ui-prompts.md): the new look can't drift. Every screen
// and component outside components/ui and constants/ takes its colours,
// sizes, corners and shadow from constants/futty-theme.ts, through
// components/ui. This scans all of app/ and components/, so a new file is
// covered the day it lands.
import { NON_UI_SOURCES } from './sources';

const BANNED = {
  'hex colour': /#[0-9a-f]{3,8}\b/gi,
  'rgb() colour': /\brgba?\(/g,
  'numeric fontSize': /fontSize\s*:\s*\d/g,
  /** Corners come from radius in the theme. */
  'numeric borderRadius': /border(?:Top|Bottom)?(?:Left|Right|Start|End)?Radius\s*:\s*\d/g,
  /** The one soft shadow comes from the theme's shadow token, used by Card. */
  'shadow style': /\b(?:shadow(?:Color|Offset|Opacity|Radius)|elevation|boxShadow)\s*:/g,
  emoji: /\p{Extended_Pictographic}/gu,
} as const;

type Rule = keyof typeof BANNED;

const find = (rule: Rule, text: string) => {
  const re = BANNED[rule];
  return text.match(new RegExp(re.source, re.flags)) ?? [];
};

describe('the token scan', () => {
  it('covers app/ and components/ but not components/ui, tests or the dev gallery', () => {
    const files = NON_UI_SOURCES.map(([f]) => f);
    expect(files).toEqual(
      expect.arrayContaining([
        'app/(tabs)/index.tsx',
        'app/_layout.tsx',
        'app/venue-dashboard.tsx',
        'components/booking/checkout-view.tsx',
        'components/match/score-line.tsx',
        'components/popup-modal.tsx',
      ]),
    );
    expect(files.filter((f) => f.startsWith('components/ui/'))).toEqual([]);
    expect(files.filter((f) => /\.test\.tsx?$|\.fixtures\.ts$/.test(f))).toEqual([]);
    expect(files.filter((f) => f.startsWith('app/dev/'))).toEqual([]);
  });

  it.each([
    ['hex colour', "color: '#1a2b3c'"],
    ['hex colour', "color: '#FFF'"],
    ['rgb() colour', "color: 'rgba(0, 0, 0, 0.5)'"],
    ['rgb() colour', "color: 'rgb(1,2,3)'"],
    ['numeric fontSize', 'fontSize: 14'],
    ['numeric borderRadius', 'borderRadius: 8'],
    ['numeric borderRadius', 'borderTopLeftRadius:4'],
    ['shadow style', 'shadowColor: colors.ink'],
    ['shadow style', 'shadowOffset: { width: 0, height: 2 }'],
    ['shadow style', 'elevation: 3'],
    ['shadow style', "boxShadow: '0 1px 2px black'"],
    ['emoji', "label: 'Goal \u{26BD}'"],
  ] as const)('catches a planted %s: `%s`', (rule, sample) => {
    expect(find(rule, `const s = { ${sample} };`)).not.toEqual([]);
  });

  it.each([
    ['numeric fontSize', 'fontSize: type.body.fontSize'],
    ['numeric borderRadius', 'borderRadius: radius.card'],
    ['shadow style', '...shadow'],
    ['hex colour', "router.push('/match/1#lineups')"],
  ] as const)('lets the token through for %s: `%s`', (rule, sample) => {
    expect(find(rule, `const s = { ${sample} };`)).toEqual([]);
  });
});

describe.each(NON_UI_SOURCES)('%s uses tokens only', (_file, text) => {
  it.each(Object.keys(BANNED) as Rule[])('no %s', (rule) => {
    expect(find(rule, text)).toEqual([]);
  });
});
