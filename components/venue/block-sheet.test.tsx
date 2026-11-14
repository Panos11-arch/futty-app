import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { BlockSheet } from '@/components/venue/block-sheet';
import { loadWithFile } from '@/components/ui/test-utils';

// Tapping a blocked slot on the calendar (spec 13 "Blocking pitches";
// removing a block, decided 14 November): it offers to remove that block,
// which only reopens the slot to new bookings.

loadWithFile(Modal, BlockSheet);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const block = { id: 'blk1', pitch_id: 'p2', starts_at: '09:00:00', ends_at: '10:00:00', reason: 'Resurfacing' };

async function open(onRemove = jest.fn(async (): Promise<string | null> => null)) {
  const onClose = jest.fn();
  await render(
    <BlockSheet visible block={block} label="Pitch 2 · 09:00–10:00" onClose={onClose} onRemove={onRemove} />,
  );
  return { onRemove, onClose };
}

describe('BlockSheet', () => {
  it('names the block and says removing it changes no booking', async () => {
    await open();
    expect(screen.getByText('Pitch 2 · 09:00–10:00 · Resurfacing')).toBeTruthy();
    expect(
      screen.getByText('Removing it reopens these slots to new bookings. Games already booked and their money are not changed.'),
    ).toBeTruthy();
    expect(screen.queryByText('Close to new bookings')).toBeNull();
  });

  it('removes that block by its id and closes', async () => {
    const { onRemove, onClose } = await open();
    await act(() => fireEvent.press(screen.getByText('Remove block')));
    expect(onRemove).toHaveBeenCalledWith(block);
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps it on \"Keep it\"", async () => {
    const { onRemove, onClose } = await open();
    await act(() => fireEvent.press(screen.getByText('Keep it')));
    expect(onRemove).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    const { onClose } = await open(jest.fn(async () => 'Something went wrong. Try again.'));
    await act(() => fireEvent.press(screen.getByText('Remove block')));
    expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
