import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { WalkInSheet } from '@/components/venue/walk-in-sheet';
import { PITCH_1, PITCH_2 } from '@/lib/venue-today.fixtures';
import type { BoardPitch, Slot } from '@/lib/venue-today';

// Adding a walk-in or phone booking at the counter (spec 13 "Venue
// dashboard"): the server fills in the venue's price, staff may change it,
// and it can be marked paid by cash or card. The price goes to the server
// only when staff changed it.

loadWithFile(Modal, WalkInSheet);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

type PriceResult = { cents: number | null } | { error: string };

async function draw({
  loadPrice = jest.fn(async (_slot: Slot): Promise<PriceResult> => ({ cents: 5000 })),
  onAdd = jest.fn(async (): Promise<string | null> => null),
  pitch = PITCH_2,
  start = '20:00',
}: {
  loadPrice?: jest.Mock<Promise<PriceResult>, [Slot]>;
  onAdd?: jest.Mock<Promise<string | null>, []>;
  pitch?: BoardPitch;
  start?: string;
} = {}) {
  const onClose = jest.fn();
  await render(
    <WalkInSheet
      visible
      onClose={onClose}
      venueId="v1"
      day="2026-11-16"
      pitch={pitch}
      start={start}
      loadPrice={loadPrice}
      onAdd={onAdd}
    />,
  );
  return { loadPrice, onAdd, onClose };
}

async function open(price: number | null = 5000, onAdd = jest.fn(async (): Promise<string | null> => null)) {
  const result = await draw({ loadPrice: jest.fn(async (_slot: Slot): Promise<PriceResult> => ({ cents: price })), onAdd });
  await screen.findByText(/Your price is|No price is set/);
  return result;
}

describe('WalkInSheet', () => {
  it("fills in the venue's price from the server", async () => {
    const { loadPrice } = await open();
    expect(loadPrice).toHaveBeenCalledWith({
      venueId: 'v1',
      day: '2026-11-16',
      start: '20:00',
      end: '21:00',
      format: '5-a-side',
    });
    expect(screen.getByLabelText('Price').props.value).toBe('50.00');
  });

  it('sends no price when staff keep the venue price', async () => {
    const { onAdd, onClose } = await open();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Andreas');
    await act(() => fireEvent.press(screen.getByText('Add, paid cash')));
    expect(onAdd).toHaveBeenCalledWith({
      venueId: 'v1',
      day: '2026-11-16',
      start: '20:00',
      end: '21:00',
      format: '5-a-side',
      source: 'walk_in',
      contactName: 'Andreas',
      contactPhone: '',
      pitchId: 'p2',
      chargedCents: null,
      paidMethod: 'cash',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the typed cents when staff change the price', async () => {
    const { onAdd } = await open();
    await fireEvent.press(screen.getByText('Phone'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Maria');
    await fireEvent.changeText(screen.getByLabelText('Phone number'), '99 000001');
    await fireEvent.changeText(screen.getByLabelText('Price'), '45,50');
    await act(() => fireEvent.press(screen.getByText('Add, not paid yet')));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'phone',
        contactName: 'Maria',
        contactPhone: '99 000001',
        chargedCents: 4550,
        paidMethod: null,
      }),
    );
  });

  it('asks for a price when the venue has none for that slot', async () => {
    const { onAdd } = await open(null);
    expect(screen.getByText('No price is set for this slot. Enter what you charge.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Andreas');
    await act(() => fireEvent.press(screen.getByText('Add, paid card')));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a price, like 45.00.')).toBeTruthy();
  });

  it('typing the venue price another way is still no change: no price is sent', async () => {
    const { onAdd } = await open();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Andreas');
    await fireEvent.changeText(screen.getByLabelText('Price'), '50');
    await act(() => fireEvent.press(screen.getByText('Add, paid cash')));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ chargedCents: null }));
  });

  it('at 23:00 only a 60-minute game is offered, as it must end by midnight', async () => {
    const { loadPrice } = await draw({ start: '23:00' });
    await screen.findByText(/Your price is/);
    expect(loadPrice).toHaveBeenCalledWith(expect.objectContaining({ start: '23:00', end: '24:00' }));
    await act(() => fireEvent.press(screen.getByText('90 min')));
    await act(() => fireEvent.press(screen.getByText('120 min')));
    expect(loadPrice).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Pitch 2 · 23:00–24:00')).toBeTruthy();
  });

  it('at 23:30 no game can end by midnight: it says so and adds nothing', async () => {
    const { loadPrice, onAdd } = await draw({ start: '23:30' });
    expect(screen.getByText('A game starting at 23:30 can’t end by midnight. Pick an earlier time.')).toBeTruthy();
    expect(screen.queryByText('Getting your price…')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Andreas');
    await act(() => fireEvent.press(screen.getByText('Add, paid cash')));
    expect(loadPrice).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a price that cannot be read says why, and a later price clears it', async () => {
    const loadPrice = jest
      .fn<Promise<PriceResult>, [Slot]>()
      .mockResolvedValueOnce({ error: "You're closed that day." })
      .mockResolvedValue({ cents: 7000 });
    await draw({ loadPrice });
    expect(await screen.findByText("Couldn't get your price for this slot. You're closed that day.")).toBeTruthy();
    expect(screen.queryByText(/No price is set/)).toBeNull();
    await act(() => fireEvent.press(screen.getByText('90 min')));
    expect(await screen.findByText('Your price is €70.00. Change it for a discount.')).toBeTruthy();
    expect(screen.queryByText(/Couldn't get your price/)).toBeNull();
  });

  it('a pitch with no formats says so instead of loading forever', async () => {
    const { loadPrice, onAdd } = await draw({ pitch: { ...PITCH_1, formats: [] } });
    expect(screen.getByText('This pitch has no formats set up, so it can’t take a booking yet.')).toBeTruthy();
    expect(screen.queryByText('Getting your price…')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Andreas');
    await act(() => fireEvent.press(screen.getByText('Add, paid cash')));
    expect(loadPrice).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('refuses a price that is not an amount', async () => {
    const { onAdd } = await open();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Andreas');
    await fireEvent.changeText(screen.getByLabelText('Price'), 'free');
    await act(() => fireEvent.press(screen.getByText('Add, paid cash')));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a longer game or another format asks the server for its price again', async () => {
    const { loadPrice } = await open();
    await act(() => fireEvent.press(screen.getByText('90 min')));
    expect(loadPrice).toHaveBeenLastCalledWith(expect.objectContaining({ end: '21:30', format: '5-a-side' }));
    await act(() => fireEvent.press(screen.getByText('7-a-side')));
    expect(loadPrice).toHaveBeenLastCalledWith(expect.objectContaining({ end: '21:30', format: '7-a-side' }));
  });

  it('needs a name', async () => {
    const { onAdd } = await open();
    await act(() => fireEvent.press(screen.getByText('Add, paid cash')));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    const { onClose } = await open(5000, jest.fn(async () => 'That pitch is already taken then. Pick another time or pitch.'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Andreas');
    await act(() => fireEvent.press(screen.getByText('Add, paid cash')));
    expect(screen.getByText('That pitch is already taken then. Pick another time or pitch.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
