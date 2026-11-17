// Loads P11's forecast for a screen (see lib/weather.ts). The server caches
// each venue's forecast for an hour, so asking again on each visit is cheap.
import { useCallback } from 'react';

import { useLoad } from '@/lib/booking-search';
import { fetchGameWeather, fetchWeatherNudges, type GameWeather, type GameWindow, type WeatherNudges } from '@/lib/weather';

/** The forecast for one game's hours, or null while loading or with nothing to ask. */
export function useGameWeather(venueId: string | null | undefined, game: GameWindow | null): {
  weather: GameWeather | null;
  loading: boolean;
} {
  const key = venueId && game ? JSON.stringify([venueId, game.day, game.start, game.end]) : null;
  // The key holds everything the call uses; the game object itself is new on each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => fetchGameWeather(venueId!, game!), [key]);
  const { state } = useLoad(key, load);
  if (!key) return { weather: null, loading: false };
  return { weather: state.status === 'ready' ? state.data : null, loading: state.status === 'loading' };
}

/** The Today screen's bad-forecast nudges for a venue. */
export function useWeatherNudges(venueId: string | null | undefined): {
  nudges: WeatherNudges | null;
  reload: () => void;
} {
  const load = useCallback(() => fetchWeatherNudges(venueId!), [venueId]);
  const { state, reload } = useLoad(venueId ? `nudges:${venueId}` : null, load);
  return { nudges: state.status === 'ready' ? state.data : null, reload };
}
