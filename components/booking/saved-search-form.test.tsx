import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import { SavedSearchForm, type SavedSearchFormProps } from '@/components/booking/saved-search-form';
import { draftFromSearch } from '@/lib/saved-searches';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

// Thursday 12 November, 19:00 for 60 minutes, 5-a-side.
const initial = draftFromSearch({ day: '2026-11-12', start: '19:00', minutes: 60, format: '5-a-side' });

function props(overrides: Partial<SavedSearchFormProps> = {}): SavedSearchFormProps {
  return {
    initial,
    today: '2026-11-12',
    windowDays: 7,
    places: {
      status: 'ready',
      data: [
        { city: 'Limassol', areas: [] },
        { city: 'Nicosia', areas: ['Nicosia (Engomi)', 'Nicosia (Strovolos)'] },
      ],
    },
    saving: false,
    error: null,
    onSave: jest.fn(),
    ...overrides,
  };
}

describe('SavedSearchForm', () => {
  it('is prefilled from the booking search and saves it as it is', async () => {
    const p = props();
    await render(<SavedSearchForm {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save this search' }));
    expect(p.onSave).toHaveBeenCalledWith({
      day: '2026-11-12',
      weekday: null,
      from_local: '19:00',
      to_local: '20:00',
      minutes: 60,
      format: '5-a-side',
      city: null,
      area: null,
    });
  });

  it('every week: the weekday of the day searched, or another', async () => {
    const p = props();
    await render(<SavedSearchForm {...p} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Every week' }));
    expect(screen.getByRole('button', { name: 'Thu' }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Sat' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save this search' }));
    expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ day: null, weekday: 6 }));
  });

  it('a wider window, another length, any format, a whole city or one area', async () => {
    const p = props();
    await render(<SavedSearchForm {...p} />);
    await fireEvent.press(screen.getByTestId('from-18:00'));
    await fireEvent.press(screen.getByTestId('to-22:00'));
    await fireEvent.press(screen.getByRole('button', { name: '90 min' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Any' }));
    await fireEvent.press(screen.getByRole('button', { name: 'All of Nicosia' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save this search' }));
    expect(p.onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ from_local: '18:00', to_local: '22:00', minutes: 90, format: null, city: 'Nicosia', area: null }),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Nicosia (Strovolos)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save this search' }));
    expect(p.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ city: null, area: 'Nicosia (Strovolos)' }));
  });

  it('a game that doesn’t fit the window can’t be saved', async () => {
    const p = props();
    await render(<SavedSearchForm {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: '90 min' }));
    expect(screen.getByText('A 90-minute game doesn’t fit between 19:00 and 20:00.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save this search' }));
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal', async () => {
    await render(
      <SavedSearchForm {...props({ error: 'You can save up to 5 searches. Delete one to save this.' })} />,
    );
    expect(screen.getByText('You can save up to 5 searches. Delete one to save this.')).toBeTruthy();
  });

  it('the dated choices are the player’s own booking window', async () => {
    await render(<SavedSearchForm {...props()} />);
    expect(screen.getByRole('button', { name: 'Thu 19' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fri 20' })).toBeNull();
  });

  // QA 24 November, bug 10: the searched time is chosen and in view, not
  // hidden behind 00:00 at the start of each row.
  it('scrolls the From and Until rows to the searched time', async () => {
    await render(<SavedSearchForm {...props()} />);
    expect(screen.getByTestId('from-19:00').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('to-20:00').props.accessibilityState).toMatchObject({ selected: true });
    // React Native's ScrollView mock shares one scrollTo on its prototype.
    const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;
    for (const chip of ['from-19:00', 'to-20:00']) {
      scrollTo.mockClear();
      await fireEvent(screen.getByTestId(chip), 'layout', { nativeEvent: { layout: { x: 1520, y: 0, width: 72, height: 44 } } });
      expect(scrollTo).toHaveBeenCalledTimes(1);
      const { x, animated } = scrollTo.mock.calls[0][0];
      expect(animated).toBe(false);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThanOrEqual(1520);
    }
    // A chip that isn't chosen moves nothing.
    scrollTo.mockClear();
    await fireEvent(screen.getByTestId('from-08:00'), 'layout', { nativeEvent: { layout: { x: 640, y: 0, width: 72, height: 44 } } });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
