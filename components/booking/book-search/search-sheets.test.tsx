// The Book a pitch sheets: Choose your days, At what time?, Format, Filter
// and Missing a venue?.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ChooseDaysSheet } from '@/components/booking/book-search/choose-days-sheet';
import { FilterSheet } from '@/components/booking/book-search/filter-sheet';
import { FormatSheet } from '@/components/booking/book-search/format-sheet';
import { MissingVenueSheet } from '@/components/booking/book-search/missing-venue-sheet';
import { TimeSheet } from '@/components/booking/book-search/time-sheet';
import { defaultBookQuery, type BookSearchQuery } from '@/lib/booking-search';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const options = {
  today: '2026-11-24',
  window_days: 7,
  is_premium: false,
  six_on_five_available: true,
  game_lengths: [60, 90, 120],
  default_game_length: 60,
};
const base: BookSearchQuery = defaultBookQuery(options, null);

describe('ChooseDaysSheet', () => {
  async function renderDays(selected = ['2026-11-24']) {
    const props = { visible: true, onClose: jest.fn(), today: '2026-11-24', windowDays: 7, selected, onApply: jest.fn() };
    await render(<ChooseDaysSheet {...props} />);
    return props;
  }

  it('shows the months with the window’s days to pick and the rest greyed out', async () => {
    await renderDays();
    expect(screen.getByRole('header', { name: 'Choose your days' })).toBeTruthy();
    expect(screen.getByText('November 2026')).toBeTruthy();
    expect(screen.getByText('December 2026')).toBeTruthy();
    expect(screen.getByTestId('book-day-2026-11-24').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('book-day-2026-11-23').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('book-day-2026-12-02').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('picks up to 3 days and applies them', async () => {
    const props = await renderDays();
    for (const d of ['2026-11-26', '2026-11-27', '2026-11-28']) await fireEvent.press(screen.getByTestId(`book-day-${d}`));
    expect(screen.getByTestId('book-day-2026-11-28').props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByTestId('book-days-see-results'));
    expect(props.onApply).toHaveBeenCalledWith(['2026-11-24', '2026-11-26', '2026-11-27']);
  });

  it('can’t apply with no day', async () => {
    const props = await renderDays();
    await fireEvent.press(screen.getByTestId('book-day-2026-11-24'));
    await fireEvent.press(screen.getByTestId('book-days-see-results'));
    expect(props.onApply).not.toHaveBeenCalled();
  });
});

describe('TimeSheet', () => {
  async function renderTime(value = base.window) {
    const props = { visible: true, onClose: jest.fn(), value, onApply: jest.fn() };
    await render(<TimeSheet {...props} />);
    return props;
  }

  it('lists the choices with their hours, the current one ticked', async () => {
    await renderTime();
    expect(screen.getByRole('header', { name: 'At what time?' })).toBeTruthy();
    for (const [label, range] of [
      ['All day', '00:00–23:59'],
      ['Morning', '06:00–12:00'],
      ['Afternoon', '12:00–18:00'],
      ['Evening', '18:00–24:00'],
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(range)).toBeTruthy();
    }
    expect(screen.getByTestId('book-time-preset-all_day').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.queryByTestId('book-time-1900')).toBeNull();
  });

  it('applies a preset', async () => {
    const props = await renderTime();
    await fireEvent.press(screen.getByTestId('book-time-preset-evening'));
    await fireEvent.press(screen.getByTestId('book-time-see-results'));
    expect(props.onApply).toHaveBeenCalledWith({ preset: 'evening', from: '18:00', to: '24:00' });
  });

  it('applies specific hours, keeping the end after the start', async () => {
    const props = await renderTime();
    await fireEvent.press(screen.getByTestId('book-time-preset-specific'));
    await fireEvent.press(screen.getByTestId('book-time-1900'));
    await fireEvent.press(screen.getByTestId('book-time-to-2100'));
    expect(screen.queryByTestId('book-time-to-1900')).toBeNull();
    await fireEvent.press(screen.getByTestId('book-time-see-results'));
    expect(props.onApply).toHaveBeenCalledWith({ preset: 'specific', from: '19:00', to: '21:00' });
  });

  it('moves the end to midnight when the start passes it', async () => {
    const props = await renderTime({ preset: 'specific', from: '18:00', to: '19:00' });
    await fireEvent.press(screen.getByTestId('book-time-2000'));
    await fireEvent.press(screen.getByTestId('book-time-see-results'));
    expect(props.onApply).toHaveBeenCalledWith({ preset: 'specific', from: '20:00', to: '24:00' });
  });
});

describe('FormatSheet', () => {
  it('ticks the current format and picks another', async () => {
    const props = { visible: true, onClose: jest.fn(), value: '5-a-side', onPick: jest.fn() };
    await render(<FormatSheet {...props} />);
    expect(screen.getByTestId('book-format-5-a-side').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId('book-format-7-a-side'));
    expect(props.onPick).toHaveBeenCalledWith('7-a-side');
  });
});

describe('FilterSheet', () => {
  async function renderFilter(overrides: Partial<React.ComponentProps<typeof FilterSheet>> = {}) {
    const props = {
      visible: true,
      onClose: jest.fn(),
      value: base,
      defaults: base,
      lengths: [60, 90, 120],
      sixOnFiveAllowed: true,
      count: 4 as number | null,
      onDraftChange: jest.fn(),
      onApply: jest.fn(),
      ...overrides,
    };
    await render(<FilterSheet {...props} />);
    return props;
  }

  it('shows every filter and the live count', async () => {
    await renderFilter();
    expect(screen.getByRole('header', { name: 'Filter' })).toBeTruthy();
    for (const text of ['Show venues without free times', 'Type', 'Indoor', 'Outdoor', 'Format', 'Players per side', 'Game length']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'See 4 results' })).toBeTruthy();
    expect(screen.getByTestId('book-length-60').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('shows only the lengths the server offers', async () => {
    await renderFilter({ lengths: [60, 90] });
    expect(screen.getByTestId('book-length-90')).toBeTruthy();
    expect(screen.queryByTestId('book-length-120')).toBeNull();
  });

  it('says 1 result, and See results while counting', async () => {
    await renderFilter({ count: 1 });
    expect(screen.getByRole('button', { name: 'See 1 result' })).toBeTruthy();
  });

  it('shows See results while counting', async () => {
    await renderFilter({ count: null });
    expect(screen.getByRole('button', { name: 'See results' })).toBeTruthy();
  });

  it('hides players per side off 5-a-side, or where no venue allows 6 v 6', async () => {
    await renderFilter({ sixOnFiveAllowed: false });
    expect(screen.queryByText('Players per side')).toBeNull();
  });

  it('hides players per side for other formats', async () => {
    await renderFilter({ value: { ...base, format: '7-a-side' } });
    expect(screen.queryByText('Players per side')).toBeNull();
  });

  it('changes the draft, counts it, and applies it', async () => {
    const props = await renderFilter();
    await fireEvent.press(screen.getByTestId('book-filter-unavailable'));
    await fireEvent.press(screen.getByTestId('book-filter-type-indoor'));
    await fireEvent.press(screen.getByTestId('book-filter-pps-6'));
    await fireEvent.press(screen.getByTestId('book-length-90'));
    const draft = { ...base, includeUnavailable: true, types: ['indoor'], playersPerSide: 6, minutes: 90 };
    expect(props.onDraftChange).toHaveBeenLastCalledWith(draft);
    await fireEvent.press(screen.getByTestId('book-filter-see-results'));
    expect(props.onApply).toHaveBeenCalledWith(draft);
  });

  it('unticks a type, and picking another format goes back to 5 per side', async () => {
    const props = await renderFilter({ value: { ...base, types: ['indoor'], playersPerSide: 6 } });
    await fireEvent.press(screen.getByTestId('book-filter-type-indoor'));
    await fireEvent.press(screen.getByTestId('book-filter-format-7-a-side'));
    expect(props.onDraftChange).toHaveBeenLastCalledWith({ ...base, types: [], format: '7-a-side', playersPerSide: 5 });
  });

  it('resets the filters and keeps the place, days and time', async () => {
    const value = {
      ...base,
      days: ['2026-11-26'],
      place: { kind: 'town' as const, town: 'Limassol' },
      includeUnavailable: true,
      types: ['outdoor' as const],
      minutes: 120,
    };
    const props = await renderFilter({ value });
    await fireEvent.press(screen.getByTestId('book-filter-reset'));
    await fireEvent.press(screen.getByTestId('book-filter-see-results'));
    expect(props.onApply).toHaveBeenCalledWith({ ...value, includeUnavailable: false, types: [], minutes: 60 });
  });
});

describe('MissingVenueSheet', () => {
  it('sends the name and town, then closes', async () => {
    const props = { visible: true, onClose: jest.fn(), onSend: jest.fn(() => Promise.resolve()) };
    await render(<MissingVenueSheet {...props} />);
    expect(screen.getByRole('header', { name: 'Missing a venue?' })).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('missing-venue-name'), 'Kamares Arena');
    await fireEvent.changeText(screen.getByTestId('missing-venue-town'), 'Limassol');
    await fireEvent.press(screen.getByTestId('missing-venue-send'));
    expect(props.onSend).toHaveBeenCalledWith('Kamares Arena', 'Limassol');
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it('shows why it wasn’t sent and stays open', async () => {
    const props = {
      visible: true,
      onClose: jest.fn(),
      onSend: jest.fn(() => Promise.reject(new Error('You’ve sent 5 today. Try again tomorrow.'))),
    };
    await render(<MissingVenueSheet {...props} />);
    await fireEvent.changeText(screen.getByTestId('missing-venue-name'), 'A');
    await fireEvent.changeText(screen.getByTestId('missing-venue-town'), 'B');
    await fireEvent.press(screen.getByTestId('missing-venue-send'));
    expect(await screen.findByText('You’ve sent 5 today. Try again tomorrow.')).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('can’t send with an empty field', async () => {
    const props = { visible: true, onClose: jest.fn(), onSend: jest.fn(() => Promise.resolve()) };
    await render(<MissingVenueSheet {...props} />);
    await fireEvent.changeText(screen.getByTestId('missing-venue-name'), 'A');
    await fireEvent.press(screen.getByTestId('missing-venue-send'));
    expect(props.onSend).not.toHaveBeenCalled();
  });
});
