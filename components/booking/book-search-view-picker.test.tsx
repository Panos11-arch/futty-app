// iOS can't present a sheet while the full-screen "Where do you want to
// play?" picker is still closing, so "Missing a venue?" from the picker
// opens only once the picker says it has gone (Modal onDismiss).
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { BookSearchView, type BookSearchViewProps } from '@/components/booking/book-search-view';
import type { WherePickerProps } from '@/components/booking/book-search/where-picker';
import { defaultBookQuery, type SearchOptions } from '@/lib/booking-search';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
// A stand-in picker: one button for "Missing a venue?", one for iOS saying it has closed.
jest.mock('@/components/booking/book-search/where-picker', () => {
  const { Pressable: P, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    WherePicker: (p: WherePickerProps) => (
      <View>
        {p.visible ? <P testID="stub-missing" onPress={p.onMissingVenue} /> : null}
        <P testID="stub-dismissed" onPress={() => p.onDismissed?.()} />
      </View>
    ),
  };
});

const options: SearchOptions = {
  today: '2026-11-24',
  window_days: 7,
  is_premium: false,
  six_on_five_available: false,
  game_lengths: [60, 90, 120],
  default_game_length: 60,
};

function props(): BookSearchViewProps {
  return {
    options: { status: 'ready', data: options },
    query: defaultBookQuery(options, null),
    onQueryChange: jest.fn(),
    results: { status: 'ready', data: [] },
    refreshing: false,
    onRefresh: jest.fn(),
    onRetryOptions: jest.fn(),
    onRetryResults: jest.fn(),
    filterCount: null,
    onFilterDraft: jest.fn(),
    towns: [],
    venues: [],
    recents: [],
    onPickPlace: jest.fn(),
    onOpenVenue: jest.fn(),
    onTime: jest.fn(),
    onFavourite: jest.fn(() => Promise.resolve()),
    onRequestVenue: jest.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('opens Missing a venue? once the picker has closed', async () => {
  await render(<BookSearchView {...props()} />);
  await fireEvent.press(screen.getByTestId('book-search-field'));
  await fireEvent.press(screen.getByTestId('stub-missing'));
  expect(screen.queryByTestId('missing-venue-name')).toBeNull();
  expect(screen.queryByTestId('stub-missing')).toBeNull();
  await fireEvent.press(screen.getByTestId('stub-dismissed'));
  expect(screen.getByTestId('missing-venue-name')).toBeTruthy();
});

it('does nothing when the picker closes for another reason', async () => {
  await render(<BookSearchView {...props()} />);
  await fireEvent.press(screen.getByTestId('stub-dismissed'));
  expect(screen.queryByTestId('missing-venue-name')).toBeNull();
});
