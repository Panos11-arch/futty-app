import { fireEvent, render, screen } from '@testing-library/react-native';

import { DayCalendar } from '@/components/venue/day-calendar';
import { appBooking, dayBoard, phoneBooking, PITCH_1, PITCH_2, walkIn } from '@/lib/venue-today.fixtures';

// The day calendar per pitch (spec 05 section 12, item 1; spec 15 "Venue
// dashboard"): every booking, walk-in, block and condition flag, by pitch
// and half hour. Tapping a booking opens it; tapping a free slot adds a
// walk-in there.

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));
beforeEach(() => {
  mockFontScale = 1;
});
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

/** The board's day (16 November) is tomorrow unless a test says otherwise. */
async function draw(board = dayBoard(), clock = { today: '2026-11-15', now: '12:00' }) {
  const onOpenBooking = jest.fn();
  const onAddAt = jest.fn();
  const onFlagAt = jest.fn();
  const onBlockAt = jest.fn();
  await render(
    <DayCalendar
      board={board}
      clock={clock}
      onOpenBooking={onOpenBooking}
      onAddAt={onAddAt}
      onFlagAt={onFlagAt}
      onBlockAt={onBlockAt}
    />,
  );
  return { onOpenBooking, onAddAt, onFlagAt, onBlockAt };
}

describe('DayCalendar', () => {
  it('shows each pitch as a column', async () => {
    await draw();
    expect(screen.getByText('Pitch 1')).toBeTruthy();
    expect(screen.getByText('Pitch 2')).toBeTruthy();
  });

  it('labels walk-ins and phone bookings, with the amounts the server sent', async () => {
    await draw(dayBoard({ bookings: [appBooking(), walkIn(), phoneBooking()] }));
    const walk = screen.getByTestId('booking-b-walk');
    expect(walk).toHaveTextContent(/Walk-in/);
    expect(walk).toHaveTextContent(/Andreas/);
    expect(walk).toHaveTextContent(/Paid cash · €45\.50/);
    const phone = screen.getByTestId('booking-b-phone');
    expect(phone).toHaveTextContent(/Phone/);
    expect(phone).toHaveTextContent(/Not paid · €50\.00/);
    const app = screen.getByTestId('booking-b-app');
    expect(app).toHaveTextContent(/App/);
    expect(app).toHaveTextContent(/7 of 10 in · 1 unpaid · 2 cash to tick/);
  });

  it('opens a booking in one tap', async () => {
    const { onOpenBooking } = await draw();
    fireEvent.press(screen.getByTestId('booking-b-walk'));
    expect(onOpenBooking).toHaveBeenCalledWith(walkIn());
  });

  it('adds a walk-in at a free slot in one tap', async () => {
    const { onAddAt } = await draw();
    fireEvent.press(screen.getByTestId('cell-p1-19:30'));
    expect(onAddAt).toHaveBeenCalledWith(PITCH_1, '19:30');
  });

  it('shows a blocked slot as blocked; tapping it offers to remove that block, not a new block or a walk-in', async () => {
    const block = { id: 'blk1', pitch_id: 'p2', starts_at: '09:00:00', ends_at: '10:00:00', reason: null };
    const { onAddAt, onFlagAt, onBlockAt } = await draw(dayBoard({ blocks: [block] }));
    const cell = screen.getByTestId('cell-p2-09:00');
    expect(cell).toHaveTextContent('Blocked');
    expect(cell.props.accessibilityLabel).toBe('Pitch 2, 09:00, blocked. Remove the block');
    await fireEvent.press(cell);
    expect(onBlockAt).toHaveBeenCalledWith(block);
    expect(onFlagAt).not.toHaveBeenCalled();
    expect(onAddAt).not.toHaveBeenCalled();
    expect(screen.getByTestId('cell-p1-09:00')).not.toHaveTextContent('Blocked');
  });

  it('shows a flagged slot and a flagged booking as such; tapping the slot opens Flag for that pitch and time', async () => {
    const flag = { id: 'f1', pitch_id: null, starts_at: '18:00:00', ends_at: '20:00:00', note: null };
    const { onAddAt, onFlagAt } = await draw(dayBoard({ flags: [flag] }));
    const cell = screen.getByTestId('cell-p2-18:00');
    expect(cell).toHaveTextContent('Flagged');
    expect(cell.props.accessibilityLabel).toBe(
      'Pitch 2, 18:00, free, conditions may be unsuitable. Block or flag this slot, or add a walk-in',
    );
    await fireEvent.press(cell);
    expect(onFlagAt).toHaveBeenCalledWith(PITCH_2, '18:00');
    expect(onAddAt).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-b-app')).toHaveTextContent(/Conditions may be unsuitable/);
    expect(screen.getByTestId('booking-b-walk')).not.toHaveTextContent(/Conditions may be unsuitable/);
  });

  it('a flag on one slot only marks the bookings under it', async () => {
    const flag = { id: 'f1', pitch_id: 'p1', starts_at: '18:00:00', ends_at: '18:30:00', note: null };
    const later = appBooking({ id: 'b-later', start_time: '19:00:00', end_time: '20:00:00' });
    await draw(dayBoard({ flags: [flag], bookings: [appBooking(), later, walkIn({ start_time: '18:00:00', end_time: '19:00:00' })] }));
    expect(screen.getByTestId('booking-b-app')).toHaveTextContent(/Conditions may be unsuitable/);
    expect(screen.getByTestId('booking-b-later')).not.toHaveTextContent(/Conditions may be unsuitable/);
    // Same time, other pitch.
    expect(screen.getByTestId('booking-b-walk')).not.toHaveTextContent(/Conditions may be unsuitable/);
    expect(screen.getByTestId('cell-p2-18:00')).not.toHaveTextContent('Flagged');
    expect(screen.getByTestId('cell-p1-19:00')).not.toHaveTextContent('Flagged');
  });

  it('a closed pitch takes no walk-in', async () => {
    const { onAddAt } = await draw(dayBoard({ pitches: [PITCH_1, { ...PITCH_2, is_open: false }] }));
    expect(screen.getByText('Closed')).toBeTruthy();
    fireEvent.press(screen.getByTestId('cell-p2-09:00'));
    expect(onAddAt).not.toHaveBeenCalled();
  });

  it('never offers a start time that cannot end by midnight: 23:30 takes no walk-in, 23:00 does', async () => {
    const { onAddAt } = await draw(dayBoard({ bookings: [] }));
    const last = screen.getByTestId('cell-p1-23:30');
    expect(last.props.accessibilityLabel).toBe('Pitch 1, 23:30, too late to start a game');
    fireEvent.press(last);
    expect(onAddAt).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('cell-p1-23:00'));
    expect(onAddAt).toHaveBeenCalledWith(PITCH_1, '23:00');
  });

  it('past slots today take no tap, in Cyprus time; a half hour still running does', async () => {
    const block = { id: 'blk1', pitch_id: 'p2', starts_at: '09:00:00', ends_at: '10:00:00', reason: null };
    const flag = { id: 'f1', pitch_id: 'p2', starts_at: '17:00:00', ends_at: '17:30:00', note: null };
    const { onAddAt, onFlagAt, onBlockAt } = await draw(dayBoard({ blocks: [block], flags: [flag] }), {
      today: '2026-11-16',
      now: '18:10',
    });
    const past = screen.getByTestId('cell-p1-17:30');
    expect(past.props.accessibilityLabel).toBe('Pitch 1, 17:30, past');
    fireEvent.press(past);
    fireEvent.press(screen.getByTestId('cell-p2-09:00'));
    fireEvent.press(screen.getByTestId('cell-p2-17:00'));
    expect(onAddAt).not.toHaveBeenCalled();
    expect(onBlockAt).not.toHaveBeenCalled();
    expect(onFlagAt).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('cell-p2-18:00'));
    expect(onAddAt).toHaveBeenCalledWith(PITCH_2, '18:00');
  });

  it('every slot of an earlier day is past', async () => {
    const { onAddAt } = await draw(dayBoard({ bookings: [] }), { today: '2026-11-17', now: '06:00' });
    fireEvent.press(screen.getByTestId('cell-p1-23:00'));
    expect(onAddAt).not.toHaveBeenCalled();
  });

  it('a booking that starts before 07:00 is drawn from 07:00 with an earlier-start note', async () => {
    await draw(dayBoard({ bookings: [appBooking({ id: 'b-early', start_time: '06:00:00', end_time: '07:30:00' })] }));
    const early = screen.getByTestId('booking-b-early');
    expect(early).toHaveTextContent(/App · 06:00–07:30/);
    expect(early).toHaveTextContent(/Earlier start/);
  });

  it('rows grow with large text instead of clipping', async () => {
    await draw();
    expect(screen.getByTestId('cell-p1-19:30')).toHaveStyle({ height: 44 });
    mockFontScale = 2;
    await draw();
    expect(screen.getAllByTestId('cell-p1-19:30').at(-1)).toHaveStyle({ height: 88 });
  });

  it('says when no pitches are set up', async () => {
    await draw(dayBoard({ pitches: [], bookings: [] }));
    expect(screen.getByText('No pitches are set up for this venue yet.')).toBeTruthy();
  });
});
