// A fake WeatherKit for tests, the counterpart of stripe-fake.ts: no network,
// no key. It records every call, so a test can check the cache kept Apple
// from being asked twice.
//
//   const fake = createWeatherKitFake({ hours: hourly(now, 240, { precipitationChance: 0.7 }) });
//   fake.fail = new Error('apple down');
import type { WeatherAttribution, WeatherHour, WeatherSource } from './weatherkit.ts';

export const FAKE_ATTRIBUTION: WeatherAttribution = {
  serviceName: 'Apple Weather',
  logoLight: 'https://weatherkit.apple.com/assets/branding/en/Apple_Weather_blk_en_3X_090122.png',
  logoDark: 'https://weatherkit.apple.com/assets/branding/en/Apple_Weather_wht_en_3X_090122.png',
  legalPageUrl: 'https://developer.apple.com/weatherkit/data-source-attribution/',
};

/** A calm hour: below every spec 13 threshold. */
export const CALM: Omit<WeatherHour, 'forecastStart'> = {
  conditionCode: 'Clear',
  precipitationChance: 0.1,
  precipitationAmount: 0,
  temperature: 20,
  windSpeed: 10,
};

/**
 * `count` hourly forecasts from the hour containing `from`, each calm unless
 * `change` says otherwise (a value for every hour, or a function of the hour).
 */
export function hourly(
  from: Date,
  count: number,
  change: Partial<WeatherHour> | ((start: Date) => Partial<WeatherHour>) = {},
): WeatherHour[] {
  const first = new Date(from);
  first.setUTCMinutes(0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(first.getTime() + i * 3_600_000);
    const extra = typeof change === 'function' ? change(start) : change;
    return { ...CALM, forecastStart: start.toISOString(), ...extra };
  });
}

export function createWeatherKitFake(options: { hours?: WeatherHour[]; attribution?: WeatherAttribution } = {}) {
  const state = {
    hours: options.hours ?? [],
    attribution: options.attribution ?? FAKE_ATTRIBUTION,
    /** When set, every call throws it, as an Apple outage would. */
    fail: null as Error | null,
    /** When set, the attribution call alone throws it. */
    failAttribution: null as Error | null,
    hourlyCalls: [] as { latitude: number; longitude: number }[],
    attributionCalls: 0,
  };
  const source: WeatherSource = {
    hourly(latitude, longitude) {
      state.hourlyCalls.push({ latitude, longitude });
      if (state.fail) return Promise.reject(state.fail);
      return Promise.resolve(structuredClone(state.hours));
    },
    attribution() {
      state.attributionCalls += 1;
      const error = state.fail ?? state.failAttribution;
      if (error) return Promise.reject(error);
      return Promise.resolve({ ...state.attribution });
    },
  };
  return Object.assign(state, { source });
}
