// Form from the match record (docs/specs/match-record.md section 7 and
// decisions 1b.2 and 1b.3). Only confirmed matches count; disputed and
// no_result never do.
//   Player form: a match counts for a player who checked in (a
//   match_attendance row) and hadn't left. In a confirmed forfeit, every
//   player holding a spot (share_id set, not left) on either side gets it too,
//   with or without a check-in.
//   Team form: every confirmed match the team played, whoever checked in.
//
// These helpers are the reference rules for tests and mocks only. The app
// reads form from the server views A3 builds (player_form, team_form), which
// must give the same results; it never computes form from raw rows.
import type { FormResult, MatchFormEntry, MatchResultConfirmed, Side } from '@/lib/match/types';

const FORM_LENGTH = 5;

/** W, D, L or L (forfeit) for one side of a confirmed match; null if it isn't confirmed. */
export function formResult(result: MatchResultConfirmed, side: Side): FormResult | null {
  if (result.result_status !== 'confirmed' || !result.outcome) return null;
  if (result.forfeit_side === side) return 'L_forfeit';
  if (result.outcome === 'draw') return 'D';
  const won = (result.outcome === 'side_a_won') === (side === 'a');
  return won ? 'W' : 'L';
}

/** The side a match counts on for this player's form, or null if it doesn't count for them. */
export function formSide(entry: MatchFormEntry, profileId: string): Side | null {
  const player = entry.players.find((p) => p.profile_id === profileId && p.left_at === null);
  if (!player?.side) return null;
  const checkedIn = entry.attendance.some((a) => a.profile_id === profileId);
  const forfeitSpot = entry.result.forfeit_side !== null && player.share_id !== null;
  return checkedIn || forfeitSpot ? player.side : null;
}

function newestFirst(entries: MatchFormEntry[]): MatchFormEntry[] {
  return [...entries].sort((x, y) => Date.parse(y.result.kickoff_at) - Date.parse(x.result.kickoff_at));
}

/** A player's last 5 results, newest first. */
export function playerForm(entries: MatchFormEntry[], profileId: string): FormResult[] {
  const form: FormResult[] = [];
  for (const entry of newestFirst(entries)) {
    const side = formSide(entry, profileId);
    const result = side ? formResult(entry.result, side) : null;
    if (result) form.push(result);
    if (form.length === FORM_LENGTH) break;
  }
  return form;
}

/** A named team's last 5 results, newest first. Attendance doesn't matter. */
export function teamForm(entries: MatchFormEntry[], teamId: string): FormResult[] {
  const form: FormResult[] = [];
  for (const entry of newestFirst(entries)) {
    const side: Side | null =
      entry.result.side_a_team_id === teamId ? 'a' : entry.result.side_b_team_id === teamId ? 'b' : null;
    const result = side ? formResult(entry.result, side) : null;
    if (result) form.push(result);
    if (form.length === FORM_LENGTH) break;
  }
  return form;
}
