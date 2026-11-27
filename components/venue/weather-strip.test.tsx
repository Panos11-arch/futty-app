import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { Linking } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { WeatherStrip } from '@/components/venue/weather-strip';
import type { GameWeather, Warning } from '@/lib/weather';
import { ATTRIBUTION, CALM_FORECAST, forecastWith } from '@/lib/weather.fixtures';

// P11: the weather strip on the venue page, checkout and booking detail
// (spec 13 "Forecast for players"). The server checks app_rules; the strip
// shows the banner when it says a threshold was met, and always shows
// Apple's mark and data-sources link with a forecast.

loadWithFile(Image);

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const GAME = { day: '2026-11-20', start: '18:00', end: '19:00' };
const TAIL = 'The venue may cancel this booking.';
const BANNER = new RegExp(TAIL.replace(/\./g, '\\.'));

const forecast = (f = CALM_FORECAST): GameWeather => ({
  attribution: ATTRIBUTION,
  window: { ...GAME, status: 'forecast', forecast: f },
});

describe('WeatherStrip', () => {
  it.each<[Warning, string]>([
    ['rain_chance', 'Heavy rain forecast.'],
    ['heavy_rain', 'Heavy rain forecast.'],
    ['wind', 'Strong wind forecast.'],
    ['thunderstorm', 'Thunderstorms forecast.'],
    ['heat', 'Extreme heat forecast.'],
  ])('%s met: the banner names it', async (warning, reason) => {
    await render(<WeatherStrip weather={forecast(forecastWith([warning]))} />);
    expect(screen.getByText(`${reason} ${TAIL}`)).toBeTruthy();
  });

  it('several met: all named on one line', async () => {
    await render(<WeatherStrip weather={forecast(forecastWith(['wind', 'rain_chance', 'heat']))} />);
    expect(
      screen.getByText(`Heavy rain forecast. Strong wind forecast. Extreme heat forecast. ${TAIL}`),
    ).toBeTruthy();
  });

  it('below every threshold: the forecast, no banner', async () => {
    await render(<WeatherStrip weather={forecast({ ...CALM_FORECAST, condition: 'Clear' })} />);
    expect(screen.queryByText(BANNER)).toBeNull();
    // S17, image 03: one card, "19° · Clear at 18:00", then rain and wind (spec 13).
    expect(screen.getByText('19° · Clear at 18:00')).toBeTruthy();
    expect(screen.getByText('Rain 10% · Wind 12 km/h')).toBeTruthy();
  });

  it('the Book tab has no heading (image 03); the venue Home tab says "Weather"', async () => {
    await render(<WeatherStrip weather={forecast()} />);
    expect(screen.queryByText('Weather')).toBeNull();
    await render(<WeatherStrip weather={forecast()} title="Weather" />);
    expect(screen.getByText('Weather')).toBeTruthy();
  });

  it('the screen reader reads the card as one line', async () => {
    await render(<WeatherStrip weather={forecast({ ...CALM_FORECAST, condition: 'Clear' })} />);
    expect(screen.getByLabelText('19° · Clear at 18:00. Rain 10% · Wind 12 km/h')).toBeTruthy();
  });

  it('with a forecast, Apple\'s Weather mark and the data-sources link', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<WeatherStrip weather={forecast()} />);
    const mark = screen.getByLabelText('Apple Weather');
    expect([mark.props.source].flat()).toEqual([{ uri: ATTRIBUTION.logoLight }]);
    await fireEvent.press(screen.getByText('Data sources'));
    expect(open).toHaveBeenCalledWith(ATTRIBUTION.legalPageUrl);
  });

  it('beyond the forecast range: "Forecast available closer to the date"', async () => {
    await render(<WeatherStrip weather={{ attribution: null, window: { ...GAME, status: 'out_of_range' } }} />);
    expect(screen.getByText('Forecast available closer to the date')).toBeTruthy();
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('no forecast (no coordinates, Apple down, game over): nothing', async () => {
    for (const status of ['unavailable', 'past'] as const) {
      await render(<WeatherStrip weather={{ attribution: null, window: { ...GAME, status } }} />);
      expect(screen.queryByTestId('weather-strip')).toBeNull();
    }
  });

  it('a forecast without Apple\'s mark is not shown', async () => {
    await render(
      <WeatherStrip weather={{ attribution: null, window: { ...GAME, status: 'forecast', forecast: forecastWith(['wind']) } }} />,
    );
    expect(screen.queryByTestId('weather-strip')).toBeNull();
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('while loading: a placeholder, never a guess', async () => {
    await render(<WeatherStrip weather={null} loading />);
    expect(screen.getByTestId('weather-strip-loading')).toBeTruthy();
  });

  it('nothing asked for: nothing', async () => {
    await render(<WeatherStrip weather={null} />);
    expect(screen.toJSON()).toBeNull();
  });
});
