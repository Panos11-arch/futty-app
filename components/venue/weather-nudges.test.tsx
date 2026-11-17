import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { loadWithFile } from '@/components/ui/test-utils';
import { WeatherNudgesList } from '@/components/venue/weather-nudges';
import type { WeatherNudge } from '@/lib/weather';
import { ATTRIBUTION, CALM_FORECAST } from '@/lib/weather.fixtures';

// P11 (left out of P6): the Today screen nudges the venue when the forecast
// for one of its booked slots is bad at least 12 hours before kickoff (spec
// 13 "Venue condition warning"), with one tap to flag that slot. Which slots
// qualify is the server's call (venue_weather_slots and venue-weather); the
// list shows what it returns.

loadWithFile(Image);

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const BAD: WeatherNudge = {
  booking_id: 'b-bad',
  day: '2026-11-21',
  start: '18:00',
  end: '19:00',
  pitch_ids: ['p1'],
  forecast: { ...CALM_FORECAST, heavy_rain: true, wind_kmh: 45, warnings: ['heavy_rain', 'wind'] },
};

describe('WeatherNudgesList', () => {
  it('a bad slot 12h+ ahead: shown with what is forecast, and one tap flags it', async () => {
    const onFlag = jest.fn();
    await render(<WeatherNudgesList nudges={{ attribution: ATTRIBUTION, slots: [BAD] }} today="2026-11-20" busy={null} onFlag={onFlag} />);
    expect(screen.getByText('Bad forecast for a booked game')).toBeTruthy();
    expect(screen.getByText('Tomorrow 18:00–19:00')).toBeTruthy();
    expect(screen.getByText('Heavy rain, wind 45 km/h')).toBeTruthy();
    fireEvent.press(screen.getByText('Flag conditions'));
    expect(onFlag).toHaveBeenCalledWith(BAD);
  });

  it('with Apple\'s mark and the data-sources link', async () => {
    await render(<WeatherNudgesList nudges={{ attribution: ATTRIBUTION, slots: [BAD] }} today="2026-11-20" busy={null} onFlag={jest.fn()} />);
    expect(screen.getByLabelText('Apple Weather')).toBeTruthy();
    expect(screen.getByText('Data sources')).toBeTruthy();
  });

  it('several slots: one row each', async () => {
    const other = { ...BAD, booking_id: 'b-2', day: '2026-11-22', start: '20:00', end: '21:00' };
    await render(
      <WeatherNudgesList nudges={{ attribution: ATTRIBUTION, slots: [BAD, other] }} today="2026-11-20" busy={null} onFlag={jest.fn()} />,
    );
    expect(screen.getAllByText('Flag conditions')).toHaveLength(2);
  });

  it('no bad slot (a good forecast is never returned): nothing', async () => {
    await render(<WeatherNudgesList nudges={{ attribution: ATTRIBUTION, slots: [] }} today="2026-11-20" busy={null} onFlag={jest.fn()} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('not loaded: nothing', async () => {
    await render(<WeatherNudgesList nudges={null} today="2026-11-20" busy={null} onFlag={jest.fn()} />);
    expect(screen.toJSON()).toBeNull();
  });
});
