// S5: the venue page screen (app/venue/[id].tsx) wires the view to the
// server: which tab it opens on, the Book tab's choices, the payment sheet
// on Continue, and where each tap goes.
import { act, render, screen } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';

import VenueScreen from '@/app/venue/[id]';
import type { CheckoutViewProps } from '@/components/booking/checkout-view';
import type { VenuePageViewProps } from '@/components/venue/venue-page-view';

let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockScreenOptions = jest.fn();
let mockView: VenuePageViewProps | null = null;
let mockCheckout: CheckoutViewProps | null = null;
const mockSlotCheckout = jest.fn();
const mockSlots = jest.fn();
const mockWeather = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: ({ options }: { options: unknown }) => (mockScreenOptions(options), null) },
}));
jest.mock('@stripe/stripe-react-native', () => ({ usePaymentSheet: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn() }) }));
jest.mock('@/components/venue/venue-page-view', () => ({
  VenuePageView: (p: VenuePageViewProps) => ((mockView = p), null),
}));
jest.mock('@/components/booking/checkout-view', () => ({
  CheckoutView: (p: CheckoutViewProps) => ((mockCheckout = p), null),
  dayTimeLabel: () => 'Thu 26 Nov · 20:00',
}));
jest.mock('@/components/ui', () => ({
  Sheet: ({ visible, children, title }: { visible: boolean; children: unknown; title: string }) => {
    const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return visible ? (
      <>
        <Text>{title}</Text>
        {children as never}
      </>
    ) : null;
  },
}));
jest.mock('@/components/venue/weather-strip', () => ({ WeatherStrip: () => null }));
const venueData = {
  venue: { id: 'v1', name: 'Nuevo Campo', address: 'Kamares', city: 'Limassol', google_maps_link: null, allows_6v6_on_5s: false },
};
jest.mock('@/lib/use-venue-page', () => ({
  useVenuePage: () => ({ state: { status: 'ready', data: venueData, photoUrls: {} }, reload: jest.fn() }),
}));
jest.mock('@/lib/use-venue-slots', () => ({
  useVenueFormats: () => ({ status: 'ready', formats: ['5-a-side', '7-a-side'], pitchCount: 2 }),
  useVenueSlots: (...a: unknown[]) => (mockSlots(...a), { state: { status: 'idle' }, reload: jest.fn() }),
}));
jest.mock('@/lib/booking-search', () => ({
  ...jest.requireActual('@/lib/booking-search'),
  fetchSearchOptions: jest.fn(),
  useLoad: () => ({
    state: { status: 'ready', data: { today: '2026-11-26', window_days: 6, is_premium: false, six_on_five_available: false } },
    reload: jest.fn(),
  }),
}));
jest.mock('@/lib/use-slot-checkout', () => ({
  useSlotCheckout: (...a: unknown[]) => (
    mockSlotCheckout(...a),
    {
      quote: { status: 'loading' },
      pitches: { status: 'ready', data: [{ pitch_ids: ['p2'], label: 'Pitch 2' }] },
      retry: jest.fn(),
      pay: jest.fn(),
      paying: false,
      error: null,
      bookingHeld: false,
    }
  ),
}));
jest.mock('@/lib/venue-highlights', () => ({ fetchVenueHighlights: jest.fn(() => new Promise(() => undefined)) }));
jest.mock('@/lib/use-owed', () => ({ useDebtBlock: () => ({ message: null, blocked: false }) }));
jest.mock('@/lib/use-weather', () => ({ useGameWeather: (...a: unknown[]) => (mockWeather(...a), { weather: null, loading: false }) }));
jest.mock('@/lib/use-rules', () => ({ useRules: () => undefined }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
const mockCoordinates = jest.fn((_id: string) => ({ latitude: 34.69, longitude: 33.09 }));
jest.mock('@/lib/venue-location', () => ({
  ...jest.requireActual('@/lib/venue-location'),
  useVenueCoordinates: (id: string) => mockCoordinates(id),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockView = null;
  mockCheckout = null;
  mockParams = { id: 'v1' };
});

const view = () => mockView!;

describe('the venue page screen', () => {
  it('opens on Home from anywhere else, with no header over the photos', async () => {
    await render(<VenueScreen />);
    expect(view().tab).toBe('home');
    expect(mockScreenOptions).toHaveBeenLastCalledWith(expect.objectContaining({ headerShown: false }));
  });

  it('from Book a pitch: opens on Book, with the time chosen there', async () => {
    mockParams = { id: 'v1', day: '2026-11-27', start: '20:00', end: '21:30' };
    await render(<VenueScreen />);
    expect(view().tab).toBe('book');
    expect(view().book.selection).toEqual({ day: '2026-11-27', start: '20:00', minutes: 90, format: '5-a-side', playersPerSide: 5 });
    expect(mockSlots).toHaveBeenLastCalledWith('v1', '2026-11-27', '5-a-side', 90, 5);
    expect(mockSlotCheckout).toHaveBeenLastCalledWith(
      { venueId: 'v1', day: '2026-11-27', start: '20:00', end: '21:30', format: '5-a-side', playersPerSide: 5 },
      expect.anything(),
    );
    expect(mockWeather).toHaveBeenLastCalledWith('v1', { day: '2026-11-27', start: '20:00', end: '21:30' });
  });

  it('from Book a pitch with 6 v 6 chosen: keeps it', async () => {
    mockParams = { id: 'v1', tab: 'book', day: '2026-11-27', start: '20:00', end: '21:00', format: '5-a-side', playersPerSide: '6' };
    await render(<VenueScreen />);
    expect(view().book.selection).toEqual({ day: '2026-11-27', start: '20:00', minutes: 60, format: '5-a-side', playersPerSide: 6 });
  });

  it('tab=book opens on Book with today, the first format and no time yet', async () => {
    mockParams = { id: 'v1', tab: 'book' };
    await render(<VenueScreen />);
    expect(view().tab).toBe('book');
    expect(view().book.selection).toEqual({ day: '2026-11-26', start: null, minutes: 60, format: '5-a-side', playersPerSide: 5 });
    expect(view().book.pitches).toBeNull();
    expect(mockSlotCheckout).toHaveBeenLastCalledWith(null, expect.anything());
  });

  it('choosing on Book updates the choice and forgets the pitch tapped', async () => {
    mockParams = { id: 'v1', tab: 'book' };
    await render(<VenueScreen />);
    await act(async () => view().book.onPitch('p3'));
    expect(view().book.pitchKey).toBe('p3');
    await act(async () => view().book.onSelect({ ...view().book.selection, start: '19:00' }));
    expect(view().book.selection.start).toBe('19:00');
    expect(view().book.pitchKey).toBeNull();
  });

  it('Continue opens the payment sheet on the chosen pitch; closing it stays on the page', async () => {
    mockParams = { id: 'v1', day: '2026-11-26', start: '20:00', end: '21:00' };
    await render(<VenueScreen />);
    expect(mockCheckout).toBeNull();
    await act(async () => view().book.onContinue('p2'));
    expect(screen.getByText('Thu 26 Nov · 20:00')).toBeTruthy();
    expect(mockCheckout).toMatchObject({ variant: 'sheet', pitchKey: 'p2', venueName: 'Nuevo Campo' });
  });

  // S20, Team vs team (a friend chat → Book a pitch): the payment sheet starts on half pitch.
  it('Team vs team: the payment sheet starts on half pitch; otherwise its own default', async () => {
    const { armBookingPreselect } = jest.requireActual<typeof import('@/lib/booking-preselect')>('@/lib/booking-preselect');
    mockParams = { id: 'v1', day: '2026-11-26', start: '20:00', end: '21:00' };
    armBookingPreselect({ oppositionTeamId: 't-ben' });
    const team = await render(<VenueScreen />);
    await act(async () => view().book.onContinue('p2'));
    expect(mockCheckout).toMatchObject({ initialKind: 'half' });
    await team.unmount();

    armBookingPreselect({ inviteProfileId: 'p-ben' });
    await render(<VenueScreen />);
    await act(async () => view().book.onContinue('p2'));
    expect(mockCheckout?.initialKind).toBeUndefined();
    armBookingPreselect(null);
  });

  it('Back, Share, Website and Call, a player and a team', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<VenueScreen />);
    view().onBack();
    expect(mockBack).toHaveBeenCalled();
    view().onShare();
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('Nuevo Campo\nKamares, Limassol') });
    view().onOpenUrl('tel:+35722123456');
    expect(open).toHaveBeenCalledWith('tel:+35722123456');
    view().home.onPlayer('pl1');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'pl1' } });
    view().home.onTeam('t1');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 't1' } });
  });

  it('changing tab', async () => {
    await render(<VenueScreen />);
    await act(async () => view().onTabChange('facilities'));
    expect(view().tab).toBe('facilities');
  });
});

describe('S17: the Home tab\'s map and today\'s weather', () => {
  afterEach(() => jest.useRealTimers());

  it('Home: the venue\'s coordinates, and the weather at the venue this hour (Cyprus time)', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-27T12:40:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    await render(<VenueScreen />);
    expect(mockCoordinates).toHaveBeenCalledWith('v1');
    expect(view().home.coordinates).toEqual({ latitude: 34.69, longitude: 33.09 });
    expect(mockWeather).toHaveBeenCalledWith('v1', { day: '2026-11-27', start: '14:00', end: '15:00' });
    expect(view().home.weather).toEqual({ weather: null, loading: false });
  });

  it('other tabs don\'t ask for today\'s weather (only Book\'s chosen time)', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-27T12:40:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    mockParams = { id: 'v1', tab: 'book' };
    await render(<VenueScreen />);
    expect(mockWeather).not.toHaveBeenCalledWith('v1', { day: '2026-11-27', start: '14:00', end: '15:00' });
  });

  it('a tap on the map opens Directions: on Android straight to Google Maps', async () => {
    const { Platform } = jest.requireActual<typeof import('react-native')>('react-native');
    const os = Platform.OS;
    Platform.OS = 'android';
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<VenueScreen />);
    await act(async () => view().home.onMap?.());
    expect(open).toHaveBeenCalledWith(expect.stringContaining('google.com/maps'));
    Platform.OS = os;
  });
});
