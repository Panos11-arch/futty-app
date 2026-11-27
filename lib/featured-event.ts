// Home's "Featured event" (S3; spec 15 section 0.6, image 01). S10B
// (decided 27 November): a tournament comes before a league. Among
// tournaments, sign-up open first, then Coming soon; ties by the earliest
// start date, then the name. Finished tournaments, and ones whose
// registration has closed, are never featured. With no tournament to show,
// the league rule from S3 stays: the soonest league in sign-up that starts
// today or later in Cyprus. lib/use-featured-event.ts is the only source.
import type { League } from '@/lib/leagues';
import { cyprusDateKey } from '@/lib/days';
import { tournamentHref } from '@/lib/match/league-routes';
import type { TournamentHeader } from '@/lib/match/tournament-api';
import { leagueFormatOpen } from '@/lib/premium';

export type FeaturedLeague = {
  id: string;
  kind: 'league';
  name: string;
  format: string;
  /** Cyprus day the league starts (YYYY-MM-DD). */
  startDate: string;
};

/** Everything tournamentHref needs, plus the card's facts. The entry fee is
 *  the server's cents, shown only. */
export type FeaturedTournament = {
  id: string;
  kind: 'tournament';
  name: string;
  area: string;
  format: string;
  maxTeams: number;
  entryFeeCents: number;
  comingSoon: boolean;
  startDate: string | null;
};

export type FeaturedEvent = FeaturedLeague | FeaturedTournament;

/** A sign-up open tournament's registrationDeadline from get_tournament
 *  (null when it has none), or 'failed' when that read failed. */
export type TournamentDeadlines = Record<string, string | null | 'failed'>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Is registration still open in Cyprus time? An instant is open until it
 *  passes (as the server checks); a date is open to the end of that Cyprus
 *  day; no deadline is open. */
export function registrationOpen(deadline: string | null, now: Date): boolean {
  if (!deadline) return true;
  if (DATE_ONLY.test(deadline)) return cyprusDateKey(now) <= deadline;
  return now.getTime() < Date.parse(deadline);
}

function pickTournament(tournaments: TournamentHeader[], deadlines: TournamentDeadlines, now: Date) {
  const candidates = tournaments.filter((t) => {
    if (t.status === 'coming_soon') return true;
    if (t.status !== 'registration') return false;
    // Not read, or the read failed: skipped, never shown as open by guess.
    const deadline = deadlines[t.id];
    if (deadline === undefined || deadline === 'failed') return false;
    return registrationOpen(deadline, now);
  });
  const rank = (t: TournamentHeader) => (t.status === 'registration' ? 0 : 1);
  return candidates.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.startDate ?? '￿').localeCompare(b.startDate ?? '￿') ||
      a.name.localeCompare(b.name),
  )[0];
}

/** The event to feature, or null (Home then hides the section). `today` is
 *  the Cyprus date (lib/days.ts cyprusDateKey). A league format that needs
 *  Team Premium while it's off (9 and 11-a-side) is never featured: S9's
 *  Leagues screen shows it as Coming soon. */
export function getFeaturedEvent(
  leagues: League[],
  today: string,
  {
    teamPremiumEnabled,
    tournaments = [],
    deadlines = {},
    now = new Date(),
  }: { teamPremiumEnabled?: boolean; tournaments?: TournamentHeader[]; deadlines?: TournamentDeadlines; now?: Date } = {},
): FeaturedEvent | null {
  const tournament = pickTournament(tournaments, deadlines, now);
  if (tournament) {
    return {
      id: tournament.id,
      kind: 'tournament',
      name: tournament.name,
      area: tournament.area,
      format: tournament.format,
      maxTeams: tournament.maxTeams,
      entryFeeCents: tournament.entryFeeCents,
      comingSoon: tournament.comingSoon,
      startDate: tournament.startDate,
    };
  }

  const formatOpen = (format: string) =>
    teamPremiumEnabled === undefined ? leagueFormatOpen(format) : leagueFormatOpen(format, teamPremiumEnabled);
  const open = leagues
    .filter((l) => l.stage === 'signup' && !l.parent_league_id && l.start_date !== null && l.start_date >= today)
    .filter((l) => formatOpen(l.format))
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!));
  const league = open[0];
  if (!league) return null;
  return {
    id: league.id,
    kind: 'league',
    name: league.name || `${league.format} ${league.scope}`,
    format: league.format,
    startDate: league.start_date!,
  };
}

/** Where the card's button goes. A league: its competition page (S10), where
 *  the season card holds the join flow. A tournament: tournamentHref (S10A),
 *  the Coming soon screen until sign-up opens, then its page. */
export function featuredEventRoute(event: FeaturedEvent) {
  if (event.kind === 'tournament') return tournamentHref(event);
  return { pathname: '/leagues/[id]' as const, params: { id: event.id } };
}
