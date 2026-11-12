import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { BookSearchView, type BookSearchViewProps } from '@/components/booking/book-search-view';
import { loadWithFile } from '@/components/ui/test-utils';
import type { FreeVenueWithPhoto, SearchOptions } from '@/lib/booking-search';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

loadWithFile(Image);

const options = (six: boolean): SearchOptions => ({
  today: '2026-11-12',
  window_days: 7,
  is_premium: false,
  six_on_five_available: six,
});

const nuevo: FreeVenueWithPhoto = {
  venue_id: 'v1',
  name: 'Nuevo Campo',
  city: 'Nicosia',
  address: null,
  photo_path: null,
  photoUrl: null,
  pitch_cents: 6000,
  player_cents: 680,
  next_starts: ['19:30:00', '20:00:00'],
};
const other: FreeVenueWithPhoto = { ...nuevo, venue_id: 'v2', name: 'Lefkothea', player_cents: 580 };

// 08:00 in Cyprus on 12 November.
const now = new Date('2026-11-12T06:00:00Z');

function props(overrides: Partial<BookSearchViewProps> = {}): BookSearchViewProps {
  return {
    options: { status: 'ready', data: options(false) },
    venue: null,
    results: null,
    onQueryChange: jest.fn(),
    onChoose: jest.fn(),
    onVenueInfo: jest.fn(),
    onRetryOptions: jest.fn(),
    onRetryResults: jest.fn(),
    now,
    ...overrides,
  };
}

async function pickSlot(format = '5-a-side') {
  await fireEvent.press(screen.getByRole('button', { name: '19:00' }));
  await fireEvent.press(screen.getByRole('button', { name: format }));
}

describe('BookSearchView', () => {
  it('shows a date strip of today plus the server’s window (7 days for a standard account)', async () => {
    await render(<BookSearchView {...props()} />);
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thu 19' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fri 20' })).toBeNull();
  });

  it('14 days for Premium', async () => {
    await render(<BookSearchView {...props({ options: { status: 'ready', data: { ...options(false), window_days: 14 } } })} />);
    expect(screen.getByRole('button', { name: 'Thu 26' })).toBeTruthy();
  });

  it('hides times already past in Cyprus today', async () => {
    await render(<BookSearchView {...props()} />);
    expect(screen.queryByRole('button', { name: '07:30' })).toBeNull();
    expect(screen.getByRole('button', { name: '08:30' })).toBeTruthy();
  });

  it('asks the server for venues once a time and format are picked, 60 minutes by default', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    await pickSlot('7-a-side');
    expect(p.onQueryChange).toHaveBeenLastCalledWith({
      day: '2026-11-12',
      start: '19:00',
      minutes: 60,
      format: '7-a-side',
      playersPerSide: 5,
    });
    await fireEvent.press(screen.getByRole('button', { name: '90 min' }));
    expect(p.onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ minutes: 90 }));
  });

  it('hides "players per side" when no venue allows 6 v 6', async () => {
    await render(<BookSearchView {...props()} />);
    await pickSlot();
    expect(screen.queryByLabelText('Players per side')).toBeNull();
  });

  it('shows "players per side" after 5-a-side when a venue allows 6 v 6, and sends 6', async () => {
    const p = props({ options: { status: 'ready', data: options(true) } });
    await render(<BookSearchView {...p} />);
    await pickSlot('7-a-side');
    expect(screen.queryByLabelText('Players per side')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '5-a-side' }));
    expect(screen.getByLabelText('Players per side')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: '6 v 6' }));
    expect(p.onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ playersPerSide: 6 }));
  });

  it('from a venue page, follows that venue’s own 6 v 6 setting', async () => {
    await render(
      <BookSearchView
        {...props({ options: { status: 'ready', data: options(true) }, venue: { id: 'v1', name: 'Nuevo Campo', allowsSixOnFive: false } })}
      />,
    );
    await pickSlot();
    expect(screen.queryByLabelText('Players per side')).toBeNull();
  });

  it('shows the server’s price per player unchanged (680 → €6.80)', async () => {
    await render(<BookSearchView {...props({ results: { status: 'ready', data: [nuevo] } })} />);
    await pickSlot();
    expect(screen.getByText('€6.80 per player')).toBeTruthy();
  });

  it('a card or a time chip opens checkout; "Venue info" opens the venue page', async () => {
    const p = props({ results: { status: 'ready', data: [nuevo] } });
    await render(<BookSearchView {...p} />);
    await pickSlot();
    await fireEvent.press(screen.getByRole('button', { name: /Nuevo Campo, Nicosia/ }));
    expect(p.onChoose).toHaveBeenLastCalledWith(nuevo, '19:00');
    await fireEvent.press(within(screen.getByTestId('free-venue-v1')).getByRole('button', { name: '19:30' }));
    expect(p.onChoose).toHaveBeenLastCalledWith(nuevo, '19:30');
    await fireEvent.press(screen.getByRole('button', { name: 'Venue info' }));
    expect(p.onVenueInfo).toHaveBeenCalledWith('v1');
  });

  it('from a venue page, lists only that venue', async () => {
    await render(
      <BookSearchView
        {...props({ results: { status: 'ready', data: [other, nuevo] }, venue: { id: 'v1', name: 'Nuevo Campo', allowsSixOnFive: false } })}
      />,
    );
    await pickSlot();
    expect(screen.getByText('€6.80 per player')).toBeTruthy();
    expect(screen.queryByText('€5.80 per player')).toBeNull();
  });

  it('says so when nothing is free', async () => {
    await render(<BookSearchView {...props({ results: { status: 'ready', data: [] } })} />);
    await pickSlot();
    expect(screen.getByText('No venue is free at this time. Try another time.')).toBeTruthy();
  });

  it('shows an error with a retry', async () => {
    const p = props({ results: { status: 'error', message: 'Network down' } });
    await render(<BookSearchView {...p} />);
    await pickSlot();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetryResults).toHaveBeenCalled();
  });
});
