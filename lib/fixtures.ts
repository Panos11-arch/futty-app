import { dateKeyToDate, dayLabel } from '@/lib/days';
import { supabase } from '@/lib/supabase';

/** How far ahead a fixture's date can be proposed — supabase/league-fixtures.sql. */
export const FIXTURE_SCHEDULING_WINDOW_DAYS = 7;

export type FixtureStatus = 'unscheduled' | 'proposed' | 'agreed' | 'completed';

export type Fixture = {
  id: string;
  league_id: string;
  division_name: string | null;
  home_team_id: string;
  away_team_id: string;
  venue_id: string | null;
  scheduled_day: string | null;
  scheduled_time: string | null;
  status: FixtureStatus;
  score_attempts: number;
  score_locked: boolean;
  created_at: string;
  /** Set once status is 'completed' — the score both captains agreed on. */
  home_score: number | null;
  away_score: number | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
  venue: { id: string; name: string; city: string } | null;
};

const FIXTURE_SELECT = `
  id, league_id, division_name, home_team_id, away_team_id, venue_id, scheduled_day, scheduled_time, status, score_attempts, score_locked, created_at, home_score, away_score,
  home_team:teams!league_fixtures_home_team_id_fkey(id, name),
  away_team:teams!league_fixtures_away_team_id_fkey(id, name),
  venue:venues(id, name, city)
`;

/** "Mon 3 Aug · 18:00" instead of the raw "2026-08-03 · 18:00:00". */
export function formatFixtureWhen(fixture: Fixture) {
  if (!fixture.scheduled_day) return null;
  const day = dayLabel(dateKeyToDate(fixture.scheduled_day));
  const time = fixture.scheduled_time?.slice(0, 5);
  return time ? `${day} · ${time}` : day;
}

// No match duration is tracked on league_fixtures — assumed as a flat 2
// hours so scoring can't happen before or during the game, matching
// supabase/scores.sql's server-side "too_early" check.
const FIXTURE_MATCH_DURATION_MS = 2 * 60 * 60 * 1000;

/** Whether the signed-in user (a captain of either side) can log this
 *  fixture's score right now — shared by the home screen, the League tab's
 *  "Your fixtures" teaser, and the full upcoming-fixtures list, so the three
 *  can't drift out of sync on what "ready to score" means. */
export function canLogFixtureScore(fixture: Fixture, myCaptainTeamIds: Set<string>) {
  const isCaptain = myCaptainTeamIds.has(fixture.home_team_id) || myCaptainTeamIds.has(fixture.away_team_id);
  const matchEnded =
    !!fixture.scheduled_day &&
    !!fixture.scheduled_time &&
    new Date(`${fixture.scheduled_day}T${fixture.scheduled_time}`).getTime() + FIXTURE_MATCH_DURATION_MS <
      Date.now();

  return isCaptain && fixture.status === 'agreed' && !fixture.score_locked && matchEnded;
}

/** Every fixture involving any of the given teams — pass every team the
 *  signed-in user belongs to (any role) to show "my fixtures". */
export async function listFixturesForTeams(teamIds: string[]) {
  if (teamIds.length === 0) {
    return { data: [] as Fixture[], error: null };
  }

  const list = teamIds.join(',');
  const { data, error } = await supabase
    .from('league_fixtures')
    .select(FIXTURE_SELECT)
    .or(`home_team_id.in.(${list}),away_team_id.in.(${list})`)
    .order('scheduled_day', { ascending: true, nullsFirst: false });

  return { data: (data ?? []) as unknown as Fixture[], error };
}

export async function getFixture(fixtureId: string) {
  const { data, error } = await supabase
    .from('league_fixtures')
    .select(FIXTURE_SELECT)
    .eq('id', fixtureId)
    .maybeSingle();

  return { data: data as unknown as Fixture | null, error };
}

export type FixtureProposal = {
  id: string;
  fixture_id: string;
  proposed_by_team_id: string;
  venue_id: string;
  proposed_day: string;
  proposed_time: string;
  created_at: string;
  venue: { id: string; name: string; city: string } | null;
};

/** Full proposal history for one fixture, newest first — the client reduces
 *  this to "each team's latest proposal" for display. */
export async function listFixtureProposals(fixtureId: string) {
  return supabase
    .from('fixture_schedule_proposals')
    .select('id, fixture_id, proposed_by_team_id, venue_id, proposed_day, proposed_time, created_at, venue:venues(id, name, city)')
    .eq('fixture_id', fixtureId)
    .order('created_at', { ascending: false });
}

export async function proposeFixtureSchedule(
  fixtureId: string,
  day: string,
  time: string,
  venueId: string
) {
  return supabase.rpc('propose_fixture_schedule', {
    p_fixture_id: fixtureId,
    p_day: day,
    p_time: time,
    p_venue_id: venueId,
  });
}

export type FixtureMessage = {
  id: string;
  fixture_id: string;
  sender_team_id: string;
  message: string;
  created_at: string;
  sender_team: { id: string; name: string } | null;
};

export async function listFixtureMessages(fixtureId: string) {
  return supabase
    .from('fixture_messages')
    .select('id, fixture_id, sender_team_id, message, created_at, sender_team:teams!fixture_messages_sender_team_id_fkey(id, name)')
    .eq('fixture_id', fixtureId)
    .order('created_at', { ascending: true });
}

export async function sendFixtureMessage(fixtureId: string, message: string) {
  return supabase.rpc('send_fixture_message', { p_fixture_id: fixtureId, p_message: message });
}

export type FixtureScoreSubmission = {
  id: string;
  fixture_id: string;
  submitted_by_team_id: string;
  home_score: number;
  away_score: number;
  submitted_at: string;
};

/** Full submission history for one fixture, newest first — lets the UI show
 *  each captain's latest number while a dispute is still open. */
export async function listFixtureScoreSubmissions(fixtureId: string) {
  return supabase
    .from('fixture_score_submissions')
    .select('id, fixture_id, submitted_by_team_id, home_score, away_score, submitted_at')
    .eq('fixture_id', fixtureId)
    .order('submitted_at', { ascending: false });
}

export async function submitFixtureScore(fixtureId: string, homeScore: number, awayScore: number) {
  return supabase.rpc('submit_fixture_score', {
    p_fixture_id: fixtureId,
    p_home_score: homeScore,
    p_away_score: awayScore,
  });
}

/** "Couldn't agree a day within the week" resolution — only becomes valid
 *  server-side once 7 days have passed since the fixture appeared with no
 *  agreed schedule (supabase/scores.sql). */
export async function resolveUnscheduledFixture(fixtureId: string) {
  return supabase.rpc('resolve_unscheduled_fixture', { p_fixture_id: fixtureId });
}
