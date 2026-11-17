// The venue dashboard's screens take tokens only (CLAUDE.md rule 10;
// docs/specs/15-design.md section 3): no hex colours, numeric font sizes or
// emoji in components/venue/ or app/venue-*.tsx. Tests are left out: they
// may quote what a screen must never show.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const source = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !/\.fixtures\.ts$/.test(f);

const files = [
  ...fs
    .readdirSync(path.join(root, 'components', 'venue'))
    .filter(source)
    .map((f) => `components/venue/${f}`),
  ...fs
    .readdirSync(path.join(root, 'app'))
    .filter((f) => f.startsWith('venue-') && source(f))
    .map((f) => `app/${f}`),
];

const HEX = /#[0-9a-f]{3,8}\b/gi;
const FONT_SIZE = /fontSize\s*:\s*\d/g;
const EMOJI = /\p{Extended_Pictographic}/gu;

describe('venue dashboard files', () => {
  it('finds the screens and their views', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'app/venue-dashboard.tsx',
        'app/venue-payouts.tsx',
        'app/venue-money.tsx',
        'components/venue/money-view.tsx',
        'components/venue/venue-screen.tsx',
      ]),
    );
  });

  it('the checks catch a planted copy', () => {
    const planted = "const s = { color: '#1a2b3c', fontSize: 14 }; const t = '\u{26BD}';";
    expect(planted.match(HEX)).not.toBeNull();
    expect(planted.match(FONT_SIZE)).not.toBeNull();
    expect(planted.match(EMOJI)).not.toBeNull();
  });
});

describe.each(files)('%s uses tokens only', (file) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8');

  it('has no hex colour', () => expect(text.match(HEX)).toBeNull());
  it('has no numeric fontSize', () => expect(text.match(FONT_SIZE)).toBeNull());
  it('has no emoji', () => expect(text.match(EMOJI)).toBeNull());
});
