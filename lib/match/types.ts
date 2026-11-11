// The match record as the app sees it (docs/specs/match-record.md sections 4
// and 6.2). Field names and value sets mirror the database exactly, so mock
// data and real rows are interchangeable. timestamptz columns arrive as ISO
// strings; `timestamp` columns (kickoff_local, ends_local) as wall-clock
// strings in Cyprus time.

export type Side = 'a' | 'b';
export type MatchKind = 'pickup' | 'named';
export type MatchStatus = 'scheduled' | 'played' | 'confirmed' | 'disputed' | 'no_result' | 'void';
export type ResultStatus = 'confirmed' | 'disputed' | 'no_result';
export type Outcome = 'side_a_won' | 'side_b_won' | 'draw';
export type ConfirmedVia = 'agreed' | 'deadline' | 'forfeit';
export type ForfeitReason = 'pulled_out' | 'no_show';

/** `public.matches` (4.1). */
export type MatchRecord = {
  id: string;
  booking_id: string | null;
  venue_id: string | null;
  friendly_match_id: string | null;
  league_fixture_id: string | null;
  kind: MatchKind;
  format: string;
  players_per_side: number;
  kickoff_at: string;
  ends_at: string;
  status: MatchStatus;
  result_deadline_at: string;
  side_a_score: number | null;
  side_b_score: number | null;
  forfeit_side: Side | null;
  forfeit_reason: ForfeitReason | null;
  confirmed_at: string | null;
  confirmed_via: ConfirmedVia | null;
  created_at: string;
  updated_at: string;
};

/** `public.match_sides` (4.2). The booker's side is always a. */
export type MatchSideRecord = {
  match_id: string;
  side: Side;
  team_id: string | null;
  /** The team name, or Bibs / Non-bibs in a pickup game. */
  label: string;
  captain_profile_id: string | null;
};

/** `public.match_players` (4.3): the squad, not who played (decision 1b.2). */
export type MatchPlayerRecord = {
  id: string;
  match_id: string;
  profile_id: string | null;
  guest_name: string | null;
  side: Side | null;
  position: string | null;
  /** Set when the player holds a spot in the booking. */
  share_id: string | null;
  left_at: string | null;
  created_at: string;
};

/** `public.match_attendance` (4.4): who actually checked in. */
export type MatchAttendanceRecord = {
  match_id: string;
  profile_id: string;
  checked_in_at: string;
  method: 'qr' | 'captain';
  checked_in_by: string;
};

/** `public.match_result_confirmed` (6.2), every column in order. One row per settled match. */
export type MatchResultConfirmed = {
  match_id: string;
  booking_id: string | null;
  venue_id: string | null;
  friendly_match_id: string | null;
  league_fixture_id: string | null;
  side_a_team_id: string | null;
  side_b_team_id: string | null;
  /** Null for a forfeit, disputed and no_result. */
  side_a_score: number | null;
  side_b_score: number | null;
  /** Null unless confirmed. A forfeit gives the other side the win. */
  outcome: Outcome | null;
  result_status: ResultStatus;
  disputed: boolean;
  confirmed_via: ConfirmedVia | null;
  forfeit_side: Side | null;
  forfeit_reason: ForfeitReason | null;
  kickoff_at: string;
  ends_at: string;
  /** Cyprus wall-clock time, e.g. "2026-11-14T19:00:00". */
  kickoff_local: string;
  ends_local: string;
  settled_at: string;
};

/** One match as a list shows it: the match, both sides, and the result once settled. */
export type MatchListItem = {
  match: Pick<MatchRecord, 'id' | 'kind' | 'status' | 'kickoff_at' | 'ends_at'>;
  sides: { a: MatchSideRecord; b: MatchSideRecord };
  /** The view row; null while scheduled or played, and for a cancelled (void) match. */
  result: MatchResultConfirmed | null;
  venueName: string;
  /** The signed-in player's side for their result chip, when it counts for them (decisions 1b.2 and 1b.3). */
  viewerSide: Side | null;
};

/** A match with its squad and check-ins, for form. */
export type MatchFormEntry = {
  result: MatchResultConfirmed;
  sides: { a: MatchSideRecord; b: MatchSideRecord };
  players: MatchPlayerRecord[];
  attendance: MatchAttendanceRecord[];
};

export type FormResult = 'W' | 'D' | 'L' | 'L_forfeit';
