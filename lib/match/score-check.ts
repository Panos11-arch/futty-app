// "Check the score" (levels like Playtomic, decided by Panos 25 November;
// docs/specs/match-record.md decision 1l item 11). In a Competitive pickup
// the players who played on the side the booker isn't on accept or reject
// his score; the server decides who can answer (canAnswer) and when the
// 24 hours end (checkUntil). The app only shows what it returns.

export type ScoreCheckState = 'pending' | 'accepted' | 'rejected';

/** get_match_page's scoreCheck: null when the match has no card. */
export type MatchScoreCheck = {
  state: ScoreCheckState;
  canAnswer: boolean;
  checkUntil: string;
};

/** One card on Home (get_my_scores_to_check). */
export type ScoreToCheck = {
  matchId: string;
  kickoffAt: string;
  labelA: string;
  labelB: string;
  sideAScore: number;
  sideBScore: number;
  checkUntil: string;
};

/** The card shows only while it is open and the viewer may answer it. */
export function showScoreCheck(check: MatchScoreCheck | null | undefined, now: number): boolean {
  return !!check && check.state === 'pending' && check.canAnswer && now < Date.parse(check.checkUntil);
}

const HOUR = 60 * 60 * 1000;

/** "5 hours left. No answer counts as accepted." */
export function checkCountdown(checkUntil: string, now: number): string {
  const ms = Date.parse(checkUntil) - now;
  const hours = Math.ceil(ms / HOUR);
  const left = ms < HOUR ? 'Less than an hour' : hours === 1 ? '1 hour' : `${hours} hours`;
  return `${left} left. No answer counts as accepted.`;
}

/** "Bibs 2–1 Non-bibs". */
export function scoreCheckLine(s: Pick<ScoreToCheck, 'labelA' | 'labelB' | 'sideAScore' | 'sideBScore'>): string {
  return `${s.labelA} ${s.sideAScore}–${s.sideBScore} ${s.labelB}`;
}
