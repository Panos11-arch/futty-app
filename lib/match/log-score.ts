// Logging after the game (S13B; docs/specs/match-record.md decision 1l,
// images 07–11): Score → Goals → Assists → Review, by a captain only. These
// rules decide what the screens show and when Continue works; the server
// (log_match_result, set_match_stats) checks every one of them again and
// decides who may log which side.
//
// No positions: a player is a circle on his side's half, whoever he is.
import type { AvatarKit } from '@/lib/avatar';
import { avatarKit } from '@/lib/avatar';
import type { MatchKind, MatchStatus, Side } from '@/lib/match/types';

export type LogStep = 'score' | 'goals' | 'assists' | 'review';

export const LOG_STEPS: readonly LogStep[] = ['score', 'goals', 'assists', 'review'];

/** The progress bar's fill on each step (decided 22 November). */
export const STEP_PROGRESS: Record<LogStep, number> = { score: 0, goals: 33, assists: 66, review: 100 };

export const STEP_TITLES: Record<LogStep, string> = {
  score: 'Score',
  goals: 'Goals',
  assists: 'Assists',
  review: 'Review',
};

export const LOCKED_LINE = 'Logged by their captain';

export type Score = { a: number; b: number };

export type MatchLogPlayer = {
  playerId: string;
  profileId: string | null;
  name: string | null;
  guestName: string | null;
  side: Side;
  avatarStyle: string | null;
  avatarKitColour: string | null;
  avatarNumber: number | null;
};

export type SideStats = { players: { playerId: string; goals: number; assists: number }[]; ownGoals: number };

/** get_match_log. */
export type MatchLog = {
  matchId: string;
  status: MatchStatus;
  kind: MatchKind;
  kickoffAt: string;
  kickoffLocal: string;
  venueName: string | null;
  pitchName: string | null;
  sides: { side: Side; label: string; teamId: string | null }[];
  /** The sides the caller writes: both in a pickup he booked, his own in a named game, none for a player. */
  writableSides: Side[];
  canLog: boolean;
  canCorrect: boolean;
  correctionsUntil: string | null;
  /** The confirmed score. */
  score: Score | null;
  myEntry: Score | null;
  /** The other captain's score, only once the caller logged his own. */
  theirEntry: Score | null;
  tries: number;
  maxTries: number;
  players: MatchLogPlayer[];
  stats: Partial<Record<Side, SideStats>>;
};

/** goals and assists per player (match_players id), for one side. */
export type Tally = Record<string, number>;

export type Draft = {
  score: Score;
  goals: Record<Side, Tally>;
  assists: Record<Side, Tally>;
  ownGoals: Record<Side, number>;
};

export const SIDES: readonly Side[] = ['a', 'b'];

export const otherSide = (side: Side): Side => (side === 'a' ? 'b' : 'a');

export function sideLabel(log: Pick<MatchLog, 'sides'>, side: Side): string {
  return log.sides.find((s) => s.side === side)?.label ?? (side === 'a' ? 'Bibs' : 'Non-bibs');
}

export function playerName(p: Pick<MatchLogPlayer, 'name' | 'guestName'>): string {
  return p.name ?? p.guestName ?? 'Player';
}

export function playerKit(p: MatchLogPlayer): AvatarKit | null {
  return avatarKit({ avatar_style: p.avatarStyle, avatar_kit_colour: p.avatarKitColour, avatar_number: p.avatarNumber });
}

export function sidePlayers(log: Pick<MatchLog, 'players'>, side: Side): MatchLogPlayer[] {
  return log.players.filter((p) => p.side === side);
}

/** One captain writes both sides (a pickup he booked): his Confirm is final. */
export const singleCaptain = (log: Pick<MatchLog, 'writableSides'>) => log.writableSides.length === 2;

/** The draft the screens start from: the confirmed score, or the caller's last score, with the stats logged so far. */
export function draftFrom(log: MatchLog): Draft {
  const score = log.score ?? log.myEntry ?? { a: 0, b: 0 };
  const draft: Draft = { score: { ...score }, goals: { a: {}, b: {} }, assists: { a: {}, b: {} }, ownGoals: { a: 0, b: 0 } };
  for (const side of SIDES) {
    const stats = log.stats[side];
    if (!stats) continue;
    draft.ownGoals[side] = stats.ownGoals;
    for (const p of stats.players) {
      if (p.goals > 0) draft.goals[side][p.playerId] = p.goals;
      if (p.assists > 0) draft.assists[side][p.playerId] = p.assists;
    }
  }
  return draft;
}

const sum = (tally: Tally) => Object.values(tally).reduce((total, n) => total + n, 0);

/** A side's goals as logged, own goals included. */
export const goalsLogged = (draft: Draft, side: Side) => sum(draft.goals[side]) + draft.ownGoals[side];

export const assistsLogged = (draft: Draft, side: Side) => sum(draft.assists[side]);

/** Continue on Goals: every side the caller logs adds up exactly to its score. */
export function goalsComplete(draft: Draft, sides: readonly Side[]): boolean {
  return sides.every((side) => goalsLogged(draft, side) === draft.score[side]);
}

/** Assists are optional, never more than the side's goals. */
export function assistsValid(draft: Draft, sides: readonly Side[]): boolean {
  return sides.every((side) => assistsLogged(draft, side) <= draft.score[side]);
}

export function setScore(draft: Draft, side: Side, value: number): Draft {
  return { ...draft, score: { ...draft.score, [side]: Math.max(0, Math.floor(value)) } };
}

function bump(tally: Tally, playerId: string, delta: number): Tally {
  const next = { ...tally };
  const value = Math.max(0, (next[playerId] ?? 0) + delta);
  if (value === 0) delete next[playerId];
  else next[playerId] = value;
  return next;
}

/** + adds a goal only while the side has goals left to log; − never below 0. */
export function changeGoals(draft: Draft, side: Side, playerId: string, delta: 1 | -1): Draft {
  if (delta > 0 && goalsLogged(draft, side) >= draft.score[side]) return draft;
  return { ...draft, goals: { ...draft.goals, [side]: bump(draft.goals[side], playerId, delta) } };
}

export function changeOwnGoals(draft: Draft, side: Side, delta: 1 | -1): Draft {
  if (delta > 0 && goalsLogged(draft, side) >= draft.score[side]) return draft;
  return { ...draft, ownGoals: { ...draft.ownGoals, [side]: Math.max(0, draft.ownGoals[side] + delta) } };
}

export function changeAssists(draft: Draft, side: Side, playerId: string, delta: 1 | -1): Draft {
  if (delta > 0 && assistsLogged(draft, side) >= draft.score[side]) return draft;
  return { ...draft, assists: { ...draft.assists, [side]: bump(draft.assists[side], playerId, delta) } };
}

/**
 * Whether the caller must log his sides' goals and assists in this pass.
 * Always the first time, and in a correction. After a mismatch, only when
 * his own side's score changed: changing only the other side's keeps them.
 */
export function needsStats(log: MatchLog, draft: Draft): boolean {
  if (log.canCorrect || singleCaptain(log) || !log.myEntry) return true;
  const own = log.writableSides[0];
  return own !== undefined && draft.score[own] !== log.myEntry[own];
}

/** The steps of this pass, in order. */
export function stepsFor(log: MatchLog, draft: Draft): LogStep[] {
  if (log.canCorrect) return ['goals', 'assists', 'review'];
  return needsStats(log, draft) ? ['score', 'goals', 'assists', 'review'] : ['score', 'review'];
}

/** What log_match_result and set_match_stats take for the caller's sides. */
export function toStatsPayload(draft: Draft, sides: readonly Side[]): Partial<Record<Side, SideStats>> {
  const payload: Partial<Record<Side, SideStats>> = {};
  for (const side of sides) {
    const ids = new Set([...Object.keys(draft.goals[side]), ...Object.keys(draft.assists[side])]);
    payload[side] = {
      players: [...ids].sort().map((playerId) => ({
        playerId,
        goals: draft.goals[side][playerId] ?? 0,
        assists: draft.assists[side][playerId] ?? 0,
      })),
      ownGoals: draft.ownGoals[side],
    };
  }
  return payload;
}

export type ReviewLine = { name: string; count: number };

export type ReviewSide = {
  side: Side;
  label: string;
  /** False for a side the caller doesn't log: its score only. */
  logged: boolean;
  goals: ReviewLine[];
  goalsTotal: number;
  assists: ReviewLine[];
  assistsTotal: number;
};

const OWN_GOAL = 'Own goal';

function lines(log: MatchLog, tally: Tally): ReviewLine[] {
  return log.players
    .filter((p) => (tally[p.playerId] ?? 0) > 0)
    .map((p) => ({ name: playerName(p), count: tally[p.playerId] }))
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
}

/** The review: each scorer with their goals, each assister with their assists. Text only. */
export function reviewSides(log: MatchLog, draft: Draft): ReviewSide[] {
  return SIDES.map((side) => {
    const logged = log.writableSides.includes(side);
    const goals = logged ? lines(log, draft.goals[side]) : [];
    if (logged && draft.ownGoals[side] > 0) goals.push({ name: OWN_GOAL, count: draft.ownGoals[side] });
    return {
      side,
      label: sideLabel(log, side),
      logged,
      goals,
      goalsTotal: logged ? goalsLogged(draft, side) : 0,
      assists: logged ? lines(log, draft.assists[side]) : [],
      assistsTotal: logged ? assistsLogged(draft, side) : 0,
    };
  });
}

/** Which side won the draft's score, or null for a draw. */
export function winner(score: Score): Side | null {
  if (score.a === score.b) return null;
  return score.a > score.b ? 'a' : 'b';
}

export const sameScore = (x: Score | null, y: Score | null) => x !== null && y !== null && x.a === y.a && x.b === y.b;

/** Two captains logged different scores: the caller can change his (decided 22 November). */
export const scoresDiffer = (log: Pick<MatchLog, 'myEntry' | 'theirEntry'>) =>
  log.myEntry !== null && log.theirEntry !== null && !sameScore(log.myEntry, log.theirEntry);

/** He logged; the other captain hasn't yet. */
export const waitingForOther = (log: MatchLog) =>
  log.canLog && !singleCaptain(log) && log.myEntry !== null && log.theirEntry === null;

/** Tries left before the match is disputed. */
export const triesLeft = (log: Pick<MatchLog, 'tries' | 'maxTries'>) => Math.max(0, log.maxTries - log.tries);

/**
 * Where a side's players stand on the pitch, by row: one in front of the
 * goal, the rest two by two. Only a picture: no positions are logged.
 */
export function pitchRows<T>(players: T[]): T[][] {
  if (players.length === 0) return [];
  const [first, ...rest] = players;
  const rows: T[][] = [];
  for (let i = 0; i < rest.length; i += 2) rows.push(rest.slice(i, i + 2));
  return [[first], ...rows];
}

/** "3 of 4": the side's goals logged out of its score. */
export const goalsCounter = (draft: Draft, side: Side) => `${goalsLogged(draft, side)} of ${draft.score[side]}`;

/** "2 of up to 3 · optional". */
export const assistsCounter = (draft: Draft, side: Side) =>
  `${assistsLogged(draft, side)} of up to ${draft.score[side]} · optional`;
