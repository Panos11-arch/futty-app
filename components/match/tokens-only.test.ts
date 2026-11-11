// Guard for docs/specs/15-design.md section 3: components/match takes
// tokens, never raw colours, numeric font sizes or emoji, and never shows
// the word "void" (17, rules for every prompt).
import fs from 'node:fs';
import path from 'node:path';

const dir = __dirname;
const sources = fs
  .readdirSync(dir)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
  .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')] as const);

describe('components/match uses tokens only', () => {
  it('finds the component files', () => {
    expect(sources.map(([f]) => f)).toEqual(
      expect.arrayContaining(['form-chips.tsx', 'match-row.tsx', 'score-line.tsx']),
    );
  });

  it.each(sources)('%s has no hex colour', (_, text) => {
    expect(text.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
  });

  it.each(sources)('%s has no numeric fontSize', (_, text) => {
    expect(text.match(/fontSize\s*:\s*\d/g)).toBeNull();
  });

  it.each(sources)('%s has no emoji', (_, text) => {
    expect(text.match(/\p{Extended_Pictographic}/gu)).toBeNull();
  });

  it.each(sources)('%s never puts "void" in on-screen words', (_, text) => {
    const strings = text.match(/(['"`])(?:(?!\1).)*\1/g) ?? [];
    expect(strings.filter((s) => /void/i.test(s) && !/^['"`]void['"`]$/.test(s))).toEqual([]);
  });
});
