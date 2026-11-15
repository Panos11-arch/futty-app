import fs from 'node:fs';
import path from 'node:path';

// U6 files use components/ui and the tokens only (docs/specs/17-ui-prompts.md).
const ROOT = path.join(__dirname, '..', '..');
const FILES = [
  'app/sign-in.tsx',
  'app/choose-username.tsx',
  'app/forgot-password.tsx',
  'app/reset-password.tsx',
  'app/confirm-email.tsx',
  'components/auth-form.tsx',
  'components/phone-field.tsx',
  'components/lock-screen.tsx',
];

describe.each(FILES)('%s uses tokens only', (file) => {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  it('has no hex colour', () => expect(text.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull());
  it('has no numeric fontSize', () => expect(text.match(/fontSize\s*:\s*\d/g)).toBeNull());
  it('has no emoji', () => expect(text.match(/\p{Extended_Pictographic}/gu)).toBeNull());
  it('has no deprecated theme names', () =>
    expect(text.match(/FuttyColors|FuttyFonts|useThemeColor|ThemedText/g)).toBeNull());
});

it('the waving-hand animation is gone', () => {
  expect(fs.existsSync(path.join(ROOT, 'components', 'hello-wave.tsx'))).toBe(false);
});
