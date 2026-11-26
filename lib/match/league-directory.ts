// S9: the Leagues screen's LEAGUES tab (docs/specs/15-design.md, image 12).
// A competition is a (scope, format) pair: the Cyprus Open League
// ('Island-wide') or a city, in one of five formats. Its league row is the
// top-level one (parent_league_id null); divisions sit under it and seasons
// replace it, so pins and keys never name a row id.
import type { League } from '@/lib/leagues';
import { leagueFormatOpen } from '@/lib/premium';

/** Every format a league is listed in (decided 22 November). */
export const LEAGUE_FORMATS = ['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'] as const;
export type LeagueFormat = (typeof LEAGUE_FORMATS)[number];

/** The Cyprus Open League's scope, normalised. */
export const ISLAND_WIDE = 'island-wide';

/** Cities listed first, in this order; any other city follows, A to Z. */
const CITY_ORDER = ['nicosia', 'limassol', 'larnaca', 'paphos'];

export type CompetitionState = 'coming_soon' | 'signup' | 'running';

/** One server pin (competition_pins). */
export type CompetitionPin = { target_type: 'league'; scope: string; format: string };

export type CompetitionEntry = {
  /** Stable across seasons: league:<scope>:<format>. */
  key: string;
  /** Normalised. */
  scope: string;
  /** "Island-wide" or the city, for display. */
  area: string;
  format: LeagueFormat;
  /** The top-level league row, if there is one. */
  league: League | null;
  state: CompetitionState;
  /** "Limassol 5s": the league's name, or one made from the city and format. */
  name: string;
  stageLabel: string;
  pinned: boolean;
};

export type CompetitionGroup = {
  scope: string;
  label: string;
  subtitle: string;
  entries: CompetitionEntry[];
};

export type LeagueDirectory = {
  pinned: CompetitionEntry[];
  open: CompetitionGroup;
  cities: CompetitionGroup[];
};

export function normaliseScope(scope: string): string {
  return scope.trim().toLowerCase();
}

export function competitionKey(scope: string, format: string): string {
  return `league:${normaliseScope(scope)}:${format}`;
}

/** "limassol" → "Limassol", "island-wide" → "Island-wide". */
export function scopeLabel(scope: string): string {
  return normaliseScope(scope)
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** A competition's name when it has no league row (Panos, 26 November):
 *  "Nicosia 5-a-side League", "Cyprus Open 5-a-side League". */
export function competitionName(scope: string, format: string): string {
  const place = normaliseScope(scope) === ISLAND_WIDE ? 'Cyprus Open' : scopeLabel(scope);
  return `${place} ${format} League`;
}

/** A group's badge: "LI" for Limassol, "CY" for the Cyprus Open League. */
export function groupBadge(label: string): string {
  return label.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
}

/** A competition's badge: "L5" for Limassol 5-a-side, "C11" island-wide. */
export function competitionBadge(scope: string, format: string): string {
  const first = (normaliseScope(scope) === ISLAND_WIDE ? 'Cyprus' : scopeLabel(scope)).charAt(0).toUpperCase();
  const players = Number.parseInt(format, 10);
  return Number.isNaN(players) ? first : `${first}${players}`;
}

/** Coming soon: no top-level league row, a stage that isn't sign-up,
 *  season or divisions (an explicit 'coming_soon' included), or a format
 *  that needs Team Premium while it's off (lib/premium.ts). */
function stateOf(league: League | null, format: string, teamPremiumEnabled: boolean | undefined): CompetitionState {
  const open = teamPremiumEnabled === undefined ? leagueFormatOpen(format) : leagueFormatOpen(format, teamPremiumEnabled);
  if (!league || !open) return 'coming_soon';
  if (league.stage === 'signup') return 'signup';
  if (league.stage === 'season' || league.stage === 'divisions') return 'running';
  return 'coming_soon';
}

const STAGE_LABEL: Record<CompetitionState, string> = {
  coming_soon: 'Coming soon',
  signup: 'Sign-up open',
  running: 'In season',
};

function isLeagueFormat(format: string): format is LeagueFormat {
  return (LEAGUE_FORMATS as readonly string[]).includes(format);
}

function entryFor(
  scope: string,
  format: LeagueFormat,
  league: League | null,
  pinnedKeys: Set<string>,
  teamPremiumEnabled: boolean | undefined,
): CompetitionEntry {
  const key = competitionKey(scope, format);
  const state = stateOf(league, format, teamPremiumEnabled);
  const area = scope === ISLAND_WIDE ? 'Island-wide' : scopeLabel(scope);
  return {
    key,
    scope,
    area,
    format,
    league,
    state,
    name: league?.name?.trim() || competitionName(scope, format),
    stageLabel: STAGE_LABEL[state],
    pinned: pinnedKeys.has(key),
  };
}

function cityRank(scope: string) {
  const i = CITY_ORDER.indexOf(scope);
  return i === -1 ? CITY_ORDER.length : i;
}

/** The LEAGUES tab: Pinned, the Cyprus Open League, then every city that has
 *  a league on the server, each with all five formats. */
export function buildLeagueDirectory(
  leagues: League[],
  pins: CompetitionPin[],
  /** Team Premium's flag; lib/premium.ts's TEAM_PREMIUM_ENABLED when left out. */
  { teamPremiumEnabled }: { teamPremiumEnabled?: boolean } = {},
): LeagueDirectory {
  const pinnedKeys = new Set(
    pins.filter((p) => p.target_type === 'league' && isLeagueFormat(p.format)).map((p) => competitionKey(p.scope, p.format)),
  );

  const topLevel = new Map<string, League>();
  const cityScopes = new Set<string>();
  for (const league of leagues) {
    if (league.parent_league_id) continue;
    const scope = normaliseScope(league.scope);
    if (!scope) continue;
    if (scope !== ISLAND_WIDE) cityScopes.add(scope);
    if (isLeagueFormat(league.format)) topLevel.set(competitionKey(scope, league.format), league);
  }

  const entriesFor = (scope: string) =>
    LEAGUE_FORMATS.map((format) =>
      entryFor(scope, format, topLevel.get(competitionKey(scope, format)) ?? null, pinnedKeys, teamPremiumEnabled),
    );

  const openEntries = entriesFor(ISLAND_WIDE);
  const open: CompetitionGroup = {
    scope: ISLAND_WIDE,
    label: 'Cyprus Open League',
    subtitle: openEntries.every((e) => e.state === 'coming_soon')
      ? 'Island-wide · Coming soon'
      : `Island-wide · ${openEntries.length} leagues`,
    entries: openEntries,
  };

  const cities = [...cityScopes]
    .sort((a, b) => cityRank(a) - cityRank(b) || a.localeCompare(b))
    .map((scope) => {
      const entries = entriesFor(scope);
      return { scope, label: scopeLabel(scope), subtitle: `${entries.length} leagues`, entries };
    });

  const all = new Map([...openEntries, ...cities.flatMap((c) => c.entries)].map((e) => [e.key, e]));
  const pinned: CompetitionEntry[] = [];
  for (const pin of pins) {
    if (pin.target_type !== 'league' || !isLeagueFormat(pin.format)) continue;
    const key = competitionKey(pin.scope, pin.format);
    if (pinned.some((e) => e.key === key)) continue;
    // Between seasons a pinned competition may have no row: still shown.
    pinned.push(all.get(key) ?? entryFor(normaliseScope(pin.scope), pin.format, null, pinnedKeys, teamPremiumEnabled));
  }

  return { pinned, open, cities };
}
