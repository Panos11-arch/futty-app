// Entering and answering a match result (docs/specs/match-record.md
// sections 3 and 5.2, decisions 2, 3 and 1a.5). These rules only decide
// which buttons and words the app shows; submit_match_result and
// respond_to_match_result check every one of them again on the server.
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import type {
  MatchListItem,
  MatchPlayerRecord,
  MatchRecord,
  MatchResultConfirmed,
  MatchResultSubmission,
  MatchSideRecord,
  Side,
} from '@/lib/match/types';

/** One match as the result screen needs it. */
export type ResultMatch = {
  match: MatchRecord;
  sides: { a: MatchSideRecord; b: MatchSideRecord };
  submission: MatchResultSubmission | null;
  /** The viewer's own player row, if they are in the squad. */
  myPlayer: Pick<MatchPlayerRecord, 'id' | 'side'> | null;
  venueName: string | null;
};

export type ViewerRole = {
  /** The side the viewer captains (match_captain_side), or null. */
  captainSide: Side | null;
  /** The side the viewer plays on, or null. */
  playerSide: Side | null;
  canSubmit: boolean;
  canRespond: boolean;
};

const OPEN_STATUSES = new Set(['scheduled', 'played']);

export const otherSide = (side: Side): Side => (side === 'a' ? 'b' : 'a');

/** Mirrors match_captain_side: the side's captain (the booker on side a), or
 *  a captain of a named side's team. Side a first. */
export function captainSideOf(m: ResultMatch, viewerId: string | null, captainTeamIds: Set<string>): Side | null {
  if (!viewerId) return null;
  for (const side of ['a', 'b'] as const) {
    const s = m.sides[side];
    if (s.captain_profile_id === viewerId || (s.team_id !== null && captainTeamIds.has(s.team_id))) return side;
  }
  return null;
}

/** Who the viewer is in this match, ignoring the clock. */
export function viewerRole(m: ResultMatch, viewerId: string | null, captainTeamIds: Set<string>): ViewerRole {
  const captainSide = captainSideOf(m, viewerId, captainTeamIds);
  const playerSide = m.myPlayer?.side ?? null;
  const open = OPEN_STATUSES.has(m.match.status);
  const pending = m.submission !== null && m.submission.response === null;
  const answeringSide = m.submission ? otherSide(m.submission.side) : null;
  // Named game: the other side's captain. Pickup: any player on the other side.
  const answerAs = m.match.kind === 'named' ? captainSide : playerSide;

  return {
    captainSide,
    playerSide,
    canSubmit: open && captainSide !== null && m.submission === null,
    canRespond: open && pending && answerAs !== null && answerAs === answeringSide,
  };
}

export type ResultState =
  | { kind: 'not_started' }
  | { kind: 'enter_score' }
  | { kind: 'waiting_for_score' }
  | { kind: 'answer_score'; submission: MatchResultSubmission }
  | { kind: 'no_side'; submission: MatchResultSubmission }
  | { kind: 'waiting_for_answer'; submission: MatchResultSubmission; answeringSide: Side }
  /** Past the deadline; the 15-minute job hasn't settled it yet. */
  | { kind: 'window_closed' }
  | { kind: 'confirmed' }
  | { kind: 'disputed' }
  | { kind: 'no_result' }
  | { kind: 'cancelled' };

/** What the viewer sees and can do now. "Exactly at the deadline" is past it (section 2). */
export function resultState(
  m: ResultMatch,
  viewerId: string | null,
  captainTeamIds: Set<string>,
  now: number = Date.now()
): ResultState {
  switch (m.match.status) {
    case 'confirmed':
      return { kind: 'confirmed' };
    case 'disputed':
      return { kind: 'disputed' };
    case 'no_result':
      return { kind: 'no_result' };
    case 'void':
      return { kind: 'cancelled' };
    case 'scheduled':
    case 'played':
      break;
  }

  if (now < Date.parse(m.match.kickoff_at)) return { kind: 'not_started' };
  if (now >= Date.parse(m.match.result_deadline_at)) return { kind: 'window_closed' };

  const role = viewerRole(m, viewerId, captainTeamIds);
  const submission = m.submission;
  if (!submission) return role.canSubmit ? { kind: 'enter_score' } : { kind: 'waiting_for_score' };
  if (role.canRespond) return { kind: 'answer_score', submission };
  if (m.match.kind === 'pickup' && role.captainSide === null && role.playerSide === null) {
    return { kind: 'no_side', submission };
  }
  return { kind: 'waiting_for_answer', submission, answeringSide: otherSide(submission.side) };
}

const localFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** "2026-11-14T19:00:00": Cyprus wall-clock time, as the view's `*_local` columns. */
function cyprusLocal(iso: string): string {
  const p: Record<string, string> = {};
  for (const part of localFormat.formatToParts(new Date(iso))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** The match as a ScoreLine shows it. The result row mirrors what the
 *  match_result_confirmed view (6.2, service_role only) would hold, built
 *  from the matches columns the player can read. */
export function toListItem(m: ResultMatch, viewerSide: Side | null): MatchListItem {
  const { match } = m;
  let result: MatchResultConfirmed | null = null;

  if (match.status === 'confirmed' || match.status === 'disputed' || match.status === 'no_result') {
    let outcome: MatchResultConfirmed['outcome'] = null;
    if (match.status === 'confirmed') {
      if (match.forfeit_side) outcome = match.forfeit_side === 'a' ? 'side_b_won' : 'side_a_won';
      else if (match.side_a_score !== null && match.side_b_score !== null) {
        outcome =
          match.side_a_score > match.side_b_score
            ? 'side_a_won'
            : match.side_a_score < match.side_b_score
              ? 'side_b_won'
              : 'draw';
      }
    }
    result = {
      match_id: match.id,
      booking_id: match.booking_id,
      venue_id: match.venue_id,
      friendly_match_id: match.friendly_match_id,
      league_fixture_id: match.league_fixture_id,
      side_a_team_id: m.sides.a.team_id,
      side_b_team_id: m.sides.b.team_id,
      side_a_score: match.status === 'confirmed' ? match.side_a_score : null,
      side_b_score: match.status === 'confirmed' ? match.side_b_score : null,
      outcome,
      result_status: match.status,
      disputed: match.status === 'disputed',
      confirmed_via: match.status === 'confirmed' ? match.confirmed_via : null,
      forfeit_side: match.forfeit_side,
      forfeit_reason: match.forfeit_reason,
      kickoff_at: match.kickoff_at,
      ends_at: match.ends_at,
      kickoff_local: cyprusLocal(match.kickoff_at),
      ends_local: cyprusLocal(match.ends_at),
      settled_at: match.confirmed_at ?? match.updated_at,
    };
  }

  return {
    match: {
      id: match.id,
      kind: match.kind,
      status: match.status,
      kickoff_at: match.kickoff_at,
      ends_at: match.ends_at,
    },
    sides: m.sides,
    result,
    venueName: m.venueName ?? '',
    viewerSide,
  };
}

/** "Bibs 5–3 Non-bibs" */
export function submittedScoreLine(m: ResultMatch, s: Pick<MatchResultSubmission, 'side_a_score' | 'side_b_score'>) {
  return `${m.sides.a.label} ${s.side_a_score}–${s.side_b_score} ${m.sides.b.label}`;
}
