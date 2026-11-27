// G4a: banner ads only where G4 puts them, and never on a screen it forbids.
// The banner is one shared component (components/ads/ad-banner.tsx); this
// guard follows every import from each forbidden screen, so a banner can't
// arrive there through a shared component either.
import fs from 'node:fs';
import path from 'node:path';

import { ALL_SOURCES, ROOT } from './sources';

const BANNER = 'components/ads/ad-banner.tsx';

/** The only files that render an AdBanner, each for one place G4a lists. */
const PLACEMENTS: Record<string, string> = {
  'app/(tabs)/index.tsx': 'Home, between Games needing players and Featured event',
  'components/competition/overview-tab.tsx': 'competition page: Overview, after Power rankings (image 13)',
  'components/competition/matches-tab.tsx': 'competition page: Matches',
  'components/competition/standings-tab.tsx': 'competition page: Standings',
  'components/competition/stats-tab.tsx': 'competition page: Stats',
  'components/match/team-of-the-week-view.tsx': 'Rankings: Team of the Week (image 15)',
  'components/match/power-ranking-list.tsx': 'Rankings: Power ranking (image 14)',
  'components/community/feed-list.tsx': 'Community feed, one every 8 posts (image 18)',
  'app/match/[id].tsx': 'the match page after the game',
  'app/player-profile.tsx': "another player's profile",
  'app/team-profile.tsx': "another team's profile",
};

/** Never a banner here (G4a): booking, the venue page, payment, after paying,
 *  messages, Futty AI, sign-up, settings, notifications, the player card and
 *  your own profile. */
const FORBIDDEN = [
  'app/book.tsx',
  'app/booking/[id].tsx',
  'app/booking-payment.tsx',
  'app/booking-after-pay.tsx',
  'app/my-bookings.tsx',
  'app/venue/[id].tsx',
  'app/messages/index.tsx',
  'app/messages/[id].tsx',
  'app/futty-ai/index.tsx',
  'app/futty-ai/[id].tsx',
  'app/sign-in.tsx',
  'app/auth/callback.tsx',
  'app/confirm-email.tsx',
  'app/choose-username.tsx',
  'app/date-of-birth.tsx',
  'app/starting-level.tsx',
  'app/notifications.tsx',
  'app/p/[username].tsx',
  'app/(tabs)/profile.tsx',
  'app/account/index.tsx',
  ...fs
    .readdirSync(path.join(ROOT, 'app/account/settings'))
    .filter((f) => /\.tsx$/.test(f))
    .map((f) => `app/account/settings/${f}`),
  ...fs
    .readdirSync(path.join(ROOT, 'app/account/payments'))
    .filter((f) => /\.tsx$/.test(f))
    .map((f) => `app/account/payments/${f}`),
];

const EXTENSIONS = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'];

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    const full = path.join(ROOT, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return candidate;
  }
  return null;
}

const sourceCache = new Map<string, string>();
function source(file: string) {
  if (!sourceCache.has(file)) sourceCache.set(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return sourceCache.get(file)!;
}

function imports(file: string): string[] {
  const specs = [...source(file).matchAll(/(?:from\s+|import\s+|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return specs.map((s) => resolve(file, s)).filter((f): f is string => f !== null && !/\.test\.tsx?$/.test(f));
}

/** The import chain from `start` to the banner, or null. */
function pathToBanner(start: string): string[] | null {
  const seen = new Set<string>([start]);
  const queue: string[][] = [[start]];
  while (queue.length) {
    const chain = queue.shift()!;
    for (const next of imports(chain[chain.length - 1])) {
      if (next === BANNER) return [...chain, next];
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...chain, next]);
      }
    }
  }
  return null;
}

describe('banner ads (G4a)', () => {
  it('only the agreed places render the shared AdBanner', () => {
    const users = ALL_SOURCES.filter(([f]) => f !== BANNER && imports(f).includes(BANNER)).map(([f]) => f);
    expect(users.sort()).toEqual(Object.keys(PLACEMENTS).sort());
  });

  it.each(FORBIDDEN)('never on %s, not even through a shared component', (screen) => {
    expect(fs.existsSync(path.join(ROOT, screen))).toBe(true);
    expect(pathToBanner(screen)).toBeNull();
  });

  it('every banner has its own kebab-case testID', () => {
    const ids = Object.keys(PLACEMENTS).flatMap((f) =>
      [...source(f).matchAll(/<AdBanner\s+testID=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map((m) => m[1] ?? m[2]),
    );
    expect(ids.length).toBeGreaterThanOrEqual(Object.keys(PLACEMENTS).length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9${}.]+)*$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
