// P11 Weather in the app: the server (venue-weather) checks the forecast
// against app_rules; the app only shows what it returns.
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import {
  fetchGameWeather,
  fetchWeatherNudges,
  forecastLines,
  nudgeTitle,
  OUT_OF_RANGE_TEXT,
  bannerText,
  warningWords,
} from '@/lib/weather';
import { ATTRIBUTION, CALM_FORECAST, forecastWith } from '@/lib/weather.fixtures';

beforeEach(() => mockInvoke.mockReset());

describe('the words spec 13 fixes', () => {
  it('out-of-range text', () => {
    expect(OUT_OF_RANGE_TEXT).toBe('Forecast available closer to the date');
  });
});

describe('bannerText: names the thresholds met, then the warning', () => {
  it.each([
    ['rain_chance', 'Heavy rain forecast. The venue may cancel this booking.'],
    ['heavy_rain', 'Heavy rain forecast. The venue may cancel this booking.'],
    ['wind', 'Strong wind forecast. The venue may cancel this booking.'],
    ['thunderstorm', 'Thunderstorms forecast. The venue may cancel this booking.'],
    ['heat', 'Extreme heat forecast. The venue may cancel this booking.'],
  ] as const)('%s alone', (w, text) => {
    expect(bannerText(forecastWith([w]))).toBe(text);
  });
  it('several on one line, rain named once, in a fixed order', () => {
    expect(bannerText(forecastWith(['heat', 'thunderstorm', 'heavy_rain', 'wind', 'rain_chance']))).toBe(
      'Heavy rain forecast. Strong wind forecast. Thunderstorms forecast. Extreme heat forecast. The venue may cancel this booking.',
    );
    expect(bannerText(forecastWith(['heat', 'wind']))).toBe(
      'Strong wind forecast. Extreme heat forecast. The venue may cancel this booking.',
    );
  });
  it('below every threshold: no banner', () => {
    expect(bannerText(CALM_FORECAST)).toBeNull();
  });
});

describe('forecastLines', () => {
  it('rain chance and amount, wind, temperature', () => {
    expect(forecastLines(CALM_FORECAST)).toEqual(['Rain 10%', 'Wind 12 km/h', '19°C']);
  });
  it('a range of temperatures, rain in mm, and thunderstorms', () => {
    expect(
      forecastLines({ ...CALM_FORECAST, rain_mm: 2.4, temp_min_c: 17, temp_max_c: 21, thunderstorm: true }),
    ).toEqual(['Rain 10% · 2.4 mm', 'Wind 12 km/h', '17–21°C', 'Thunderstorms']);
  });
});

describe('warningWords', () => {
  it('names what was met, with the server\'s numbers', () => {
    const f = { ...CALM_FORECAST, rain_chance_pct: 70, wind_kmh: 45, temp_max_c: 39, heavy_rain: true, thunderstorm: true };
    expect(warningWords({ ...f, warnings: ['rain_chance', 'heavy_rain', 'wind', 'thunderstorm', 'heat'] })).toBe(
      'Rain 70%, heavy rain, wind 45 km/h, thunderstorms, 39°C',
    );
  });
});

describe('nudgeTitle', () => {
  it('the day and time', () => {
    expect(nudgeTitle({ day: '2026-11-21', start: '18:00', end: '19:00' }, '2026-11-20')).toBe('Tomorrow 18:00–19:00');
  });
});

describe('fetchGameWeather', () => {
  it('asks venue-weather for the game\'s hours and returns its answer', async () => {
    const window = { day: '2026-11-20', start: '18:00', end: '19:00' };
    mockInvoke.mockResolvedValue({
      data: { attribution: ATTRIBUTION, windows: [{ ...window, status: 'forecast', forecast: CALM_FORECAST }] },
      error: null,
    });
    const result = await fetchGameWeather('v1', window);
    expect(mockInvoke).toHaveBeenCalledWith('venue-weather', { body: { venue_id: 'v1', windows: [window] } });
    expect(result).toEqual({ attribution: ATTRIBUTION, window: { ...window, status: 'forecast', forecast: CALM_FORECAST } });
  });

  it('seconds are dropped from the times', async () => {
    mockInvoke.mockResolvedValue({ data: { attribution: null, windows: [{ status: 'unavailable' }] }, error: null });
    await fetchGameWeather('v1', { day: '2026-11-20', start: '18:00:00', end: '19:00:00' });
    expect(mockInvoke).toHaveBeenCalledWith('venue-weather', {
      body: { venue_id: 'v1', windows: [{ day: '2026-11-20', start: '18:00', end: '19:00' }] },
    });
  });

  it('a forecast without Apple\'s mark is never passed on', async () => {
    mockInvoke.mockResolvedValue({
      data: { attribution: null, windows: [{ status: 'forecast', forecast: CALM_FORECAST }] },
      error: null,
    });
    const result = await fetchGameWeather('v1', { day: '2026-11-20', start: '18:00', end: '19:00' });
    expect(result.window.status).toBe('unavailable');
  });

  it('an error reads as no forecast, never a guess', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('boom') });
    const result = await fetchGameWeather('v1', { day: '2026-11-20', start: '18:00', end: '19:00' });
    expect(result).toEqual({ attribution: null, window: { day: '2026-11-20', start: '18:00', end: '19:00', status: 'unavailable' } });
  });
});

describe('fetchWeatherNudges', () => {
  it('asks for the venue\'s nudges', async () => {
    const slot = { booking_id: 'b1', day: '2026-11-21', start: '18:00', end: '19:00', pitch_ids: ['p1'], forecast: forecastWith(['wind']) };
    mockInvoke.mockResolvedValue({ data: { attribution: ATTRIBUTION, slots: [slot] }, error: null });
    expect(await fetchWeatherNudges('v1')).toEqual({ attribution: ATTRIBUTION, slots: [slot] });
    expect(mockInvoke).toHaveBeenCalledWith('venue-weather', { body: { venue_id: 'v1', nudges: true } });
  });

  it('without Apple\'s mark, no nudges', async () => {
    mockInvoke.mockResolvedValue({ data: { attribution: null, slots: [{ booking_id: 'b1' }] }, error: null });
    expect(await fetchWeatherNudges('v1')).toEqual({ attribution: null, slots: [] });
  });

  it('an error reads as no nudges', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('x') });
    expect(await fetchWeatherNudges('v1')).toEqual({ attribution: null, slots: [] });
  });
});
