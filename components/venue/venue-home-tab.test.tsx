// S17: the venue page's Home tab gets the venue on a map and today's weather
// there (spec 15 section 0.6: info, Directions · Website · Call, map, weather,
// hours, ...). Each is hidden when the venue has no coordinates or there is
// no forecast; with neither and nothing else, the tab's empty state.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { loadWithFile } from '@/components/ui/test-utils';
import { VenueHomeTab, type VenueHomeProps } from '@/components/venue/venue-home-tab';
import type { GameWeather } from '@/lib/weather';
import { ATTRIBUTION, CALM_FORECAST } from '@/lib/weather.fixtures';
import type { VenuePageData } from '@/lib/venue-page';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

loadWithFile(Image);

const data: VenuePageData = {
  venue: {
    id: 'v1',
    name: 'Nuevo Campo',
    city: 'Limassol',
    address: 'Germasogeia',
    google_maps_link: null,
    phone: null,
    website: null,
    instagram: null,
    is_live: true,
  },
  bookable: true,
  cancellation: { fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 },
  photos: [],
  amenities: [],
  pitches: [],
  prices: [],
  hours: [],
  offers: [],
  menu: [],
};

const NOW = { day: '2026-11-27', start: '14:00', end: '15:00' };
const today: GameWeather = {
  attribution: ATTRIBUTION,
  window: { ...NOW, status: 'forecast', forecast: { ...CALM_FORECAST, temp_min_c: 22, temp_max_c: 22, condition: 'Clear' } },
};

function home(over: Partial<VenueHomeProps> = {}): VenueHomeProps {
  return {
    highlights: { status: 'ready', data: { topPlayers: [], results: [] } },
    onRetry: jest.fn(),
    onPlayer: jest.fn(),
    onTeam: jest.fn(),
    coordinates: { latitude: 34.69, longitude: 33.09 },
    weather: { weather: today, loading: false },
    onMap: jest.fn(),
    ...over,
  };
}

async function renderHome(props: VenueHomeProps, onBookTab = jest.fn()) {
  await render(<VenueHomeTab data={data} photoUrls={{}} home={props} onBookTab={onBookTab} />);
}

describe('Venue Home tab: map and today\'s weather (S17)', () => {
  it('the venue on a map, then today\'s weather with Apple\'s mark', async () => {
    await renderHome(home());
    expect(screen.getByTestId('venue-map')).toBeTruthy();
    expect(screen.getByTestId('venue-map-pin')).toBeTruthy();
    expect(screen.getByText('Weather')).toBeTruthy();
    expect(screen.getByText('22° · Clear at 14:00')).toBeTruthy();
    expect(screen.getByLabelText('Apple Weather')).toBeTruthy();
    expect(screen.queryByText('Nothing here yet.')).toBeNull();
  });

  it('tapping the map or its pin opens Directions', async () => {
    const props = home();
    await renderHome(props);
    await fireEvent.press(screen.getByTestId('venue-map'));
    await fireEvent.press(screen.getByTestId('venue-map-pin'));
    expect(props.onMap).toHaveBeenCalledTimes(2);
  });

  it('the map is centred on the venue', async () => {
    await renderHome(home());
    const region = JSON.parse(screen.getByTestId('venue-map').props.accessibilityHint);
    expect(region).toMatchObject({ latitude: 34.69, longitude: 33.09 });
  });

  it('no coordinates: no map, and no weather (the server has none to give)', async () => {
    await renderHome(home({ coordinates: null, weather: { weather: { attribution: null, window: { ...NOW, status: 'unavailable' } }, loading: false } }));
    expect(screen.queryByTestId('venue-map')).toBeNull();
    expect(screen.queryByTestId('weather-strip')).toBeNull();
  });

  it('no WeatherKit (unavailable): the map stays, the weather is hidden', async () => {
    await renderHome(home({ weather: { weather: { attribution: null, window: { ...NOW, status: 'unavailable' } }, loading: false } }));
    expect(screen.getByTestId('venue-map')).toBeTruthy();
    expect(screen.queryByText('Weather')).toBeNull();
  });

  it('while the weather loads: a placeholder', async () => {
    await renderHome(home({ weather: { weather: null, loading: true } }));
    expect(screen.getByTestId('weather-strip-loading')).toBeTruthy();
  });

  it('nothing at all: the empty state and its one button', async () => {
    const onBookTab = jest.fn();
    await renderHome(
      home({ coordinates: null, weather: { weather: { attribution: null, window: { ...NOW, status: 'unavailable' } }, loading: false } }),
      onBookTab,
    );
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Book a time'));
    expect(onBookTab).toHaveBeenCalled();
  });
});
