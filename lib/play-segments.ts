// Play's sections (docs/specs/15-design.md section 0.9). Play is no longer a
// tab (S2): it opens from Account → Play. Community has its own tab (S2) and
// Leagues its own screen (S9, /leagues). /team redirects here; an old
// ?segment=leagues link opens /leagues.

export const PLAY_SEGMENTS = [
  { value: 'teams', label: 'Teams' },
  { value: 'matches', label: 'Matches' },
] as const;

export type PlaySegment = (typeof PLAY_SEGMENTS)[number]['value'];

const VALUES = new Set<string>(PLAY_SEGMENTS.map((s) => s.value));

const first = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw);

/** The segment named in a URL param; Teams when missing or unknown. */
export function parsePlaySegment(raw: string | string[] | undefined): PlaySegment {
  const value = first(raw);
  return value && VALUES.has(value) ? (value as PlaySegment) : 'teams';
}

/** The old Leagues segment, which now opens /leagues (S9). */
export function isLeaguesSegment(raw: string | string[] | undefined): boolean {
  return first(raw) === 'leagues';
}

/** Where a link to one Play segment goes. */
export function playHref(segment: PlaySegment, extra: { teamId?: string } = {}) {
  const params: { segment: PlaySegment; teamId?: string } = { segment };
  if (extra.teamId) params.teamId = extra.teamId;
  return { pathname: '/play' as const, params };
}
