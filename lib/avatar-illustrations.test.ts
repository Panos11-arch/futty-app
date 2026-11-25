import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ILLUSTRATION_SVGS } from '@/assets/avatars/illustrations';
import {
  AVATAR_ILLUSTRATION_IDS,
  avatarIllustrationLabel,
  isAvatarIllustrationId,
} from '@/lib/avatar-illustrations';

/** The id list in the migration's check constraint, in order. */
function migrationIds(): string[] {
  const dir = join(__dirname, '..', 'supabase', 'migrations');
  const file = readdirSync(dir).find((f) => f.endsWith('_pay_avatar_illustration.sql'));
  if (!file) throw new Error('pay_avatar_illustration migration not found');
  const sql = readFileSync(join(dir, file), 'utf8');
  const check = /profiles_avatar_illustration_check\s+check \(avatar_illustration in \(([\s\S]*?)\)\)/.exec(sql);
  if (!check) throw new Error('profiles_avatar_illustration_check not found');
  return [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('AVATAR_ILLUSTRATION_IDS', () => {
  it('has 48 unique ids', () => {
    expect(AVATAR_ILLUSTRATION_IDS).toHaveLength(48);
    expect(new Set(AVATAR_ILLUSTRATION_IDS).size).toBe(48);
    expect(AVATAR_ILLUSTRATION_IDS[0]).toBe('avatar-01');
    expect(AVATAR_ILLUSTRATION_IDS[47]).toBe('avatar-48');
  });

  it('is exactly the list the server accepts', () => {
    expect(migrationIds()).toEqual([...AVATAR_ILLUSTRATION_IDS]);
  });

  it('has one bundled drawing per id, and no other', () => {
    expect(Object.keys(ILLUSTRATION_SVGS).sort()).toEqual([...AVATAR_ILLUSTRATION_IDS].sort());
  });
});

describe('the bundled drawings', () => {
  it.each(AVATAR_ILLUSTRATION_IDS.map((id) => [id]))('%s is SVG that loads nothing from the network', (id) => {
    const svg = ILLUSTRATION_SVGS[id];
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    // The only URL allowed is the SVG namespace, which is a name, not a fetch.
    expect(svg.replace(/xmlns(:\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, '')).not.toMatch(/https?:|href="(?!#)/);
    expect(svg).not.toMatch(/<image|<script|<metadata/);
  });
});

describe('isAvatarIllustrationId', () => {
  it('accepts every bundled id', () => {
    for (const id of AVATAR_ILLUSTRATION_IDS) expect(isAvatarIllustrationId(id)).toBe(true);
  });

  it.each([['avatar-00'], ['avatar-49'], ['avatar-1'], [''], ['AVATAR-01'], [null], [undefined], [7], [{}]])(
    'refuses %p',
    (value) => {
      expect(isAvatarIllustrationId(value)).toBe(false);
    }
  );

  it('refuses names inherited from Object', () => {
    expect(isAvatarIllustrationId('toString')).toBe(false);
    expect(isAvatarIllustrationId('constructor')).toBe(false);
  });
});

describe('avatarIllustrationLabel', () => {
  it('names an avatar by its number', () => {
    expect(avatarIllustrationLabel('avatar-01')).toBe('Avatar 1');
    expect(avatarIllustrationLabel('avatar-48')).toBe('Avatar 48');
  });
});
