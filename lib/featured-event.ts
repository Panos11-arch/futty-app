// Home's "Featured event" (S3; spec 15 section 0.6, image 01). There is no
// events data yet (S10B builds the events list), so for now an event is a
// league still in sign-up: the soonest one that starts today or later in
// Cyprus. S10B swaps only the source (lib/use-featured-event.ts); S10 pointed
// featuredEventRoute at the competition page. Leagues have no photo and no price per player, so the
// card shows neither.
import type { League } from '@/lib/leagues';
import { leagueFormatOpen } from '@/lib/premium';

export type FeaturedEvent = {
  id: string;
  kind: 'league';
  name: string;
  format: string;
  /** Cyprus day the league starts (YYYY-MM-DD). */
  startDate: string;
};

/** The league to feature, or null (Home then hides the section). `today` is
 *  the Cyprus date (lib/days.ts cyprusDateKey). A format that needs Team
 *  Premium while it's off (9 and 11-a-side) is never featured: S9's Leagues
 *  screen shows it as Coming soon. */
export function getFeaturedEvent(
  leagues: League[],
  today: string,
  { teamPremiumEnabled }: { teamPremiumEnabled?: boolean } = {},
): FeaturedEvent | null {
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

/** Where "Join" goes: the league's competition page (S10), where the season
 *  card holds the join flow while sign-up is open. */
export function featuredEventRoute(event: FeaturedEvent) {
  return { pathname: '/leagues/[id]' as const, params: { id: event.id } };
}
