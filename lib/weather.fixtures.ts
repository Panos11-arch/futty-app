// Test-only: what venue-weather returns, for lib and component tests.
import type { Forecast, WeatherAttribution, Warning } from '@/lib/weather';

export const ATTRIBUTION: WeatherAttribution = {
  serviceName: 'Apple Weather',
  logoLight: 'https://weatherkit.apple.com/assets/branding/en/Apple_Weather_blk_en_3X_090122.png',
  logoDark: 'https://weatherkit.apple.com/assets/branding/en/Apple_Weather_wht_en_3X_090122.png',
  legalPageUrl: 'https://developer.apple.com/weatherkit/data-source-attribution/',
};

/** Below every threshold: no warnings. */
export const CALM_FORECAST: Forecast = {
  rain_chance_pct: 10,
  rain_mm: 0,
  wind_kmh: 12,
  temp_min_c: 19,
  temp_max_c: 19,
  thunderstorm: false,
  heavy_rain: false,
  warnings: [],
};

/** A forecast the server found met `warnings`. */
export function forecastWith(warnings: Warning[]): Forecast {
  return { ...CALM_FORECAST, warnings };
}
