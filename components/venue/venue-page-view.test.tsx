import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { loadWithFile } from '@/components/ui/test-utils';
import { VenuePageView } from '@/components/venue/venue-page-view';
import type { VenuePageState } from '@/lib/use-venue-page';
import type { VenuePageData } from '@/lib/venue-page';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
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
};

const full: VenuePageData = {
  ...bare,
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
  prices: [{ format: '5-a-side', hour_cents: 6000, peak_hour_cents: 7000, weekend_hour_cents: null }],
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

const ready = (data: VenuePageData, photoUrls: Record<string, string> = {}): VenuePageState => ({
  status: 'ready',
  data,
  photoUrls,
});

const props = () => ({ onRetry: jest.fn(), onDirections: jest.fn(), onBook: jest.fn() });

describe('VenuePageView', () => {
  it('loading: skeletons in the shape of the page, no spinner and no Book bar', async () => {
    await render(<VenuePageView state={{ status: 'loading' }} {...props()} />);
    expect(screen.getByTestId('venue-page-loading')).toBeTruthy();
    expect(screen.getAllByTestId('skeleton-block').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('sticky-action-bar')).toBeNull();
  });

  it('no photos: the initials block, no empty sections, and the Book bar off with "Not taking bookings yet"', async () => {
    const p = props();
    await render(<VenuePageView state={ready(bare)} {...p} />);
    expect(screen.getByTestId('venue-gallery-placeholder')).toBeTruthy();
    expect(screen.getByText('NC')).toBeTruthy();
    expect(screen.queryByTestId('venue-gallery-photo')).toBeNull();
    expect(screen.getByText('Nuevo Campo')).toBeTruthy();
    expect(screen.getByText('2 Aristidou Street, Latsia, Nicosia (Strovolos)')).toBeTruthy();
    for (const section of ['Amenities', 'Pitches', 'Prices', 'After the game']) {
      expect(screen.queryByText(section)).toBeNull();
    }
    expect(screen.getByText('Cancellation')).toBeTruthy();
    expect(screen.getByTestId('weather-strip-slot')).toBeTruthy();

    const book = screen.getByRole('button', { name: 'Not taking bookings yet' });
    expect(book.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(book);
    expect(p.onBook).not.toHaveBeenCalled();
  });

  it('full: gallery, amenities, pitches, prices from the server, rules, offers, and Book', async () => {
    const p = props();
    await render(
      <VenuePageView
        state={ready(full, {
          'V001/a.jpg': 'https://signed/a',
          'V001/b.jpg': 'https://signed/b',
          'V001/items/lemonade.jpg': 'https://signed/l',
        })}
        {...p}
      />,
    );
    expect(screen.getAllByTestId('venue-gallery-photo')).toHaveLength(2);
    expect(screen.getByLabelText('Photo 1 of 2 of Nuevo Campo')).toBeTruthy();
    expect(screen.queryByTestId('venue-gallery-placeholder')).toBeNull();

    expect(screen.getByLabelText('Parking, free')).toBeTruthy();
    expect(screen.getByTestId('icon-car.fill')).toBeTruthy();
    expect(screen.getByLabelText('Showers')).toBeTruthy();
    expect(screen.getByLabelText('Physio on Saturdays')).toBeTruthy();

    expect(screen.getByText('Pitch 1')).toBeTruthy();
    expect(screen.getByText('5-a-side · Artificial grass · Outdoor · 5-a-side')).toBeTruthy();
    expect(screen.getByText('€60.00 per hour')).toBeTruthy();
    expect(screen.getByText('Peak €70.00')).toBeTruthy();

    expect(screen.getByText(/Cancel within 1 hour of paying/)).toBeTruthy();
    expect(screen.getByText(/€1\.00 is kept/)).toBeTruthy();
    expect(screen.getByText(/Less than 6 hours before kickoff/)).toBeTruthy();

    expect(screen.getByText('Lemonade')).toBeTruthy();
    expect(screen.getByText('€2.50')).toBeTruthy();
    expect(screen.getByText('Lemonade after your match')).toBeTruthy();
    expect(screen.getByText('Mon–Fri, 15:00–00:00')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Directions' }));
    expect(p.onDirections).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Book' }));
    expect(p.onBook).toHaveBeenCalledTimes(1);
  });

  it('the cancellation lines follow the server\'s numbers', async () => {
    await render(
      <VenuePageView
        state={ready({ ...bare, cancellation: { fee_cents: 150, free_minutes: 90, refund_cutoff_hours: 12 } })}
        {...props()}
      />,
    );
    expect(screen.getByText(/Cancel within 90 minutes of paying.*more than 12 hours before kickoff/)).toBeTruthy();
    expect(screen.getByText(/€1\.50 is kept/)).toBeTruthy();
    expect(screen.getByText('Less than 12 hours before kickoff, there are no refunds.')).toBeTruthy();
  });

  it('a photo the server couldn\'t sign is left out', async () => {
    await render(<VenuePageView state={ready(full, { 'V001/b.jpg': 'https://signed/b' })} {...props()} />);
    expect(screen.getAllByTestId('venue-gallery-photo')).toHaveLength(1);
  });

  it('a venue players can\'t see says so', async () => {
    await render(<VenuePageView state={{ status: 'not_found' }} {...props()} />);
    expect(screen.getByText("This venue isn't on Futty")).toBeTruthy();
    expect(screen.queryByTestId('sticky-action-bar')).toBeNull();
  });

  it('an error shows inline with a retry', async () => {
    const p = props();
    await render(<VenuePageView state={{ status: 'error', message: 'network' }} {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });
});
