// The Play tab's sections (docs/specs/15-design.md section 4). Old routes
// (/team, /leagues, /community) redirect here with the matching segment.

export const PLAY_SEGMENTS = [
  { value: 'teams', label: 'Teams' },
  { value: 'matches', label: 'Matches' },
  { value: 'leagues', label: 'Leagues' },
  { value: 'community', label: 'Community' },
] as const;

export type PlaySegment = (typeof PLAY_SEGMENTS)[number]['value'];

const VALUES = new Set<string>(PLAY_SEGMENTS.map((s) => s.value));

/** The segment named in a URL param; Teams when missing or unknown. */
export function parsePlaySegment(raw: string | string[] | undefined): PlaySegment {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && VALUES.has(value) ? (value as PlaySegment) : 'teams';
}

/** Where a link to one Play segment goes. */
export function playHref(segment: PlaySegment, extra: { teamId?: string } = {}) {
  const params: { segment: PlaySegment; teamId?: string } = { segment };
  if (extra.teamId) params.teamId = extra.teamId;
  return { pathname: '/play' as const, params };
}
