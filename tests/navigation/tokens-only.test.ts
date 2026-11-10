// The new navigation files take tokens only (docs/specs/17-ui-prompts.md
// rules): no hex colours, numeric font sizes or emoji.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const files = ['app/(tabs)/_layout.tsx', 'app/(tabs)/book.tsx', 'app/(tabs)/play.tsx', 'lib/play-segments.ts'];

describe.each(files)('%s uses tokens only', (file) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8');

  it('has no hex colour', () => expect(text.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull());
  it('has no numeric fontSize', () => expect(text.match(/fontSize\s*:\s*\d/g)).toBeNull());
  it('has no emoji', () => expect(text.match(/\p{Extended_Pictographic}/gu)).toBeNull());
});
