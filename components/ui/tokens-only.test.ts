// Guard for docs/specs/15-design.md section 3: components/ui takes tokens,
// never raw colours, numeric font sizes or emoji. Reads every source file.
import fs from 'node:fs';
import path from 'node:path';

const dir = __dirname;
const sources = fs
  .readdirSync(dir)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
  .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')] as const);

describe('components/ui uses tokens only', () => {
  it('finds the component files', () => {
    expect(sources.map(([f]) => f)).toEqual(expect.arrayContaining(['button.tsx', 'sheet.tsx', 'venue-card.tsx']));
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
});
