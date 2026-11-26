// The source of Home's Featured event (S3). Today it is the leagues table;
// S10B swaps this hook to its events list and nothing else on Home changes.
import { cyprusDateKey } from '@/lib/days';
import { type FeaturedEvent, getFeaturedEvent } from '@/lib/featured-event';
import { useLeagues } from '@/lib/use-leagues';

export type FeaturedEventState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; event: FeaturedEvent | null };

export function useFeaturedEvent(now: () => Date = () => new Date()): FeaturedEventState & { reload: () => void } {
  const leagues = useLeagues();
  const reload = () => void leagues.reload();
  if (leagues.status === 'loading') return { status: 'loading', reload };
  if (leagues.status === 'error') return { status: 'error', message: leagues.message, reload };
  return { status: 'ready', event: getFeaturedEvent(leagues.leagues, cyprusDateKey(now())), reload };
}
