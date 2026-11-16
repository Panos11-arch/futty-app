// P11 Weather in the app (docs/specs/13-payments-bookings.md "Weather,
// condition warnings and blocking pitches"; 05 Product section 14).
//
// The forecast comes from Apple WeatherKit through the venue-weather Edge
// Function, which also checks it against the thresholds in public.app_rules.
// The app keeps no threshold of its own: it shows the banner when the server
// says a threshold was met. A forecast is only ever shown with Apple's
// "Weather" mark and its data-sources link (Apple's attribution rules), so a
// forecast that comes back without them is treated as no forecast.
import { supabase } from '@/lib/supabase';
import { dayTitle } from '@/lib/venue-today';

export const OUT_OF_RANGE_TEXT = 'Forecast available closer to the date';

export type Warning = 'rain_chance' | 'heavy_rain' | 'wind' | 'thunderstorm' | 'heat';

/** The worst of the game's hours, as the server worked it out. */
export type Forecast = {
  rain_chance_pct: number;
  rain_mm: number;
  wind_kmh: number;
  temp_min_c: number;
  temp_max_c: number;
  thunderstorm: boolean;
  heavy_rain: boolean;
  /** The app_rules thresholds this forecast meets. */
  warnings: Warning[];
};

export type WeatherAttribution = {
  serviceName: string;
  logoLight: string;
  logoDark: string;
  legalPageUrl: string;
};

/** A game in Cyprus time. */
export type GameWindow = { day: string; start: string; end: string };

export type WindowWeather =
  & GameWindow
  & ({ status: 'forecast'; forecast: Forecast } | { status: 'out_of_range' | 'past' | 'unavailable' });

export type GameWeather = { attribution: WeatherAttribution | null; window: WindowWeather };

export type WeatherNudge = GameWindow & { booking_id: string; pitch_ids: string[]; forecast: Forecast };
export type WeatherNudges = { attribution: WeatherAttribution | null; slots: WeatherNudge[] };

const hhmm = (time: string) => time.slice(0, 5);

/** The forecast for one game's hours at a venue. Any failure reads as no forecast. */
export async function fetchGameWeather(venueId: string, game: GameWindow): Promise<GameWeather> {
  const window = { day: game.day, start: hhmm(game.start), end: hhmm(game.end) };
  const none: GameWeather = { attribution: null, window: { ...window, status: 'unavailable' } };
  try {
    const { data, error } = await supabase.functions.invoke('venue-weather', {
      body: { venue_id: venueId, windows: [window] },
    });
    const answer = data?.windows?.[0];
    if (error || !answer) return none;
    // Apple's rules: no forecast without its mark and data-sources link.
    if (!data.attribution && answer.status === 'forecast') return none;
    return { attribution: data.attribution ?? null, window: { ...window, ...answer } };
  } catch {
    return none;
  }
}

/** The Today screen's nudge: booked games, far enough ahead, with a bad forecast. */
export async function fetchWeatherNudges(venueId: string): Promise<WeatherNudges> {
  const none: WeatherNudges = { attribution: null, slots: [] };
  try {
    const { data, error } = await supabase.functions.invoke('venue-weather', {
      body: { venue_id: venueId, nudges: true },
    });
    if (error || !data?.attribution || !Array.isArray(data.slots)) return none;
    return { attribution: data.attribution, slots: data.slots };
  } catch {
    return none;
  }
}

// The banner names what was met, in this order, then the warning. A rain
// chance and heavy rain both read as heavy rain, named once.
const BANNER_REASONS: { reason: string; warnings: Warning[] }[] = [
  { reason: 'Heavy rain forecast.', warnings: ['rain_chance', 'heavy_rain'] },
  { reason: 'Strong wind forecast.', warnings: ['wind'] },
  { reason: 'Thunderstorms forecast.', warnings: ['thunderstorm'] },
  { reason: 'Extreme heat forecast.', warnings: ['heat'] },
];
const BANNER_TAIL = 'The venue may cancel this booking.';

/** The banner, e.g. "Strong wind forecast. The venue may cancel this booking."; null when no threshold is met. */
export function bannerText(forecast: Forecast): string | null {
  const reasons = BANNER_REASONS.filter((r) => r.warnings.some((w) => forecast.warnings.includes(w))).map((r) => r.reason);
  return reasons.length ? [...reasons, BANNER_TAIL].join(' ') : null;
}

/** The strip's lines: rain, wind, temperature, and thunderstorms when forecast. */
export function forecastLines(f: Forecast): string[] {
  const rain = f.rain_mm > 0 ? `Rain ${f.rain_chance_pct}% · ${f.rain_mm} mm` : `Rain ${f.rain_chance_pct}%`;
  const temperature = f.temp_min_c === f.temp_max_c ? `${f.temp_max_c}°C` : `${f.temp_min_c}–${f.temp_max_c}°C`;
  return [rain, `Wind ${f.wind_kmh} km/h`, temperature, ...(f.thunderstorm ? ['Thunderstorms'] : [])];
}

/** What made the forecast bad, for the venue's nudge. */
export function warningWords(f: Forecast): string {
  const words: Record<Warning, string> = {
    rain_chance: `rain ${f.rain_chance_pct}%`,
    heavy_rain: 'heavy rain',
    wind: `wind ${f.wind_kmh} km/h`,
    thunderstorm: 'thunderstorms',
    heat: `${f.temp_max_c}°C`,
  };
  const text = f.warnings.map((w) => words[w]).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function nudgeTitle(slot: GameWindow, today: string): string {
  return `${dayTitle(slot.day, today)} ${hhmm(slot.start)}–${hhmm(slot.end)}`;
}
