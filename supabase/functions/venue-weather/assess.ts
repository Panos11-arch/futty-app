// The forecast for a game's hours, checked against spec 13's thresholds as
// they stand in public.app_rules ("Weather", confirmed thresholds). No number
// here is a rule: every threshold comes in through `rules`.
import type { AppRules } from '../_shared/rules.ts';
import type { WeatherHour } from '../_shared/weatherkit.ts';

export type Warning = 'rain_chance' | 'heavy_rain' | 'wind' | 'thunderstorm' | 'heat';

/** The worst of the game's hours, as players read it (whole numbers; rain to 0.1 mm). */
export type Forecast = {
  rain_chance_pct: number;
  rain_mm: number;
  wind_kmh: number;
  temp_min_c: number;
  temp_max_c: number;
  thunderstorm: boolean;
  heavy_rain: boolean;
  warnings: Warning[];
};

export type Assessment = { status: 'forecast'; forecast: Forecast } | { status: 'out_of_range' } | { status: 'past' };

/** Apple's conditions that mean a thunderstorm (WeatherKit conditionCode). */
const THUNDERSTORMS = new Set([
  'Thunderstorm',
  'Thunderstorms',
  'IsolatedThunderstorms',
  'ScatteredThunderstorms',
  'SevereThunderstorm',
  'StrongStorms',
]);
/** Apple's own heavy-rain condition; Futty sets no millimetre figure of its own. */
const HEAVY_RAIN = 'HeavyRain';

const HOUR_MS = 3_600_000;

// ---- Cyprus wall-clock time to UTC ----------------------------------------

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Nicosia',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Cyprus's offset from UTC at `at`, in milliseconds. */
function cyprusOffsetMs(at: number): number {
  const p = Object.fromEntries(parts.formatToParts(new Date(at)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
}

/** A Cyprus day and time ('2026-11-20', '18:00') as a UTC instant (ms). */
export function cyprusInstant(day: string, time: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset across a clock change.
  const first = wall - cyprusOffsetMs(wall);
  return wall - cyprusOffsetMs(first);
}

/** The game's start and end as UTC instants. An end of 00:00 is midnight after the day. */
export function gameSpan(day: string, start: string, end: string): { from: number; to: number } {
  const from = cyprusInstant(day, start);
  let to = cyprusInstant(day, end);
  if (to <= from) to += 24 * HOUR_MS;
  return { from, to };
}

// ---- Assessing -------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A whole number for display that agrees with the warning: 39.6 km/h under a
 *  40 rule shows 39, never "40" without a warning. */
function shown(value: number, met: boolean, rule: number): number {
  const rounded = Math.round(value);
  if (!met && rounded >= rule) return rule - 1;
  return rounded;
}

export function assess(
  hours: WeatherHour[],
  span: { from: number; to: number },
  now: number,
  rules: AppRules,
): Assessment {
  if (span.to <= now) return { status: 'past' };

  const starts = hours.map((h) => Date.parse(h.forecastStart));
  const lastEnd = starts.length ? Math.max(...starts) + HOUR_MS : -Infinity;
  // The forecast must reach the end of the game; the hours already gone needn't be in it.
  if (lastEnd < span.to) return { status: 'out_of_range' };

  const inGame = hours.filter((_, i) => starts[i] < span.to && starts[i] + HOUR_MS > Math.max(span.from, now));
  if (inGame.length === 0) return { status: 'out_of_range' };

  // Compared unrounded ("or more"), so 59.5% never counts as the 60% rule;
  // rounded only for display. A tiny epsilon absorbs float noise (0.6 * 100).
  const rainChancePct = Math.max(...inGame.map((h) => h.precipitationChance)) * 100;
  const wind = Math.max(...inGame.map((h) => h.windSpeed));
  const tempMax = Math.max(...inGame.map((h) => h.temperature));
  const tempMin = Math.min(...inGame.map((h) => h.temperature));
  const thunderstorm = inGame.some((h) => THUNDERSTORMS.has(h.conditionCode));
  const heavyRain = inGame.some((h) => h.conditionCode === HEAVY_RAIN);
  const atLeast = (value: number, rule: number) => value + 1e-9 >= rule;

  const warnings: Warning[] = [];
  if (atLeast(rainChancePct, rules.weather_rain_chance_pct)) warnings.push('rain_chance');
  if (rules.weather_heavy_rain && heavyRain) warnings.push('heavy_rain');
  if (atLeast(wind, rules.weather_wind_kmh)) warnings.push('wind');
  if (rules.weather_thunderstorms && thunderstorm) warnings.push('thunderstorm');
  if (atLeast(tempMax, rules.weather_heat_c)) warnings.push('heat');

  return {
    status: 'forecast',
    forecast: {
      // Displayed whole numbers never show a met threshold as below it, or the reverse:
      // rounded down when the rule isn't met, up when it is.
      rain_chance_pct: shown(rainChancePct, warnings.includes('rain_chance'), rules.weather_rain_chance_pct),
      rain_mm: round1(Math.max(...inGame.map((h) => h.precipitationAmount))),
      wind_kmh: shown(wind, warnings.includes('wind'), rules.weather_wind_kmh),
      temp_min_c: Math.round(tempMin),
      temp_max_c: shown(tempMax, warnings.includes('heat'), rules.weather_heat_c),
      thunderstorm,
      heavy_rain: heavyRain,
      warnings,
    },
  };
}
