// The match page (docs/specs/match-record.md sections 1e, 4.6, 4.7, 4.9 and
// 5.3; 05-product sections 3 and 5). get_match_page decides what anyone may
// see; these rules only decide which controls the app shows. set_match_stats,
// cast_motm_vote and set_match_lineup check every one of them again.
import type { MatchScoreCheck } from '@/lib/match/score-check';
import type { MatchKind, MatchSideRecord, MatchStatus, Side } from '@/lib/match/types';
import type { AvatarLook } from '@/lib/avatar';

/** A player as get_match_page returns one. */
export type MatchPagePlayer = {
  playerId: string;
  profileId: string | null;
  name: string | null;
  guestName: string | null;
};

export type MatchPageGoal = { side: Side; scorer: MatchPagePlayer | null; assist: MatchPagePlayer | null };

/** S13B: a player's assists in the match (a tally, not paired with a goal). */
export type MatchPageAssist = MatchPagePlayer & { side: Side; assists: number };

/** S13B: a player's match rating (from stats; one decimal), best first. */
export type MatchPageRating = MatchPagePlayer & { side: Side; rating: number };

export type MatchPageLineup = {
  side: Side;
  formation: string;
  /** Filled positions only, in formation order; empty ones are left out. */
  positions: (MatchPagePlayer & { key: string })[];
};

/** get_match_page (section 5.3). */
export type MatchPage = {
  matchId: string;
  status: MatchStatus;
  kind: MatchKind;
  format: string | null;
  playersPerSide: number;
  kickoffAt: string;
  /** Cyprus wall-clock time, e.g. "2026-11-14T19:00:00". */
  kickoffLocal: string;
  endsAt: string;
  venue: { id: string; name: string } | null;
  /** score is null unless confirmed by a result (not a forfeit). */
  sides: { side: Side; label: string; teamId: string | null; score: number | null }[];
  forfeit: { side: Side; reason: 'pulled_out' | 'no_show' } | null;
  confirmedAt: string | null;
  scorersOpenUntil: string | null;
  motmVotingClosesAt: string | null;
  motmOpen: boolean;
  goals: MatchPageGoal[];
  /** S13B: assists per player; older matches keep theirs on their goals. */
  assists: MatchPageAssist[];
  /** S13B: every rated player (checked in), once the result is confirmed. */
  ratings: MatchPageRating[];
  /** Every tied leader, once voting has closed; empty before. */
  motm: (MatchPagePlayer & { votes: number })[];
  /** The caller's own nominee (a match_players id). */
  myVote: string | null;
  lineups: MatchPageLineup[];
  /** Levels like Playtomic: a pickup's "Check the score" card; null when the match has none. */
  scoreCheck?: MatchScoreCheck | null;
};

/** One squad row as the editors need it (members only, read under RLS). */
export type RosterPlayer = {
  id: string;
  side: Side | null;
  profileId: string | null;
  guestName: string | null;
  name: string;
  leftAt: string | null;
  checkedIn: boolean;
  /** A12: the player's kit avatar from get_public_profiles; guests have none. */
  kit?: AvatarLook | null;
};

export const OWN_GOAL_OR_UNKNOWN = 'Own goal';

const time = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

/** Confirmed by a result, not a forfeit: it has a score, goals and a vote. */
export const playedMatch = (page: Pick<MatchPage, 'status' | 'forfeit'>) =>
  page.status === 'confirmed' && page.forfeit === null;

export function sideOf(page: Pick<MatchPage, 'sides'>, side: Side) {
  return page.sides.find((s) => s.side === side) ?? { side, label: side === 'a' ? 'Bibs' : 'Non-bibs', teamId: null, score: null };
}

/**
 * Mirrors match_side_writer: in a pickup the booker (side a's captain)
 * writes both sides (decision 1e.1); in a named game a side's captain, or a
 * captain of its team, writes that side.
 */
export function writerSides(
  m: { match: { kind: MatchKind }; sides: { a: MatchSideRecord; b: MatchSideRecord } },
  viewerId: string | null,
  captainTeamIds: Set<string>
): Side[] {
  if (!viewerId) return [];
  if (m.match.kind === 'pickup') return m.sides.a.captain_profile_id === viewerId ? ['a', 'b'] : [];
  return (['a', 'b'] as const).filter((side) => {
    const s = m.sides[side];
    return s.captain_profile_id === viewerId || (s.team_id !== null && captainTeamIds.has(s.team_id));
  });
}

/** Scorers can be entered: a played match, before scorersOpenUntil ("exactly at" counts as past). */
export function scorersOpen(page: MatchPage, now: number): boolean {
  return playedMatch(page) && now < time(page.scorersOpenUntil);
}

/** Save is enabled only when the goals add up to the side's score and each has a scorer choice. */
export function goalsReady(goals: { scorer: string | null | undefined }[], score: number | null): boolean {
  return score !== null && goals.length === score && goals.every((g) => g.scorer !== undefined);
}

export type Tallied = { key: string; player: MatchPagePlayer | null; count: number };

/** A side's scorers by goals (own goals last), and its assisters by assists (tallies, plus older paired assists). */
export function sideTallies(page: Pick<MatchPage, 'goals' | 'assists'>, side: Side): { goals: Tallied[]; assists: Tallied[] } {
  const goals = new Map<string, Tallied>();
  const assists = new Map<string, Tallied>();
  const add = (into: Map<string, Tallied>, player: MatchPagePlayer | null, n: number) => {
    const key = player?.playerId ?? 'own';
    const row = into.get(key) ?? { key, player, count: 0 };
    row.count += n;
    into.set(key, row);
  };
  for (const g of page.goals.filter((x) => x.side === side)) {
    add(goals, g.scorer, 1);
    if (g.assist) add(assists, g.assist, 1);
  }
  for (const a of page.assists.filter((x) => x.side === side)) add(assists, a, a.assists);
  const order = (x: Tallied, y: Tallied) =>
    Number(x.player === null) - Number(y.player === null) || y.count - x.count || playerName(x.player).localeCompare(playerName(y.player));
  return { goals: [...goals.values()].sort(order), assists: [...assists.values()].sort(order) };
}

export function playerName(p: Pick<MatchPagePlayer, 'name' | 'guestName'> | null): string {
  if (!p) return OWN_GOAL_OR_UNKNOWN;
  return p.name ?? p.guestName ?? 'Player';
}

/** Players on that side who haven't left; guests included, players with no side never. */
export function sidePlayers(roster: RosterPlayer[], side: Side): RosterPlayer[] {
  return roster.filter((p) => p.side === side && p.leftAt === null);
}

export type MotmView =
  /** Forfeit, disputed, not yet confirmed: no vote at all. */
  | { kind: 'none' }
  | { kind: 'vote'; nominees: RosterPlayer[]; closesAt: string }
  | { kind: 'voted'; name: string | null; closesAt: string }
  /** Open, but the viewer can't vote (not checked in, or not in the match). */
  | { kind: 'open'; closesAt: string }
  | { kind: 'closed'; winners: MatchPage['motm'] };

export function motmView(page: MatchPage, roster: RosterPlayer[] | null, viewerId: string | null, now: number): MotmView {
  if (!playedMatch(page) || !page.motmVotingClosesAt) return { kind: 'none' };
  const closesAt = page.motmVotingClosesAt;
  if (now >= time(closesAt)) return { kind: 'closed', winners: page.motm };
  if (page.myVote) {
    const nominee = roster?.find((p) => p.id === page.myVote);
    return { kind: 'voted', name: nominee ? nominee.name : null, closesAt };
  }
  const me = roster?.find((p) => p.profileId === viewerId && p.leftAt === null);
  if (!roster || !viewerId || !me?.checkedIn) return { kind: 'open', closesAt };
  const nominees = roster.filter(
    (p) => p.checkedIn && p.leftAt === null && p.profileId !== null && p.guestName === null && p.profileId !== viewerId
  );
  return { kind: 'vote', nominees, closesAt };
}

/** Lineups can be changed: scheduled and before kickoff. */
export function lineupEditable(page: Pick<MatchPage, 'status' | 'kickoffAt'>, now: number): boolean {
  return page.status === 'scheduled' && now < time(page.kickoffAt);
}

/**
 * Mirrors match_formation_positions: gk, then d1.. for the first line, f1..
 * for the last, m1.. for every line between ("4-2-3-1": gk, d1-d4, m1-m5, f1).
 */
export function formationPositions(formation: string): string[] {
  const lines = formation.split('-').map(Number);
  const keys = ['gk'];
  const count = { d: 0, m: 0, f: 0 };
  lines.forEach((n, i) => {
    const kind = i === 0 ? 'd' : i === lines.length - 1 ? 'f' : 'm';
    for (let j = 0; j < n; j++) keys.push(`${kind}${++count[kind]}`);
  });
  return keys;
}

const POSITION_WORDS: Record<string, string> = { d: 'Defender', m: 'Midfielder', f: 'Forward' };

/** "Goalkeeper", "Defender 2". */
export function positionLabel(key: string): string {
  if (key === 'gk') return 'Goalkeeper';
  return `${POSITION_WORDS[key[0]] ?? 'Position'} ${key.slice(1)}`;
}

export type PitchSpot = { key: string; x: number; y: number };

/** Where each position sits on the pitch, 0–1 from the left and top: the keeper at the bottom, lines back to front. */
export function pitchLayout(formation: string): PitchSpot[] {
  const lines = formation.split('-').map(Number);
  const keys = formationPositions(formation);
  const spots: PitchSpot[] = [{ key: 'gk', x: 0.5, y: 0.9 }];
  let k = 1;
  lines.forEach((n, i) => {
    // Lines spread from 0.72 (back) to 0.14 (front).
    const y = lines.length === 1 ? 0.45 : 0.72 - (i * 0.58) / (lines.length - 1);
    for (let j = 0; j < n; j++) spots.push({ key: keys[k++], x: (j + 1) / (n + 1), y });
  });
  return spots;
}

/** position key → match_players id, or null for an empty position. */
export type LineupDraft = Record<string, string | null>;

/** Every position of the formation, filled from a saved lineup where the key still exists. */
export function lineupDraft(formation: string, filled: Record<string, string | null> = {}): LineupDraft {
  const draft: LineupDraft = {};
  for (const key of formationPositions(formation)) draft[key] = filled[key] ?? null;
  return draft;
}

/** Puts the player in `key`, taking them out of any other position. */
export function placePlayer(draft: LineupDraft, key: string, playerId: string): LineupDraft {
  const next: LineupDraft = {};
  for (const [k, v] of Object.entries(draft)) next[k] = v === playerId ? null : v;
  next[key] = playerId;
  return next;
}

export function clearPosition(draft: LineupDraft, key: string): LineupDraft {
  return { ...draft, [key]: null };
}

/** The saved lineup for a side as a draft, or null when none is saved. */
export function savedLineup(page: MatchPage, side: Side): { formation: string; draft: LineupDraft } | null {
  const lineup = page.lineups.find((l) => l.side === side);
  if (!lineup) return null;
  const filled: Record<string, string> = {};
  for (const p of lineup.positions) filled[p.key] = p.playerId;
  return { formation: lineup.formation, draft: lineupDraft(lineup.formation, filled) };
}
