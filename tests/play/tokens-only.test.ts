// U4 (docs/specs/17-ui-prompts.md): the Play screens and the components they
// use take tokens only: no hex or rgb colours, numeric font sizes or radii,
// emoji, or the deprecated palette and fonts. The drawn pitch is gone.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const files = [
  'app/(tabs)/team.tsx',
  'app/(tabs)/leagues.tsx',
  'app/(tabs)/community.tsx',
  'app/upcoming-fixtures.tsx',
  'app/previous-games.tsx',
  'app/fixture-confirmed.tsx',
  'app/fixture-chat.tsx',
  'app/matchmaking.tsx',
  'app/team-profile.tsx',
  'app/player-profile.tsx',
  'components/fixture-confirmed-card.tsx',
  'components/fixture-score-form.tsx',
  'components/booking-result-form.tsx',
  'components/add-player-row.tsx',
  'components/chip.tsx',
];

describe.each(files)('%s uses tokens only', (file) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8');

  it('has no hex colour', () => expect(text.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull());
  it('has no rgb() colour', () => expect(text.match(/rgba?\(/g)).toBeNull());
  it('has no numeric fontSize', () => expect(text.match(/fontSize\s*:\s*\d/g)).toBeNull());
  it('has no numeric borderRadius', () => expect(text.match(/[rR]adius\s*:\s*\d/g)).toBeNull());
  it('has no emoji', () => expect(text.match(/\p{Extended_Pictographic}/gu)).toBeNull());
  it('uses no deprecated tokens or old themed text', () => {
    expect(text.match(/FuttyColors|FuttyFonts|ThemedText|ThemedView|useThemeColor|IconLabel/g)).toBeNull();
  });
});

it('the drawn pitch background is deleted and nothing imports it', () => {
  expect(fs.existsSync(path.join(root, 'components/pitch-background.tsx'))).toBe(false);
  for (const file of files) {
    expect(fs.readFileSync(path.join(root, file), 'utf8')).not.toMatch(/pitch-background/);
  }
});
