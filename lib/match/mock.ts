// Typed mock data for the match components (A1b), in the real shapes of
// lib/match/types.ts. One list item per state, and a few matches with their
// squads and check-ins for form (decisions 1b.2 and 1b.3). Instants are UTC;
// Cyprus is UTC+3 until 25 October 2026 at 04:00 and UTC+2 after, so 16:00Z
// on 24 October and 17:00Z from 31 October are both 19:00 in Cyprus.
import type {
  ForfeitReason,
  MatchAttendanceRecord,
  MatchFormEntry,
  MatchKind,
  MatchListItem,
  MatchPlayerRecord,
  MatchResultConfirmed,
  MatchSideRecord,
  MatchStatus,
  Side,
} from '@/lib/match/types';

export const TEAM_HOME = 'team-home';
export const TEAM_AWAY = 'team-away';

export const PROFILE = {
  /** The viewer: holds a spot and checks in. */
  anghelo: 'profile-anghelo',
  /** Holds a spot on side a but never checks in. */
  sami: 'profile-sami',
  /** Held a spot, then left before kickoff. */
  leftEarly: 'profile-left-early',
  /** Side b team captain, no spot, checks in. */
  awayCaptain: 'profile-away-captain',
  /** Side b team substitute, no spot, never checks in. */
  awaySub: 'profile-away-sub',
  /** Side b player holding a spot, never checks in. */
  awaySpot: 'profile-away-spot',
} as const;

const ONE_HOUR = 60 * 60 * 1000;

function plusHour(iso: string): string {
  return new Date(Date.parse(iso) + ONE_HOUR).toISOString();
}

/** "2026-11-07T17:00:00.000Z" as Cyprus wall-clock time (UTC+2 after 25 October 2026, UTC+3 before). */
function cyprusLocal(iso: string): string {
  const ms = Date.parse(iso);
  const offsetHours = ms < Date.parse('2026-10-25T01:00:00Z') ? 3 : 2;
  return new Date(ms + offsetHours * ONE_HOUR).toISOString().slice(0, 19);
}

function sidesFor(matchId: string, kind: MatchKind): { a: MatchSideRecord; b: MatchSideRecord } {
  if (kind === 'pickup') {
    return {
      a: { match_id: matchId, side: 'a', team_id: null, label: 'Bibs', captain_profile_id: PROFILE.anghelo },
      b: { match_id: matchId, side: 'b', team_id: null, label: 'Non-bibs', captain_profile_id: null },
    };
  }
  return {
    a: { match_id: matchId, side: 'a', team_id: TEAM_HOME, label: 'Home FC', captain_profile_id: PROFILE.anghelo },
    b: { match_id: matchId, side: 'b', team_id: TEAM_AWAY, label: 'Away FC', captain_profile_id: PROFILE.awayCaptain },
  };
}

type Settled =
  | { status: 'confirmed'; score: [number, number] }
  | { status: 'confirmed'; forfeit: { side: Side; reason: ForfeitReason } }
  | { status: 'disputed' }
  | { status: 'no_result' };

/** A view row built by the same rules as the view (section 6.2). */
function resultRow(matchId: string, kind: MatchKind, kickoffAt: string, settled: Settled): MatchResultConfirmed {
  const endsAt = plusHour(kickoffAt);
  const sides = sidesFor(matchId, kind);
  let scoreA: number | null = null;
  let scoreB: number | null = null;
  let outcome: MatchResultConfirmed['outcome'] = null;
  let forfeitSide: Side | null = null;
  let forfeitReason: ForfeitReason | null = null;
  let confirmedVia: MatchResultConfirmed['confirmed_via'] = null;
  if (settled.status === 'confirmed' && 'score' in settled) {
    [scoreA, scoreB] = settled.score;
    outcome = scoreA > scoreB ? 'side_a_won' : scoreA < scoreB ? 'side_b_won' : 'draw';
    confirmedVia = 'agreed';
  } else if (settled.status === 'confirmed') {
    forfeitSide = settled.forfeit.side;
    forfeitReason = settled.forfeit.reason;
    outcome = forfeitSide === 'a' ? 'side_b_won' : 'side_a_won';
    confirmedVia = 'forfeit';
  }
  return {
    match_id: matchId,
    booking_id: `booking-${matchId}`,
    venue_id: 'venue-1',
    friendly_match_id: kind === 'named' ? `friendly-${matchId}` : null,
    league_fixture_id: null,
    side_a_team_id: sides.a.team_id,
    side_b_team_id: sides.b.team_id,
    side_a_score: scoreA,
    side_b_score: scoreB,
    outcome,
    result_status: settled.status,
    disputed: settled.status === 'disputed',
    confirmed_via: confirmedVia,
    forfeit_side: forfeitSide,
    forfeit_reason: forfeitReason,
    kickoff_at: kickoffAt,
    ends_at: endsAt,
    kickoff_local: cyprusLocal(kickoffAt),
    ends_local: cyprusLocal(endsAt),
    settled_at: plusHour(endsAt),
  };
}

function item(
  id: string,
  kind: MatchKind,
  status: MatchStatus,
  kickoffAt: string,
  settled: Settled | null,
  viewerSide: Side | null = 'a',
): MatchListItem {
  return {
    match: { id, kind, status, kickoff_at: kickoffAt, ends_at: plusHour(kickoffAt) },
    sides: sidesFor(id, kind),
    result: settled ? resultRow(id, kind, kickoffAt, settled) : null,
    venueName: 'Lakatamia Sports',
    viewerSide,
  };
}

// One list item per state.
export const mockUpcoming = item('m-upcoming', 'named', 'scheduled', '2026-11-14T17:00:00.000Z', null);
export const mockPlayed = item('m-played', 'pickup', 'played', '2026-11-10T17:00:00.000Z', null);
export const mockSideAWon = item('m-a-won', 'named', 'confirmed', '2026-11-07T17:00:00.000Z', {
  status: 'confirmed',
  score: [3, 1],
});
export const mockSideBWon = item('m-b-won', 'named', 'confirmed', '2026-11-05T17:00:00.000Z', {
  status: 'confirmed',
  score: [0, 2],
});
export const mockDraw = item('m-draw', 'pickup', 'confirmed', '2026-11-03T17:00:00.000Z', {
  status: 'confirmed',
  score: [2, 2],
});
export const mockForfeitPulledOut = item('m-forfeit-b', 'named', 'confirmed', '2026-10-31T17:00:00.000Z', {
  status: 'confirmed',
  forfeit: { side: 'b', reason: 'pulled_out' },
});
export const mockForfeitNoShow = item(
  'm-forfeit-a',
  'named',
  'confirmed',
  '2026-10-24T16:00:00.000Z',
  { status: 'confirmed', forfeit: { side: 'a', reason: 'no_show' } },
);
export const mockDisputed = item('m-disputed', 'named', 'disputed', '2026-11-01T17:00:00.000Z', { status: 'disputed' });
export const mockNoResult = item('m-no-result', 'pickup', 'no_result', '2026-11-02T17:00:00.000Z', {
  status: 'no_result',
});
export const mockVoid = item('m-void', 'pickup', 'void', '2026-11-12T17:00:00.000Z', null);
/** Sami's view of the 3-1: he held a spot but didn't check in, so it doesn't count for him (1b.2). */
export const mockSideAWonNotCheckedIn: MatchListItem = { ...mockSideAWon, viewerSide: null };

export const mockMatchItems: MatchListItem[] = [
  mockUpcoming,
  mockPlayed,
  mockSideAWon,
  mockSideBWon,
  mockDraw,
  mockForfeitPulledOut,
  mockForfeitNoShow,
  mockDisputed,
  mockNoResult,
  mockVoid,
];

// Squads and check-ins, for form.
type PlayerSpec = { profile: string; side: Side; spot: boolean; checkedIn: boolean; left?: boolean };

function entry(listItem: MatchListItem, specs: PlayerSpec[]): MatchFormEntry {
  const matchId = listItem.match.id;
  if (!listItem.result) throw new Error(`${matchId} has no result`);
  const players: MatchPlayerRecord[] = specs.map((s, i) => ({
    id: `${matchId}-player-${i}`,
    match_id: matchId,
    profile_id: s.profile,
    guest_name: null,
    side: s.side,
    position: null,
    share_id: s.spot ? `${matchId}-share-${i}` : null,
    left_at: s.left ? listItem.match.kickoff_at : null,
    created_at: listItem.match.kickoff_at,
  }));
  const attendance: MatchAttendanceRecord[] = specs
    .filter((s) => s.checkedIn)
    .map((s) => ({
      match_id: matchId,
      profile_id: s.profile,
      checked_in_at: listItem.match.kickoff_at,
      method: 'qr',
      checked_in_by: s.profile,
    }));
  return { result: listItem.result, sides: listItem.sides, players, attendance };
}

const viewerCheckedIn: PlayerSpec = { profile: PROFILE.anghelo, side: 'a', spot: true, checkedIn: true };

/** Matches with squads, in no particular order (form sorts them). */
export const mockFormEntries: MatchFormEntry[] = [
  // 3-1 win. Sami held a spot and didn't check in; one player left early; the
  // away substitute is in the squad but didn't come.
  entry(mockSideAWon, [
    viewerCheckedIn,
    { profile: PROFILE.sami, side: 'a', spot: true, checkedIn: false },
    { profile: PROFILE.leftEarly, side: 'a', spot: true, checkedIn: true, left: true },
    { profile: PROFILE.awayCaptain, side: 'b', spot: false, checkedIn: true },
    { profile: PROFILE.awaySub, side: 'b', spot: false, checkedIn: false },
  ]),
  entry(mockSideBWon, [viewerCheckedIn, { profile: PROFILE.awayCaptain, side: 'b', spot: false, checkedIn: true }]),
  entry(mockDraw, [viewerCheckedIn]),
  // Away FC pulled out: nobody checked in. Spot holders on both sides still get it (1b.3).
  entry(mockForfeitPulledOut, [
    { profile: PROFILE.anghelo, side: 'a', spot: true, checkedIn: false },
    { profile: PROFILE.awaySpot, side: 'b', spot: true, checkedIn: false },
    { profile: PROFILE.awaySub, side: 'b', spot: false, checkedIn: false },
  ]),
  // Home FC didn't show: Sami's side forfeited.
  entry(mockForfeitNoShow, [
    { profile: PROFILE.sami, side: 'a', spot: true, checkedIn: false },
    { profile: PROFILE.awayCaptain, side: 'b', spot: false, checkedIn: true },
  ]),
  // Settled but not confirmed: never in form.
  entry(mockDisputed, [viewerCheckedIn]),
  entry(mockNoResult, [viewerCheckedIn]),
  // Two older matches, so the viewer has six confirmed matches and form shows five.
  entry(item('m-older', 'named', 'confirmed', '2026-10-17T16:00:00.000Z', { status: 'confirmed', score: [1, 0] }), [
    viewerCheckedIn,
  ]),
  entry(item('m-oldest', 'named', 'confirmed', '2026-10-10T16:00:00.000Z', { status: 'confirmed', score: [0, 1] }), [
    viewerCheckedIn,
  ]),
];
