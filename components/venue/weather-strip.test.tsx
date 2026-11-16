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
const BANNER = 'Heavy rain forecast. The venue may cancel this booking.';

const forecast = (f = CALM_FORECAST): GameWeather => ({
  attribution: ATTRIBUTION,
  window: { ...GAME, status: 'forecast', forecast: f },
});

describe('WeatherStrip', () => {
  it.each<Warning>(['rain_chance', 'heavy_rain', 'wind', 'thunderstorm', 'heat'])(
    'any threshold met (%s): the banner',
    async (warning) => {
      await render(<WeatherStrip weather={forecast(forecastWith([warning]))} />);
      expect(screen.getByText(BANNER)).toBeTruthy();
    },
  );

  it('below every threshold: the forecast, no banner', async () => {
    await render(<WeatherStrip weather={forecast()} />);
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.getByText('Rain 10%')).toBeTruthy();
    expect(screen.getByText('Wind 12 km/h')).toBeTruthy();
    expect(screen.getByText('19°C')).toBeTruthy();
  });

  it('with a forecast, Apple\'s Weather mark and the data-sources link', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<WeatherStrip weather={forecast()} />);
    const mark = screen.getByLabelText('Apple Weather');
    expect([mark.props.source].flat()).toEqual([{ uri: ATTRIBUTION.logoLight }]);
    fireEvent.press(screen.getByText('Data sources'));
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
