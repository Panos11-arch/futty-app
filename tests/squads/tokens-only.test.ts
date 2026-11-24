// U7 (docs/specs/17-ui-prompts.md): squads, posts and the pop-up shells take
// tokens only: no hex or rgb colours, numeric font sizes or radii, font
// weights, shadows, emoji, or the deprecated palette and fonts. The parallax
// header is gone.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const files = [
  'app/squads.tsx',
  'app/join-squad-post.tsx',
  'app/modal.tsx',
  'components/popup-modal.tsx',
  'components/wizard-modal.tsx',
  'components/external-link.tsx',
];

describe.each(files)('%s uses tokens only', (file) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8');

  it('has no hex colour', () => expect(text.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull());
  it('has no rgb() colour', () => expect(text.match(/rgba?\(/g)).toBeNull());
  it('has no numeric fontSize', () => expect(text.match(/fontSize\s*:\s*\d/g)).toBeNull());
  it('has no numeric borderRadius', () => expect(text.match(/[rR]adius\s*:\s*\d/g)).toBeNull());
  it('has no fontWeight', () => expect(text.match(/fontWeight/g)).toBeNull());
  it('has no shadow styles', () => expect(text.match(/shadow[A-Z]|boxShadow/g)).toBeNull());
  it('has no emoji', () => expect(text.match(/\p{Extended_Pictographic}/gu)).toBeNull());
  it('uses no deprecated tokens', () => {
    expect(text.match(/FuttyColors|FuttyFonts|ThemedView|useThemeColor/g)).toBeNull();
  });
});

it('the parallax header is deleted', () => {
  expect(fs.existsSync(path.join(root, 'components/parallax-scroll-view.tsx'))).toBe(false);
});

it('buttons on these screens are in sentence case', () => {
  const squads = fs.readFileSync(path.join(root, 'app/squads.tsx'), 'utf8');
  const join = fs.readFileSync(path.join(root, 'app/join-squad-post.tsx'), 'utf8');
  expect(squads + join).not.toMatch(/Pay My Share|Please wait/);
});
