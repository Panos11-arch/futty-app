// U5 (docs/specs/17-ui-prompts.md): profile, account, Premium, notifications
// and Futty AI take tokens only: no hex or rgb colours, numeric font sizes or
// radii, font weights, raw shadows, emoji, or the deprecated palette, fonts
// and themed text.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const files = [
  'app/(tabs)/profile.tsx',
  'app/account/index.tsx',
  'app/account/help.tsx',
  'app/account/how-it-works.tsx',
  'app/account/privacy-policy.tsx',
  'app/account/terms.tsx',
  'app/account/premium.tsx',
  'app/account/activity/index.tsx',
  'app/account/activity/matches.tsx',
  'app/account/activity/teams.tsx',
  'app/account/payments/index.tsx',
  'app/account/payments/methods.tsx',
  'app/account/payments/owed.tsx',
  'app/account/payments/transactions.tsx',
  'app/account/settings/index.tsx',
  'app/account/settings/notifications.tsx',
  'app/account/settings/privacy.tsx',
  'app/account/settings/security.tsx',
  'app/premium-plan.tsx',
  'app/notifications.tsx',
  'app/edit-profile.tsx',
  'components/menu-row.tsx',
  'components/doc-screen.tsx',
  'app/futty-ai/index.tsx',
  'app/futty-ai/[id].tsx',
  'components/futty-ai/ai-bubbles.tsx',
  'components/futty-ai/ai-chat-header.tsx',
  'components/futty-ai/ai-markdown.tsx',
  'components/futty-ai/ask-ai-button.tsx',
  'components/futty-ai/attachments.tsx',
  'components/futty-ai/photo-viewer.tsx',
  'components/futty-ai/quick-replies.tsx',
  'components/futty-ai/typing-indicator.tsx',
];

describe.each(files)('%s uses tokens only', (file) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8');

  it('has no hex colour', () => expect(text.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull());
  it('has no rgb() colour', () => expect(text.match(/rgba?\(/g)).toBeNull());
  it('has no numeric fontSize', () => expect(text.match(/fontSize\s*:\s*\d/g)).toBeNull());
  it('has no numeric borderRadius', () => expect(text.match(/[rR]adius\s*:\s*\d/g)).toBeNull());
  it('has no fontWeight', () => expect(text.match(/fontWeight/g)).toBeNull());
  it('has no raw shadow styles (the shadow token only)', () => expect(text.match(/shadow[A-Z]|boxShadow/g)).toBeNull());
  it('has no emoji', () => expect(text.match(/\p{Extended_Pictographic}/gu)).toBeNull());
  it('uses no deprecated tokens or old themed text', () => {
    expect(text.match(/FuttyColors|FuttyFonts|ThemedText|ThemedView|useThemeColor|IconLabel|AuthButton|AuthError/g)).toBeNull();
  });
  it('has no money maths in floating point', () => expect(text.match(/\/\s*100\)?\.toFixed/g)).toBeNull());
});

it('menu rows and section titles are in sentence case', () => {
  const menu = ['app/account/index.tsx', 'app/account/payments/index.tsx', 'app/account/settings/index.tsx', 'app/account/activity/index.tsx']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
    .join('\n');
  const labels = [...menu.matchAll(/(?:label|title)="([^"]+)"/g)].map((m) => m[1]);
  // A capital after the first word is only allowed for names.
  const names = /^(Futty|Premium|Team|I)$/;
  for (const label of labels) {
    const later = label.split(' ').slice(1);
    expect(later.filter((w) => /^[A-Z]/.test(w) && !names.test(w))).toEqual([]);
  }
});
