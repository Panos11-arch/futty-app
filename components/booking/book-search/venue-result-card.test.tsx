import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { VenueResultCard } from '@/components/booking/book-search/venue-result-card';
import { DISABLED_OPACITY } from '@/components/ui/foundation';
import { loadWithFile } from '@/components/ui/test-utils';
import type { BookResult } from '@/lib/booking-search';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
loadWithFile(Image);

const result: BookResult = {
  venue_id: 'v1',
  name: 'Kamares Sports Centre',
  town: 'Limassol',
  area: 'Kamares',
  photo_path: 'v1/a.jpg',
  photoUrl: 'https://x/a.jpg',
  amenities: ['cafe_or_bar', 'parking'],
  is_favourite: false,
  from_player_cents: 680,
  slots: [
    { day: '2026-11-26', start: '18:00', end: '19:00', player_cents: 680 },
    { day: '2026-11-27', start: '19:00', end: '20:00', player_cents: 680 },
  ],
};

async function renderCard(overrides: Partial<React.ComponentProps<typeof VenueResultCard>> = {}) {
  const props = {
    result,
    severalDays: false,
    timesDisabled: false,
    onOpen: jest.fn(),
    onTime: jest.fn(),
    onFavourite: jest.fn(),
    ...overrides,
  };
  await render(<VenueResultCard {...props} />);
  return props;
}

describe('VenueResultCard', () => {
  it('shows the photo with the name, area · town, the server’s from price, amenities and free times', async () => {
    await renderCard();
    expect(screen.getByText('Kamares Sports Centre')).toBeTruthy();
    expect(screen.getByText('Kamares · Limassol')).toBeTruthy();
    expect(screen.getByText('from €6.80 per player')).toBeTruthy();
    expect(screen.getByText('Café or bar · Parking')).toBeTruthy();
    expect(screen.getByRole('button', { name: '18:00' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '19:00' })).toBeTruthy();
    expect(screen.getByLabelText('Photo of Kamares Sports Centre')).toBeTruthy();
  });

  it('shows the weekday on each time when several days are searched', async () => {
    await renderCard({ severalDays: true });
    expect(screen.getByRole('button', { name: 'Thu 18:00' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fri 19:00' })).toBeTruthy();
  });

  it('shows the dark panel without a photo, and no price, times or amenities when there are none', async () => {
    await renderCard({ result: { ...result, photoUrl: null, from_player_cents: null, slots: [], amenities: [], area: null } });
    expect(screen.queryByLabelText('Photo of Kamares Sports Centre')).toBeNull();
    expect(screen.getByTestId('venue-result-panel')).toBeTruthy();
    expect(screen.getByText('Limassol')).toBeTruthy();
    expect(screen.queryByText(/per player/)).toBeNull();
    expect(screen.queryByTestId('free-venue-v1-slot')).toBeNull();
  });

  it('opens the venue from the card (free-venue-<id>-info) and checkout data from a time', async () => {
    const props = await renderCard();
    expect(screen.getByTestId('free-venue-v1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('free-venue-v1-info'));
    expect(props.onOpen).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('book-venue-v1-time-2026-11-27-1900'));
    expect(props.onTime).toHaveBeenCalledWith(result.slots[1]);
  });

  it('saves and removes a favourite with the heart', async () => {
    const props = await renderCard();
    const heart = screen.getByTestId('book-venue-v1-heart');
    expect(heart.props.accessibilityLabel).toBe('Save Kamares Sports Centre');
    expect(within(heart).getByTestId('icon-heart')).toBeTruthy();
    await fireEvent.press(heart);
    expect(props.onFavourite).toHaveBeenCalledWith(true);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('shows a saved venue with a filled heart', async () => {
    const props = await renderCard({ result: { ...result, is_favourite: true } });
    const heart = screen.getByTestId('book-venue-v1-heart');
    expect(heart.props.accessibilityLabel).toBe('Remove Kamares Sports Centre');
    expect(within(heart).getByTestId('icon-heart.fill')).toBeTruthy();
    await fireEvent.press(heart);
    expect(props.onFavourite).toHaveBeenCalledWith(false);
  });

  it('greys out the times and takes no time taps when booking is blocked; the venue still opens', async () => {
    const props = await renderCard({ timesDisabled: true });
    const row = screen.getByTestId('free-venue-v1-slot');
    expect(row.props.pointerEvents).toBe('none');
    expect(StyleSheet.flatten(row.props.style).opacity).toBe(DISABLED_OPACITY);
    await fireEvent.press(screen.getByTestId('free-venue-v1-info'));
    expect(props.onOpen).toHaveBeenCalled();
  });
});
