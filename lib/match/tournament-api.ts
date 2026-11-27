// S10A page: the tournament reads and writes (match-record.md decision 1o;
// server in 20261127130100..130400_match_s10a_*.sql) and the pure helpers
// that shape them for the screens. Standings, tiebreaks, the knockout and
// every result come from the server; nothing here computes one. The entry
// fee is the server's integer cents, only formatted.
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import type { CompetitionPlayer } from '@/lib/match/competition-api';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';

type RpcError = { message: string } | null;

export type TournamentStatus = 'coming_soon' | 'registration' | 'groups' | 'knockout' | 'finished';
export type TournamentStage = 'group' | 'qf' | 'sf' | 'final';
export type GroupLetter = 'A' | 'B' | 'C' | 'D';

export const GROUP_LETTERS: readonly GroupLetter[] = ['A', 'B', 'C', 'D'];

/** What every read starts with (tournament_header_json). */
export type TournamentHeader = {
  id: string;
  name: string;
  area: string;
  country: string;
  format: string;
  status: TournamentStatus;
  comingSoon: boolean;
  startDate: string | null;
  endDate: string | null;
  venueId: string | null;
  venueName: string | null;
  maxTeams: number;
  teamsCount: number;
  entryFeeCents: number;
  championTeamId: string | null;
};

export type TournamentFixture = {
  fixtureId: string;
  stage: TournamentStage;
  group: GroupLetter | null;
  slot: string;
  kickoffAt: string | null;
  status: 'scheduled' | 'completed';
  homeTeamId: string | null;
  homeTeamName: string | null;
  homeKitColour: string | null;
  awayTeamId: string | null;
  awayTeamName: string | null;
  awayKitColour: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePens: number | null;
  awayPens: number | null;
  decidedBy: 'match' | 'organiser' | null;
  winnerTeamId: string | null;
  matchId: string | null;
};

export type TournamentTeam = {
  teamId: string;
  teamName: string;
  kitColour: string;
  group: GroupLetter | null;
  groupPos: number | null;
};

export type MyTournamentTeam = {
  teamId: string;
  teamName: string;
  kitColour: string;
  isCaptain: boolean;
  canEditSquad: boolean;
  squad: CompetitionPlayer[];
};

/** get_tournament: the header only while Coming soon, then everything. */
export type Tournament = TournamentHeader & {
  registrationDeadline?: string | null;
  matchMinutes?: number;
  squadMin?: number;
  squadMax?: number;
  progress?: { played: number; total: number };
  featured?: TournamentFixture | null;
  teams?: TournamentTeam[];
  myTeams?: MyTournamentTeam[];
};

export type GroupRow = {
  pos: number;
  teamId: string;
  teamName: string;
  kitColour: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  qualifies: boolean;
};

export type GroupStandings = { group: GroupLetter; needsDraw: boolean; rows: GroupRow[] };
export type TournamentStandings = { rules: string; groups: GroupStandings[] };

/** A knockout slot: the fixture once it exists, its sources always. */
export type KnockoutSlot = Partial<TournamentFixture> & {
  stage: Exclude<TournamentStage, 'group'>;
  slot: string;
  homeSource: string;
  awaySource: string;
};

// ---- Reads ---------------------------------------------------------------

export async function listTournaments() {
  const { data, error } = await supabase.rpc('list_tournaments');
  return { tournaments: (data as TournamentHeader[] | null) ?? [], error: error as RpcError };
}

export async function getTournament(tournamentId: string) {
  const { data, error } = await supabase.rpc('get_tournament', { p_tournament_id: tournamentId });
  return { tournament: (data as Tournament | null) ?? null, error: error as RpcError };
}

export async function getTournamentStandings(tournamentId: string) {
  const { data, error } = await supabase.rpc('get_tournament_standings', { p_tournament_id: tournamentId });
  return { standings: (data as TournamentStandings | null) ?? { rules: '', groups: [] }, error: error as RpcError };
}

export async function getTournamentMatches(tournamentId: string, teamId: string | null = null) {
  const { data, error } = await supabase.rpc('get_tournament_matches', { p_tournament_id: tournamentId, p_team_id: teamId });
  return { matches: (data as TournamentFixture[] | null) ?? [], error: error as RpcError };
}

export async function getTournamentKnockout(tournamentId: string) {
  const { data, error } = await supabase.rpc('get_tournament_knockout', { p_tournament_id: tournamentId });
  return { slots: (data as KnockoutSlot[] | null) ?? [], error: error as RpcError };
}

/** Shows or hides the admin screen; every admin call is checked on the server. */
export async function isAppAdmin() {
  const { data, error } = await supabase.rpc('is_app_admin');
  return { admin: data === true, error: error as RpcError };
}

// ---- Captains ------------------------------------------------------------

/** The captain registers one of his teams with its kit colour and squad. */
export async function registerTeam(tournamentId: string, teamId: string, kitColour: string, squad: string[]) {
  const { error } = await supabase.rpc('register_team_for_tournament', {
    p_tournament_id: tournamentId,
    p_team_id: teamId,
    p_kit_colour: kitColour,
    p_squad: squad,
  });
  return { error: error as RpcError };
}

export async function setSquad(tournamentId: string, teamId: string, squad: string[]) {
  const { error } = await supabase.rpc('set_tournament_squad', {
    p_tournament_id: tournamentId,
    p_team_id: teamId,
    p_squad: squad,
  });
  return { error: error as RpcError };
}

// ---- Admins --------------------------------------------------------------

/** The admin form's fields, as the server's JSON keys. Dates are Cyprus days
 *  (YYYY-MM-DD); the deadline is an ISO instant. */
export type TournamentInput = {
  name: string;
  area: string;
  format: string;
  entryFeeCents: number;
  matchMinutes: number;
  squadSubs: number;
  country?: string;
  venueId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  registrationDeadline?: string | null;
};

export async function adminCreateTournament(input: TournamentInput) {
  const { data, error } = await supabase.rpc('admin_create_tournament', { p: { ...input, maxTeams: 16 } });
  return { id: (data as string | null) ?? null, error: error as RpcError };
}

export async function adminUpdateTournament(tournamentId: string, input: TournamentInput) {
  const { error } = await supabase.rpc('admin_update_tournament', { p_tournament_id: tournamentId, p: input });
  return { error: error as RpcError };
}

export async function adminOpenRegistration(tournamentId: string) {
  const { error } = await supabase.rpc('admin_open_registration', { p_tournament_id: tournamentId });
  return { error: error as RpcError };
}

export type GroupsInput = Record<GroupLetter, string[]>;

export async function adminSetGroups(tournamentId: string, groups: GroupsInput) {
  const { error } = await supabase.rpc('admin_set_groups', { p_tournament_id: tournamentId, p_groups: groups });
  return { error: error as RpcError };
}

export async function adminDrawGroups(tournamentId: string) {
  const { error } = await supabase.rpc('admin_draw_groups', { p_tournament_id: tournamentId });
  return { error: error as RpcError };
}

export async function adminSetFixtureTime(fixtureId: string, kickoffAt: string) {
  const { error } = await supabase.rpc('admin_set_fixture_time', { p_fixture_id: fixtureId, p_kickoff_at: kickoffAt });
  return { error: error as RpcError };
}

/** Pens only for a level knockout score; null otherwise (the server checks). */
export async function adminSetResult(
  fixtureId: string,
  home: number,
  away: number,
  pens: { home: number; away: number } | null,
) {
  const { error } = await supabase.rpc('admin_set_result', {
    p_fixture_id: fixtureId,
    p_home: home,
    p_away: away,
    p_home_pens: pens?.home ?? null,
    p_away_pens: pens?.away ?? null,
  });
  return { error: error as RpcError };
}

/** The organiser's draw: the tied teams of one group, highest first. */
export async function adminSetDrawOrder(tournamentId: string, group: GroupLetter, teamIds: string[]) {
  const { error } = await supabase.rpc('admin_set_draw_order', {
    p_tournament_id: tournamentId,
    p_group: group,
    p_team_ids: teamIds,
  });
  return { error: error as RpcError };
}

export async function adminCloseTournament(tournamentId: string) {
  const { error } = await supabase.rpc('admin_close_tournament', { p_tournament_id: tournamentId });
  return { error: error as RpcError };
}

// ---- Helpers -------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 Dec" for a date key. */
function dayLabel(key: string): string {
  return `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
}

/** "6–14 Dec", "6 Dec", or "Coming soon" when the dates aren't set yet. */
export function tournamentDates(t: Pick<TournamentHeader, 'startDate' | 'endDate'>): string {
  if (!t.startDate) return 'Coming soon';
  if (!t.endDate || t.endDate === t.startDate) return dayLabel(t.startDate);
  const sameMonth = t.startDate.slice(0, 7) === t.endDate.slice(0, 7);
  return sameMonth
    ? `${Number(t.startDate.slice(8, 10))}–${dayLabel(t.endDate)}`
    : `${dayLabel(t.startDate)} – ${dayLabel(t.endDate)}`;
}

/** "€12 per player, paid to the organiser" (decision 1o): shown only,
 *  nothing is collected in the app. Whole euros drop the cents. */
export function entryFeeLine(entryFeeCents: number): string {
  const euros = formatEuros(entryFeeCents);
  return `${entryFeeCents % 100 === 0 ? euros.replace(/\.00$/, '') : euros} per player, paid to the organiser`;
}

const STATUS_LABEL: Record<TournamentStatus, string> = {
  coming_soon: 'Coming soon',
  registration: 'Sign-up open',
  groups: 'Group stage',
  knockout: 'Knockout',
  finished: 'Finished',
};

export function tournamentStatusLabel(status: TournamentStatus): string {
  return STATUS_LABEL[status];
}

/** "NC" for Nuevo Campo Cup. */
export function tournamentBadge(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)).toUpperCase();
}

const STAGE_TITLE: Record<TournamentStage, string> = {
  group: 'Group stage',
  qf: 'Quarter-finals',
  sf: 'Semi-finals',
  final: 'Final',
};

export function stageTitle(stage: TournamentStage): string {
  return STAGE_TITLE[stage];
}

/** A drawn knockout match decided on penalties. */
export function wentToPens(f: Pick<TournamentFixture, 'homePens' | 'awayPens'>): boolean {
  return f.homePens != null && f.awayPens != null;
}

const cyprusParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(iso: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of cyprusParts.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** "AP" (after penalties), "FT", the Cyprus kick-off time ("19:00"), or "". */
export function fixtureStatusLabel(f: Pick<TournamentFixture, 'status' | 'kickoffAt' | 'homePens' | 'awayPens'>): string {
  if (f.status === 'completed') return wentToPens(f) ? 'AP' : 'FT';
  if (!f.kickoffAt) return '';
  const p = parts(f.kickoffAt);
  return `${p.hour}:${p.minute}`;
}

/** "07/12/26": the Cyprus day; empty without a kick-off. */
export function fixtureDateLabel(f: Pick<TournamentFixture, 'kickoffAt'>): string {
  if (!f.kickoffAt) return '';
  const p = parts(f.kickoffAt);
  return `${p.day}/${p.month}/${p.year}`;
}

/** "AP 4–3": the shootout, home first; null when there was none. */
export function shootoutText(f: Pick<TournamentFixture, 'homePens' | 'awayPens'>): string | null {
  return wentToPens(f) ? `AP ${f.homePens}–${f.awayPens}` : null;
}

export type FixtureSection = { key: string; title: string; data: TournamentFixture[] };

export const NOT_SCHEDULED = 'Not scheduled';

/** By date: one section per Cyprus day, earliest first, then Not scheduled. */
export function groupFixturesByDate(rows: TournamentFixture[]): FixtureSection[] {
  const dated = rows.filter((f) => f.kickoffAt).sort((a, b) => a.kickoffAt!.localeCompare(b.kickoffAt!));
  const sections: FixtureSection[] = [];
  for (const f of dated) {
    const p = parts(f.kickoffAt!);
    const key = `20${p.year}-${p.month}-${p.day}`;
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.data.push(f);
    else sections.push({ key, title: `${p.weekday} ${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`, data: [f] });
  }
  const undated = rows.filter((f) => !f.kickoffAt);
  if (undated.length > 0) sections.push({ key: 'none', title: NOT_SCHEDULED, data: undated });
  return sections;
}

/** By group: Group A to D, the group's matches only. */
export function groupFixturesByGroup(rows: TournamentFixture[]): FixtureSection[] {
  return GROUP_LETTERS.map((g) => ({
    key: g,
    title: `Group ${g}`,
    data: rows.filter((f) => f.stage === 'group' && f.group === g),
  })).filter((s) => s.data.length > 0);
}

const STAGE_ORDER: TournamentStage[] = ['group', 'qf', 'sf', 'final'];

/** By round: Group stage, Quarter-finals, Semi-finals, Final. */
export function groupFixturesByRound(rows: TournamentFixture[]): FixtureSection[] {
  return STAGE_ORDER.map((stage) => ({
    key: stage,
    title: stageTitle(stage),
    data: rows.filter((f) => f.stage === stage),
  })).filter((s) => s.data.length > 0);
}

/** The bracket as drawn (decision 1o, changed 24 November): the left half is
 *  QF1 and QF3 into SF1, the right half QF2 and QF4 into SF2, then the final,
 *  so a group's two teams can only meet in the final. */
export function bracketHalves(slots: KnockoutSlot[]) {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const pick = (names: string[]) => names.map((n) => bySlot.get(n)).filter((s): s is KnockoutSlot => !!s);
  return {
    left: { quarters: pick(['QF1', 'QF3']), semi: bySlot.get('SF1') ?? null },
    right: { quarters: pick(['QF2', 'QF4']), semi: bySlot.get('SF2') ?? null },
    final: bySlot.get('F') ?? null,
  };
}

/** "Winner QF1" or "A1" until the team is known. */
export function slotSide(s: KnockoutSlot, side: 'home' | 'away'): { teamId: string | null; name: string; kitColour: string | null } {
  const id = side === 'home' ? s.homeTeamId : s.awayTeamId;
  const name = side === 'home' ? s.homeTeamName : s.awayTeamName;
  const kit = side === 'home' ? s.homeKitColour : s.awayKitColour;
  if (id && name) return { teamId: id, name, kitColour: kit ?? null };
  return { teamId: null, name: side === 'home' ? s.homeSource : s.awaySource, kitColour: null };
}

/** The registration card's main action: Register while sign-up is open and
 *  I captain a team that isn't in; Edit squad while the server lets me. */
export function registrationAction(
  t: Pick<Tournament, 'status' | 'myTeams' | 'teamsCount' | 'maxTeams'>,
  captainTeamIds: string[],
): 'register' | 'edit' | null {
  if (t.status !== 'registration') return null;
  const mine = t.myTeams ?? [];
  if (mine.some((m) => m.isCaptain && m.canEditSquad)) return 'edit';
  const registered = new Set(mine.map((m) => m.teamId));
  if (t.teamsCount >= t.maxTeams) return null;
  if (captainTeamIds.length === 0 || captainTeamIds.some((id) => !registered.has(id))) return 'register';
  return null;
}
