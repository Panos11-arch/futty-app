import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { MarkSheet } from '@/components/venue/mark-sheet';
import { PITCH_1, PITCH_2 } from '@/lib/venue-today.fixtures';

// Blocking pitches and flagging conditions (spec 13 "Weather, condition
// warnings and blocking pitches"): a day or a time range, on one pitch or
// all. The default (all pitches, all day) takes two taps from the calendar.

loadWithFile(Modal, MarkSheet);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

async function open(mode: 'block' | 'flag') {
  const onBlock = jest.fn(async () => null);
  const onFlag = jest.fn(async () => null);
  const onClose = jest.fn();
  await render(
    <MarkSheet visible mode={mode} pitches={[PITCH_1, PITCH_2]} onClose={onClose} onBlock={onBlock} onFlag={onFlag} />,
  );
  return { onBlock, onFlag, onClose };
}

describe('MarkSheet: opened from a slot on the calendar', () => {
  it('prefills that pitch and half hour, as a time range', async () => {
    const onBlock = jest.fn(async () => null);
    await render(
      <MarkSheet
        visible
        mode="block"
        pitches={[PITCH_1, PITCH_2]}
        initial={{ pitchId: 'p2', start: '09:00', end: '09:30' }}
        onClose={jest.fn()}
        onBlock={onBlock}
        onFlag={jest.fn()}
      />,
    );
    await act(() => fireEvent.press(screen.getByText('Close to new bookings')));
    expect(onBlock).toHaveBeenCalledWith({ pitchId: 'p2', start: '09:00', end: '09:30', reason: '' });
  });

  it('a flagged slot still takes a walk-in from here', async () => {
    const onAddWalkIn = jest.fn();
    await render(
      <MarkSheet
        visible
        mode="flag"
        pitches={[PITCH_1]}
        initial={{ pitchId: 'p1', start: '18:00', end: '18:30' }}
        onAddWalkIn={onAddWalkIn}
        onClose={jest.fn()}
        onBlock={jest.fn()}
        onFlag={jest.fn()}
      />,
    );
    await act(() => fireEvent.press(screen.getByText('Add a walk-in or phone booking here')));
    expect(onAddWalkIn).toHaveBeenCalled();
  });
});

describe('MarkSheet', () => {
  it('blocks every pitch for the day in one tap', async () => {
    const { onBlock, onFlag, onClose } = await open('block');
    expect(screen.getByText("Games already booked stay on. Their players are told you've closed new bookings.")).toBeTruthy();
    await act(() => fireEvent.press(screen.getByText('Close to new bookings')));
    expect(onBlock).toHaveBeenCalledWith({ pitchId: null, start: null, end: null, reason: '' });
    expect(onFlag).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks one pitch for a time range', async () => {
    const { onBlock } = await open('block');
    await fireEvent.press(screen.getByText('Pitch 2'));
    await fireEvent.press(screen.getByText('Time range'));
    await fireEvent.press(screen.getByTestId('from-19:00'));
    await fireEvent.press(screen.getByTestId('to-21:00'));
    await fireEvent.changeText(screen.getByLabelText('Reason (optional)'), 'Resurfacing');
    await act(() => fireEvent.press(screen.getByText('Close to new bookings')));
    expect(onBlock).toHaveBeenCalledWith({ pitchId: 'p2', start: '19:00', end: '21:00', reason: 'Resurfacing' });
  });

  it('flags conditions and tells players', async () => {
    const { onFlag, onBlock } = await open('flag');
    expect(
      screen.getByText('Every player booked then is told. Normal cancellation rules apply.'),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Note (optional)'), 'Waterlogged');
    await act(() => fireEvent.press(screen.getByText('Flag and tell players')));
    expect(onFlag).toHaveBeenCalledWith({ pitchId: null, start: null, end: null, note: 'Waterlogged' });
    expect(onBlock).not.toHaveBeenCalled();
  });

  it('switches between blocking and flagging', async () => {
    const { onFlag } = await open('block');
    await fireEvent.press(screen.getByText('Flag conditions'));
    await act(() => fireEvent.press(screen.getByText('Flag and tell players')));
    expect(onFlag).toHaveBeenCalled();
  });

  it('an end before the start is refused before anything is sent', async () => {
    const { onBlock } = await open('block');
    await fireEvent.press(screen.getByText('Time range'));
    await fireEvent.press(screen.getByTestId('from-20:00'));
    await fireEvent.press(screen.getByTestId('to-19:00'));
    await act(() => fireEvent.press(screen.getByText('Close to new bookings')));
    expect(onBlock).not.toHaveBeenCalled();
    expect(screen.getByText('Pick an end time after the start time.')).toBeTruthy();
  });

  it("shows the server's refusal", async () => {
    const onBlock = jest.fn(async () => 'That day has passed.');
    await render(
      <MarkSheet visible mode="block" pitches={[PITCH_1]} onClose={jest.fn()} onBlock={onBlock} onFlag={jest.fn()} />,
    );
    await act(() => fireEvent.press(screen.getByText('Close to new bookings')));
    expect(screen.getByText('That day has passed.')).toBeTruthy();
  });
});
