import { fireEvent, render, screen } from '@testing-library/react-native';

import { WherePicker } from '@/components/booking/book-search/where-picker';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const venues = [
  { id: 'v1', name: 'Kamares Sports Centre', city: 'Limassol (Kamares)' },
  { id: 'v2', name: 'Nuevo Campo', city: 'Limassol' },
];

async function renderPicker(overrides: Partial<React.ComponentProps<typeof WherePicker>> = {}) {
  const props = {
    visible: true,
    onClose: jest.fn(),
    towns: ['Limassol', 'Nicosia'],
    venues,
    recents: [{ kind: 'town' as const, town: 'Nicosia' }],
    onPick: jest.fn(),
    onMissingVenue: jest.fn(),
    ...overrides,
  };
  await render(<WherePicker {...props} />);
  return props;
}

describe('WherePicker', () => {
  it('asks where, with Browse all venues and Recent', async () => {
    await renderPicker();
    expect(screen.getByRole('header', { name: 'Where do you want to play?' })).toBeTruthy();
    expect(screen.getByTestId('book-where-all')).toBeTruthy();
    expect(screen.getByText('Recent')).toBeTruthy();
    expect(screen.getByTestId('book-where-recent-0')).toBeTruthy();
  });

  it('hides Recent when there is none', async () => {
    await renderPicker({ recents: [] });
    expect(screen.queryByText('Recent')).toBeNull();
  });

  it('picks all venues, a recent place, a town or a venue', async () => {
    const props = await renderPicker();
    await fireEvent.press(screen.getByTestId('book-where-all'));
    expect(props.onPick).toHaveBeenLastCalledWith({ kind: 'all' });
    await fireEvent.press(screen.getByTestId('book-where-recent-0'));
    expect(props.onPick).toHaveBeenLastCalledWith({ kind: 'town', town: 'Nicosia' });

    await fireEvent.changeText(screen.getByTestId('book-where-input'), 'lim');
    expect(screen.queryByTestId('book-where-all')).toBeNull();
    await fireEvent.press(screen.getByTestId('book-where-town-Limassol'));
    expect(props.onPick).toHaveBeenLastCalledWith({ kind: 'town', town: 'Limassol' });

    await fireEvent.changeText(screen.getByTestId('book-where-input'), 'campo');
    await fireEvent.press(screen.getByTestId('book-where-venue-v2'));
    expect(props.onPick).toHaveBeenLastCalledWith({ kind: 'venue', venueId: 'v2', name: 'Nuevo Campo' });
  });

  it('offers Missing a venue? when nothing matches', async () => {
    const props = await renderPicker();
    await fireEvent.changeText(screen.getByTestId('book-where-input'), 'zzz');
    expect(screen.getByText('No venues found')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('book-where-missing-venue'));
    expect(props.onMissingVenue).toHaveBeenCalled();
  });

  it('closes', async () => {
    const props = await renderPicker();
    await fireEvent.press(screen.getByTestId('book-where-close'));
    expect(props.onClose).toHaveBeenCalled();
  });
});
