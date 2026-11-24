import { fireEvent, render, screen } from '@testing-library/react-native';

import { SavedSearchesList, type SavedSearchesListProps } from '@/components/booking/saved-searches-list';
import type { SavedSearch } from '@/lib/saved-searches';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const dated: SavedSearch = {
  id: 's1',
  day: '2026-11-19',
  weekday: null,
  from_local: '18:00:00',
  to_local: '21:00:00',
  minutes: 60,
  format: '5-a-side',
  city: null,
  area: 'Nicosia (Strovolos)',
  created_at: '2026-11-18T10:00:00Z',
};
const weekly: SavedSearch = {
  ...dated,
  id: 's2',
  day: null,
  weekday: 2,
  to_local: '24:00:00',
  minutes: 90,
  format: null,
  area: null,
  city: 'Limassol',
};

function props(overrides: Partial<SavedSearchesListProps> = {}): SavedSearchesListProps {
  return {
    searches: { status: 'ready', data: [dated, weekly] },
    deletingId: null,
    error: null,
    onDelete: jest.fn(),
    onRetry: jest.fn(),
    onNewSearch: jest.fn(),
    ...overrides,
  };
}

describe('SavedSearchesList', () => {
  it('lists each search with what it looks for', async () => {
    await render(<SavedSearchesList {...props()} />);
    expect(screen.getByText('Thu 19 Nov · 18:00–21:00')).toBeTruthy();
    expect(screen.getByText('60 min · 5-a-side · Nicosia (Strovolos)')).toBeTruthy();
    expect(screen.getByText('Every Tuesday · 18:00–24:00')).toBeTruthy();
    expect(screen.getByText('90 min · Any format · Limassol')).toBeTruthy();
  });

  it('deletes a search at any time', async () => {
    const p = props();
    await render(<SavedSearchesList {...p} />);
    await fireEvent.press(screen.getByTestId('delete-s2'));
    expect(p.onDelete).toHaveBeenCalledWith('s2');
  });

  it('one delete at a time, and a failed one says so', async () => {
    const p = props({ deletingId: 's1', error: 'Couldn’t delete this search. Try again.' });
    await render(<SavedSearchesList {...p} />);
    expect(screen.getByText('Couldn’t delete this search. Try again.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('delete-s2'));
    expect(p.onDelete).not.toHaveBeenCalled();
  });

  // S4: Save left Book a pitch, so a new search starts here.
  it('none yet: one line and New search', async () => {
    const p = props({ searches: { status: 'ready', data: [] } });
    await render(<SavedSearchesList {...p} />);
    expect(screen.getByText('No saved searches yet.')).toBeTruthy();
    expect(screen.queryByText(/Book a pitch/)).toBeNull();
    await fireEvent.press(screen.getByTestId('saved-searches-new'));
    expect(p.onNewSearch).toHaveBeenCalled();
  });

  it('with searches: New search under them', async () => {
    const p = props();
    await render(<SavedSearchesList {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'New search' }));
    expect(p.onNewSearch).toHaveBeenCalled();
  });

  it('a failed load can be retried', async () => {
    const p = props({ searches: { status: 'error', message: 'Couldn’t load your saved searches.' } });
    await render(<SavedSearchesList {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetry).toHaveBeenCalled();
  });
});
