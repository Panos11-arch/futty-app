// The post-match flow (A10; docs/specs/match-record.md decision 1j): after a
// game, an optional walk through the score, goals and assists, the man of
// the match vote and ratings, in that order. It stores nothing of its own and
// uses only the match record's existing windows; every write still goes
// through the match page's functions, which check it all again.
//
// A step whose window has closed, or that this player has already done, is
// left out. Goals, the vote and ratings open only once the result is
// confirmed: before then they show as "not open yet" to the players who will
// be able to do them.
import { ratingsView, type MatchRatings } from '@/lib/match/levels';
import { motmView, playedMatch, scorersOpen, sideOf, writerSides, type MatchPage, type RosterPlayer } from '@/lib/match/page';
import { resultState, type ResultMatch } from '@/lib/match/result';

export const POST_MATCH_INTRO =
  "Add the result and your stats. You'll see them at the end of the week, and they put you in the running for team of the week.";
export const WAITING_FOR_CAPTAIN = 'Waiting for your captain';
export const NOT_OPEN_YET = 'This opens once the result is confirmed.';

export type PostMatchStepName = 'score' | 'goals' | 'motm' | 'ratings';

export type PostMatchStep = {
  step: PostMatchStepName;
  /** act: the player can do it now; waiting: a captain enters the score; not_open: opens once the result is confirmed. */
  state: 'act' | 'waiting' | 'not_open';
};

export type PostMatchInput = {
  match: ResultMatch;
  /** get_match_page; null when it hasn't loaded. */
  page: MatchPage | null;
  /** The squad with check-ins; null when it hasn't loaded. */
  roster: RosterPlayer[] | null;
  /** get_match_ratings; null before the match is confirmed. */
  ratings: MatchRatings | null;
  viewerId: string | null;
  captainTeamIds: Set<string>;
};

const time = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

/** The result can still be entered or answered, so it may yet be confirmed ("exactly at the deadline" is past it). */
function resultPending(m: ResultMatch, now: number): boolean {
  return (m.match.status === 'scheduled' || m.match.status === 'played') && now < time(m.match.result_deadline_at);
}

/** Checked in and still in the match: who can vote and rate (decision 1b.2). */
function checkedIn(roster: RosterPlayer[] | null, viewerId: string): boolean {
  return roster?.some((p) => p.profileId === viewerId && p.leftAt === null && p.checkedIn) ?? false;
}

function scoreStep(input: PostMatchInput, viewerId: string, now: number): PostMatchStep['state'] | null {
  const state = resultState(input.match, viewerId, input.captainTeamIds, now);
  if (state.kind === 'enter_score' || state.kind === 'answer_score') return 'act';
  if (state.kind === 'waiting_for_score') return 'waiting';
  return null;
}

function goalsStep(input: PostMatchInput, viewerId: string, now: number, pending: boolean): PostMatchStep['state'] | null {
  const writable = writerSides(input.match, viewerId, input.captainTeamIds);
  if (writable.length === 0) return null;
  if (pending) return 'not_open';
  const { page } = input;
  if (!page || !scorersOpen(page, now)) return null;
  // Done once every side they write has a scorer choice for each goal (0–0 has nothing to add).
  const missing = writable.some((side) => {
    const score = sideOf(page, side).score ?? 0;
    return page.goals.filter((g) => g.side === side).length < score;
  });
  return missing ? 'act' : null;
}

function motmStep(input: PostMatchInput, viewerId: string, now: number, pending: boolean): PostMatchStep['state'] | null {
  if (pending) return checkedIn(input.roster, viewerId) ? 'not_open' : null;
  if (!input.page || !input.roster) return null;
  const view = motmView(input.page, input.roster, viewerId, now);
  return view.kind === 'vote' && view.nominees.length > 0 ? 'act' : null;
}

function ratingsStep(input: PostMatchInput, viewerId: string, now: number, pending: boolean): PostMatchStep['state'] | null {
  if (pending) return checkedIn(input.roster, viewerId) ? 'not_open' : null;
  const { ratings, page } = input;
  if (!ratings || !input.roster || (page && !playedMatch(page))) return null;
  if (now >= time(ratings.ratingsCloseAt)) return null;
  const view = ratingsView(ratings, input.roster, viewerId);
  return view.kind === 'rate' && view.players.some((p) => !p.rated) ? 'act' : null;
}

/** The steps to show, in order; closed and done ones are left out. */
export function postMatchSteps(input: PostMatchInput, now: number = Date.now()): PostMatchStep[] {
  const { viewerId } = input;
  if (!viewerId || input.match.match.status === 'void') return [];
  const pending = resultPending(input.match, now);
  const steps: PostMatchStep[] = [];
  const add = (step: PostMatchStepName, state: PostMatchStep['state'] | null) => {
    if (state) steps.push({ step, state });
  };
  add('score', scoreStep(input, viewerId, now));
  add('goals', goalsStep(input, viewerId, now, pending));
  add('motm', motmStep(input, viewerId, now, pending));
  add('ratings', ratingsStep(input, viewerId, now, pending));
  return steps;
}
