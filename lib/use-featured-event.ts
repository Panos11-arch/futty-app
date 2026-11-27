// The source of Home's Featured event (S3, S10B): the tournaments
// (list_tournaments, S10A), each sign-up open one's registration deadline
// (get_tournament), and the leagues table. lib/featured-event.ts picks one.
// A failing tournament read never breaks Home: a failed deadline skips that
// tournament, and a failed list falls back to the leagues as if there were
// no tournaments.
import { cyprusDateKey } from '@/lib/days';
import { type FeaturedEvent, getFeaturedEvent, type TournamentDeadlines } from '@/lib/featured-event';
import { getTournament, type TournamentHeader } from '@/lib/match/tournament-api';
import { useLoad } from '@/lib/match/use-match-result';
import { useTournaments } from '@/lib/match/use-tournament';
import { useLeagues } from '@/lib/use-leagues';

export type FeaturedEventState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; event: FeaturedEvent | null };

async function readDeadlines(ids: string[]): Promise<{ value: { deadlines: TournamentDeadlines } }> {
  const entries = await Promise.all(
    ids.map(async (id): Promise<[string, string | null | 'failed']> => {
      try {
        const { tournament, error } = await getTournament(id);
        if (error || !tournament) return [id, 'failed'];
        return [id, tournament.registrationDeadline ?? null];
      } catch {
        return [id, 'failed'];
      }
    }),
  );
  return { value: { deadlines: Object.fromEntries(entries) } };
}

export function useFeaturedEvent(now: () => Date = () => new Date()): FeaturedEventState & { reload: () => void } {
  const leagues = useLeagues();
  const tournaments = useTournaments();

  const list: TournamentHeader[] = tournaments.status === 'ready' ? tournaments.tournaments : [];
  const signupIds = list.filter((t) => t.status === 'registration').map((t) => t.id);
  const deadlines = useLoad<{ deadlines: TournamentDeadlines }>(
    tournaments.status === 'ready' ? () => readDeadlines(signupIds) : null,
    `${tournaments.status}:${signupIds.join(',')}`,
  );

  const reload = () => {
    void leagues.reload();
    tournaments.reload();
    void deadlines.reload();
  };

  if (leagues.status === 'loading' || tournaments.status === 'loading') return { status: 'loading', reload };
  if (tournaments.status === 'ready' && deadlines.state.status === 'loading') return { status: 'loading', reload };

  const at = now();
  const event = getFeaturedEvent(leagues.status === 'ready' ? leagues.leagues : [], cyprusDateKey(at), {
    tournaments: list,
    deadlines: deadlines.state.status === 'ready' ? deadlines.state.deadlines : {},
    now: at,
  });
  // The league list failed and there's no tournament to show instead.
  if (leagues.status === 'error' && !event) return { status: 'error', message: leagues.message, reload };
  return { status: 'ready', event, reload };
}
