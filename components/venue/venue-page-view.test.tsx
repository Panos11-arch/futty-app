import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { loadWithFile } from '@/components/ui/test-utils';
import { VenuePageView, type VenuePageViewProps } from '@/components/venue/venue-page-view';
import type { BookSelection } from '@/lib/venue-book';
import type { VenueHighlights } from '@/lib/venue-highlights';
import type { VenuePageState } from '@/lib/use-venue-page';
import type { VenuePageData } from '@/lib/venue-page';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
// The view only formats; offerPrices' module also holds A8's server calls.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

loadWithFile(Image);

const bare: VenuePageData = {
  venue: {
    id: 'v1',
    name: 'Nuevo Campo',
    city: 'Nicosia (Strovolos)',
    address: '2 Aristidou Street, Latsia',
    google_maps_link: null,
    phone: null,
    website: null,
    instagram: null,
    is_live: true,
  },
  bookable: false,
  cancellation: { fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 },
  photos: [],
  amenities: [],
  pitches: [],
  prices: [],
  hours: [],
  offers: [],
  menu: [],
};

const full: VenuePageData = {
  ...bare,
  venue: { ...bare.venue, phone: '+357 22 123456', website: 'nuevocampo.example.com' },
  bookable: true,
  photos: [
    { storage_path: 'V001/a.jpg', pitch_id: null },
    { storage_path: 'V001/b.jpg', pitch_id: null },
  ],
  amenities: [
    { kind: 'parking', note: 'free' },
    { kind: 'showers', note: null },
    { kind: 'other', note: 'Physio on Saturdays' },
  ],
  pitches: [
    {
      id: 'p1',
      name: 'Pitch 1',
      size: '5-a-side',
      formats: ['5-a-side'],
      surface: 'Artificial grass',
      indoor: false,
      description: null,
      is_open: true,
    },
  ],
  prices: [{ format: '5-a-side', hour_cents: 6000 }],
  hours: [{ weekday: 1, opens: '15:00:00', closes: '23:00:00' }],
  offers: [
    {
      id: 'o1',
      name: 'Lemonade',
      description: null,
      price_cents: 300,
      offer_text: 'Lemonade after your match',
      offer_price_cents: 250,
      photo_path: 'V001/items/lemonade.jpg',
      available_from: '15:00:00',
      available_to: '23:59:59',
      available_weekdays: [1, 2, 3, 4, 5],
    },
  ],
};

const urls = {
  'V001/a.jpg': 'https://signed/a',
  'V001/b.jpg': 'https://signed/b',
  'V001/items/lemonade.jpg': 'https://signed/l',
};

const ready = (data: VenuePageData, photoUrls: Record<string, string> = {}): VenuePageState => ({
  status: 'ready',
  data,
  photoUrls,
});

const highlights: VenueHighlights = {
  topPlayers: [{ profileId: 'pl1', name: 'Andreas K', kit: null, rating: '8.3', matches: 4 }],
  results: [
    {
      matchId: 'm1',
      day: 'Fri 20 Nov',
      sides: [
        { label: 'Lions', teamId: 't1', score: 4 },
        { label: 'Bibs', teamId: null, score: 0 },
      ],
    },
  ],
};

const selection: BookSelection = { day: '2026-11-26', start: null, minutes: 60, format: '5-a-side', playersPerSide: 5 };
const now = new Date('2026-11-26T08:00:00Z');

function props(state: VenuePageState, over: Partial<VenuePageViewProps> = {}): VenuePageViewProps {
  return {
    state,
    tab: 'home',
    onTabChange: jest.fn(),
    onRetry: jest.fn(),
    onBack: jest.fn(),
    onShare: jest.fn(),
    onDirections: jest.fn(),
    onOpenUrl: jest.fn(),
    home: {
      highlights: { status: 'ready', data: { topPlayers: [], results: [] } },
      onRetry: jest.fn(),
      onPlayer: jest.fn(),
      onTeam: jest.fn(),
    },
    book: {
      options: { status: 'ready', data: { today: '2026-11-26', window_days: 6, is_premium: false, six_on_five_available: false } },
      formats: { status: 'ready', formats: ['5-a-side', '7-a-side'], pitchCount: 2 },
      slots: {
        status: 'ready',
        slots: [
          { start: '18:00', end: '19:00', available: false, priceCents: null },
          { start: '19:00', end: '20:00', available: true, priceCents: 6000 },
          { start: '20:00', end: '21:00', available: true, priceCents: 6000 },
        ],
      },
      pitches: null,
      selection,
      onSelect: jest.fn(),
      pitchKey: null,
      onPitch: jest.fn(),
      onContinue: jest.fn(),
      onRetry: jest.fn(),
      now,
    },
    ...over,
  };
}

const pitches = {
  status: 'ready' as const,
  data: [
    { pitch_ids: ['p2'], label: 'Pitch 2', kind: 'pitch' as const, surface: 'Artificial grass', indoor: false, price_cents: 6000 },
    { pitch_ids: ['p3'], label: 'Pitch 3', kind: 'pitch' as const, surface: 'Artificial grass', indoor: true, price_cents: 6000 },
  ],
};

describe('VenuePageView: the frame', () => {
  it('loading: skeletons in the shape of the page, no Continue bar', async () => {
    await render(<VenuePageView {...props({ status: 'loading' })} />);
    expect(screen.getByTestId('venue-page-loading')).toBeTruthy();
    expect(screen.getAllByTestId('skeleton-block').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('venue-book')).toBeNull();
  });

  it('a venue players can\'t see says so; an error has Try again', async () => {
    await render(<VenuePageView {...props({ status: 'not_found' })} />);
    expect(screen.getByText("This venue isn't on Futty")).toBeTruthy();
    const p = props({ status: 'error', message: 'network' });
    await render(<VenuePageView {...p} />);
    expect(screen.getByText('Could not load this venue.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it('no photos: a placeholder with the initials, and Back and Share over it', async () => {
    const p = props(ready(bare));
    await render(<VenuePageView {...p} />);
    expect(screen.getByTestId('venue-gallery-placeholder')).toBeTruthy();
    expect(screen.getByText('NC')).toBeTruthy();
    expect(screen.queryByTestId('venue-gallery-photo')).toBeNull();
    await fireEvent.press(screen.getByTestId('venue-back'));
    expect(p.onBack).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('venue-share'));
    expect(p.onShare).toHaveBeenCalled();
  });

  it('photos swipe, and a tap opens them full screen', async () => {
    await render(<VenuePageView {...props(ready(full, urls))} />);
    expect(screen.getAllByTestId('venue-gallery-photo')).toHaveLength(2);
    expect(screen.getByLabelText('Photo 1 of 2 of Nuevo Campo')).toBeTruthy();
    expect(screen.queryByTestId('venue-photo-viewer')).toBeNull();
    await fireEvent.press(screen.getAllByTestId('venue-gallery-open')[1]);
    expect(screen.getByTestId('venue-photo-viewer')).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId('venue-photo-viewer')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('venue-photo-viewer')).toBeNull();
  });

  it('a photo the server couldn\'t sign is left out', async () => {
    await render(<VenuePageView {...props(ready(full, { 'V001/b.jpg': 'https://signed/b' }))} />);
    expect(screen.getAllByTestId('venue-gallery-photo')).toHaveLength(1);
  });

  it('the card: name, the area and amenities, and Directions, Website and Call only when known', async () => {
    const p = props(ready(full));
    await render(<VenuePageView {...p} />);
    expect(screen.getByText('Nuevo Campo')).toBeTruthy();
    expect(screen.getByText('2 Aristidou Street, Latsia, Nicosia (Strovolos) · Parking · Showers · Physio on Saturdays')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Directions' }));
    expect(p.onDirections).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Website' }));
    expect(p.onOpenUrl).toHaveBeenCalledWith('https://nuevocampo.example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Call' }));
    expect(p.onOpenUrl).toHaveBeenCalledWith('tel:+35722123456');

    await render(<VenuePageView {...props(ready(bare))} />);
    expect(screen.getByRole('button', { name: 'Directions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Website' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
  });

  it('three tabs only, the chosen one selected; a tap changes tab', async () => {
    const p = props(ready(full), { tab: 'book' });
    await render(<VenuePageView {...p} />);
    expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel)).toEqual(['Home', 'Book', 'Facilities']);
    expect(screen.getByTestId('venue-tab-book').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('venue-tab-home').props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByTestId('venue-tab-facilities'));
    expect(p.onTabChange).toHaveBeenCalledWith('facilities');
    expect(screen.queryByText(/Events|Academy|Open matches/)).toBeNull();
  });
});

describe('VenuePageView: Home', () => {
  it('opening hours, offers, top players and recent results; the map and weather wait for S17', async () => {
    const p = props(ready(full, urls), { home: { ...props(ready(full)).home, highlights: { status: 'ready', data: highlights } } });
    await render(<VenuePageView {...p} />);
    expect(screen.getByText('Opening hours')).toBeTruthy();
    expect(within(screen.getByTestId('venue-hours')).getByText('15:00–23:00')).toBeTruthy();
    expect(within(screen.getByTestId('venue-hours')).getAllByText('Closed')).toHaveLength(6);

    expect(screen.getByText('Lemonade')).toBeTruthy();
    expect(screen.getByText('€2.50')).toBeTruthy();
    expect(screen.getByText('Lemonade after your match')).toBeTruthy();
    expect(screen.getByText('Mon–Fri, 15:00–00:00')).toBeTruthy();
    expect(screen.getByTestId('venue-offer-o1')).toBeTruthy();

    expect(screen.getByText('Top players')).toBeTruthy();
    expect(within(screen.getByTestId('venue-top-player-pl1')).getByText('8.3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('venue-top-player-pl1'));
    expect(p.home.onPlayer).toHaveBeenCalledWith('pl1');

    expect(screen.getByText('Recent results')).toBeTruthy();
    const result = within(screen.getByTestId('venue-result-m1'));
    expect(result.getByText('4 – 0')).toBeTruthy();
    expect(result.getByText('Fri 20 Nov')).toBeTruthy();
    await fireEvent.press(result.getByRole('button', { name: 'Lions' }));
    expect(p.home.onTeam).toHaveBeenCalledWith('t1');
    expect(result.queryByRole('button', { name: 'Bibs' })).toBeNull();

    expect(screen.queryByTestId('venue-map')).toBeNull();
    expect(screen.queryByTestId('venue-weather')).toBeNull();
  });

  it('each part hidden when empty; nothing at all is one line and Book', async () => {
    const p = props(ready(bare));
    await render(<VenuePageView {...p} />);
    for (const title of ['Opening hours', 'After the game', 'Top players', 'Recent results']) {
      expect(screen.queryByText(title)).toBeNull();
    }
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Book a time' }));
    expect(p.onTabChange).toHaveBeenCalledWith('book');
  });

  it('highlights loading shows skeletons; an error is one line with Try again', async () => {
    const base = props(ready(full));
    await render(<VenuePageView {...base} home={{ ...base.home, highlights: { status: 'loading' } }} />);
    expect(screen.getByTestId('venue-highlights-loading')).toBeTruthy();
    await render(
      <VenuePageView {...base} home={{ ...base.home, highlights: { status: 'error', message: 'Could not load this venue. Try again.' } }} />,
    );
    await fireEvent.press(within(screen.getByTestId('venue-highlights-error')).getByRole('button', { name: 'Try again' }));
    expect(base.home.onRetry).toHaveBeenCalled();
  });
});

describe('VenuePageView: Book', () => {
  it('format chips, the day strip, the length, and the free times with taken ones struck through', async () => {
    const p = props(ready(full), { tab: 'book' });
    await render(<VenuePageView {...p} />);
    expect(screen.getByTestId('venue-format-5-a-side').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('venue-format-7-a-side'));
    expect(p.book.onSelect).toHaveBeenLastCalledWith({ ...selection, format: '7-a-side' });

    // Today and the next 6 days (a standard account's window, from the server).
    expect(screen.getAllByTestId(/^venue-day-/)).toHaveLength(7);
    expect(within(screen.getByTestId('venue-day-2026-11-26')).getByText('Thu')).toBeTruthy();
    expect(within(screen.getByTestId('venue-day-2026-11-26')).getByText('26')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('venue-day-2026-11-28'));
    expect(p.book.onSelect).toHaveBeenLastCalledWith({ ...selection, day: '2026-11-28', start: null });

    expect(screen.getByText('Time · 60 min')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('venue-length-90'));
    expect(p.book.onSelect).toHaveBeenLastCalledWith({ ...selection, minutes: 90, start: null });

    const taken = screen.getByTestId('venue-time-1800');
    expect(taken.props.accessibilityState).toMatchObject({ disabled: true });
    expect(taken.props.accessibilityLabel).toBe('18:00, taken');
    expect(within(taken).getByText('18:00')).toHaveStyle({ textDecorationLine: 'line-through' });
    await fireEvent.press(taken);
    expect(p.book.onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ start: '18:00' }));
    await fireEvent.press(screen.getByTestId('venue-time-2000'));
    expect(p.book.onSelect).toHaveBeenLastCalledWith({ ...selection, start: '20:00' });
  });

  it('6 v 6 only where the venue allows it on 5-a-side', async () => {
    const allowing = { ...full, venue: { ...full.venue, allows_6v6_on_5s: true } };
    const p = props(ready(allowing), { tab: 'book' });
    await render(<VenuePageView {...p} />);
    await fireEvent.press(screen.getByTestId('venue-sides-6'));
    expect(p.book.onSelect).toHaveBeenLastCalledWith({ ...selection, playersPerSide: 6, start: null });
    await render(<VenuePageView {...props(ready(full), { tab: 'book' })} />);
    expect(screen.queryByTestId('venue-sides-6')).toBeNull();
  });

  it('a time chosen: the pitches with the server\'s prices, the first preselected, and Continue with the choice', async () => {
    const base = props(ready(full), { tab: 'book' });
    const book = { ...base.book, selection: { ...selection, start: '20:00' }, pitches };
    await render(<VenuePageView {...base} book={book} />);
    expect(within(screen.getByTestId('venue-book-pitch-1')).getByText('Pitch 2')).toBeTruthy();
    expect(within(screen.getByTestId('venue-book-pitch-1')).getByText('€60.00')).toBeTruthy();
    expect(screen.getByTestId('venue-book-pitch-1').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('Thu 26 Nov · 20:00')).toBeTruthy();
    expect(screen.getByText('Pitch 2 · 5-a-side')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('venue-book-pitch-2'));
    expect(book.onPitch).toHaveBeenCalledWith('p3');
    await fireEvent.press(screen.getByTestId('venue-book'));
    expect(book.onContinue).toHaveBeenCalledWith('p2');
  });

  it('the chosen pitch is kept; Continue is off until there is one', async () => {
    const base = props(ready(full), { tab: 'book' });
    await render(<VenuePageView {...base} book={{ ...base.book, selection: { ...selection, start: '20:00' }, pitches, pitchKey: 'p3' }} />);
    expect(screen.getByTestId('venue-book-pitch-2').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('Pitch 3 · 5-a-side')).toBeTruthy();

    await render(<VenuePageView {...base} />);
    expect(screen.getByTestId('venue-book').props.accessibilityState).toMatchObject({ disabled: true });
    await render(<VenuePageView {...base} book={{ ...base.book, selection: { ...selection, start: '20:00' }, pitches: { status: 'ready', data: [] } }} />);
    expect(screen.getByText('No pitch is free at this time. Pick another time.')).toBeTruthy();
    expect(screen.getByTestId('venue-book').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('a venue that isn\'t taking bookings: Continue is off and says so', async () => {
    const p = props(ready(bare), { tab: 'book' });
    await render(<VenuePageView {...p} />);
    const button = screen.getByRole('button', { name: 'Not taking bookings yet' });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('a closed day and a day with no times say so in one line', async () => {
    const base = props(ready(full), { tab: 'book' });
    await render(<VenuePageView {...base} book={{ ...base.book, slots: { status: 'closed' } }} />);
    expect(screen.getByText('Closed this day. Pick another day.')).toBeTruthy();
    await render(<VenuePageView {...base} book={{ ...base.book, slots: { status: 'ready', slots: [] } }} />);
    expect(screen.getByText('No times left this day. Pick another day.')).toBeTruthy();
  });

  it('errors are one line with Try again', async () => {
    const base = props(ready(full), { tab: 'book' });
    await render(<VenuePageView {...base} book={{ ...base.book, slots: { status: 'error', message: 'x' } }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(base.book.onRetry).toHaveBeenCalled();
  });

  it('in debt: the banner with Pay what I owe, and Continue off', async () => {
    const base = props(ready(full), { tab: 'book' });
    const onPayOwed = jest.fn();
    await render(
      <VenuePageView
        {...base}
        book={{ ...base.book, selection: { ...selection, start: '20:00' }, pitches, debtMessage: 'You owe €6.80. Pay it to book.', onPayOwed }}
      />,
    );
    expect(screen.getByText('You owe €6.80. Pay it to book.')).toBeTruthy();
    expect(screen.getByTestId('venue-book').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('keeps the weather strip\'s slot under the pitches', async () => {
    const base = props(ready(full), { tab: 'book' });
    await render(<VenuePageView {...base} />);
    expect(screen.getByTestId('weather-strip-slot')).toBeTruthy();
  });
});

describe('VenuePageView: Facilities', () => {
  it('amenities, the pitches without the format twice, and the food and drink menu', async () => {
    const dish = {
      id: 'm2',
      name: 'Keo beer',
      category: 'Drinks',
      description: null,
      price_cents: 400,
      offer_price_cents: 300,
      is_post_match_offer: true,
      offer_text: 'After your game',
      photo_path: null,
      dietary_tags: null,
    };
    await render(<VenuePageView {...props(ready({ ...full, menu: [dish] }), { tab: 'facilities' })} />);
    expect(screen.getByTestId('venue-amenities')).toBeTruthy();
    expect(screen.getByLabelText('Parking, free')).toBeTruthy();
    expect(screen.getByTestId('icon-car.fill')).toBeTruthy();
    expect(screen.getByLabelText('Physio on Saturdays')).toBeTruthy();
    expect(within(screen.getByTestId('venue-pitch-p1')).getByText('5-a-side · Artificial grass · Outdoor')).toBeTruthy();

    const menu = screen.getByTestId('venue-menu');
    expect(within(menu).getByText('Food and drink')).toBeTruthy();
    expect(within(screen.getByTestId('venue-menu-m2')).getByText('€3.00')).toBeTruthy();
    const was = within(screen.getByTestId('venue-menu-m2')).getByLabelText('was €4.00');
    expect(was).toHaveStyle({ textDecorationLine: 'line-through' });
  });

  it('nothing set up yet is one line', async () => {
    await render(<VenuePageView {...props(ready(bare), { tab: 'facilities' })} />);
    expect(screen.getByText('No facilities listed yet.')).toBeTruthy();
    expect(screen.queryByTestId('venue-menu')).toBeNull();
  });
});
