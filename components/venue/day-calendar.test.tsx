import { fireEvent, render, screen } from '@testing-library/react-native';

import { DayCalendar } from '@/components/venue/day-calendar';
import { appBooking, dayBoard, phoneBooking, PITCH_1, PITCH_2, walkIn } from '@/lib/venue-today.fixtures';

// The day calendar per pitch (spec 05 section 12, item 1; spec 15 "Venue
// dashboard"): every booking, walk-in, block and condition flag, by pitch
// and half hour. Tapping a booking opens it; tapping a free slot adds a
// walk-in there.

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

async function draw(board = dayBoard()) {
  const onOpenBooking = jest.fn();
  const onAddAt = jest.fn();
  const onMarkAt = jest.fn();
  await render(<DayCalendar board={board} onOpenBooking={onOpenBooking} onAddAt={onAddAt} onMarkAt={onMarkAt} />);
  return { onOpenBooking, onAddAt, onMarkAt };
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

  it('shows a blocked slot as blocked; tapping it opens Block for that pitch and time, not a walk-in', async () => {
    const block = { id: 'blk1', pitch_id: 'p2', starts_at: '09:00:00', ends_at: '10:00:00', reason: null };
    const { onAddAt, onMarkAt } = await draw(dayBoard({ blocks: [block] }));
    const cell = screen.getByTestId('cell-p2-09:00');
    expect(cell).toHaveTextContent('Blocked');
    expect(cell.props.accessibilityLabel).toBe('Pitch 2, 09:00, blocked. Block or flag this slot');
    await fireEvent.press(cell);
    expect(onMarkAt).toHaveBeenCalledWith(PITCH_2, '09:00', 'block');
    expect(onAddAt).not.toHaveBeenCalled();
    expect(screen.getByTestId('cell-p1-09:00')).not.toHaveTextContent('Blocked');
  });

  it('shows a flagged slot and a flagged booking as such; tapping the slot opens Flag for that pitch and time', async () => {
    const flag = { id: 'f1', pitch_id: null, starts_at: '18:00:00', ends_at: '20:00:00', note: null };
    const { onAddAt, onMarkAt } = await draw(dayBoard({ flags: [flag] }));
    const cell = screen.getByTestId('cell-p2-18:00');
    expect(cell).toHaveTextContent('Flagged');
    expect(cell.props.accessibilityLabel).toBe(
      'Pitch 2, 18:00, free, conditions may be unsuitable. Block or flag this slot, or add a walk-in',
    );
    await fireEvent.press(cell);
    expect(onMarkAt).toHaveBeenCalledWith(PITCH_2, '18:00', 'flag');
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

  it('says when no pitches are set up', async () => {
    await draw(dayBoard({ pitches: [], bookings: [] }));
    expect(screen.getByText('No pitches are set up for this venue yet.')).toBeTruthy();
  });
});
