import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { SwitchFormat, type SwitchFormatProps } from '@/components/booking/switch-format';
import { loadWithFile } from '@/components/ui/test-utils';
import { switchInfo } from '@/lib/booking-detail.fixtures';
import { switchErrorMessage } from '@/lib/booking-switch';

// The confirm sheet is a Modal: load it with the file, not in the first test.
loadWithFile(Modal, SwitchFormat);

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

function props(overrides: Partial<SwitchFormatProps> = {}): SwitchFormatProps {
  return {
    info: switchInfo({ to_players_per_side: 6, money: 'credit', each_cents: 100, booker_cents: 100 }),
    isBooker: true,
    live: true,
    inGame: true,
    playersPerSide: 5,
    venueName: 'Nuevo Campo',
    onSwitch: jest.fn(async () => null),
    ...overrides,
  };
}

const button = (name: string) => screen.queryByRole('button', { name });

describe('SwitchFormat: who sees it', () => {
  it('the booker who can switch', async () => {
    await render(<SwitchFormat {...props()} />);
    expect(button('Switch to 6 v 6')).toBeTruthy();
    expect(screen.getByText('You can switch once, until Mon 16 Nov at 12:00.')).toBeTruthy();
  });

  it.each([
    ['a player who is not the booker', { isBooker: false }],
    ["the server says it can't switch", { info: switchInfo({ can_switch: false, refusal: 'switch_closed' }) }],
    ['already switched', { info: switchInfo({ switched: true, can_switch: false, to_players_per_side: null }) }],
    ['a booking that can never switch', { info: null }],
    ['the game has started or was cancelled', { live: false }],
  ])('hidden for %s', async (_, overrides) => {
    await render(<SwitchFormat {...props(overrides as Partial<SwitchFormatProps>)} />);
    expect(button('Switch to 6 v 6')).toBeNull();
    expect(button('Switch to 5 v 5')).toBeNull();
    expect(screen.queryByText(/You can switch once/)).toBeNull();
  });
});

describe('SwitchFormat: two taps', () => {
  it('the first tap shows the money, from the server; only the second switches', async () => {
    const p = props();
    await render(<SwitchFormat {...p} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Switch to 6 v 6' }));
    expect(
      screen.getByText("Each player who has paid gets €1.00 back as credit at Nuevo Campo. A payment that's still held gets it when it's taken."),
    ).toBeTruthy();
    expect(screen.getByText('Every player is told.')).toBeTruthy();
    expect(p.onSwitch).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: switch to 6 v 6' }));
    expect(p.onSwitch).toHaveBeenCalledTimes(1);
    expect(p.onSwitch).toHaveBeenCalledWith(6);
  });

  it('6 v 6 -> 5 v 5: what each player pays more, and "Keep 6 v 6" switches nothing', async () => {
    const p = props({ info: switchInfo(), playersPerSide: 6 });
    await render(<SwitchFormat {...p} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Switch to 5 v 5' }));
    expect(
      screen.getByText(
        'Each player who has paid, in the app or in cash at the venue, pays €1.00 more after the match, charged to their card with the top-ups.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep 6 v 6' }));
    expect(p.onSwitch).not.toHaveBeenCalled();
  });

  it('pay-all: no money changes', async () => {
    await render(<SwitchFormat {...props({ info: switchInfo({ to_players_per_side: 6, money: 'none' }) })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Switch to 6 v 6' }));
    expect(screen.getByText('You paid for everyone, so no money changes.')).toBeTruthy();
  });
});

describe("SwitchFormat: the server's refusals", () => {
  it.each([
    ["Kickoff is too close, so this booking can't be switched now.", 'switch_closed'],
    ['This booking has already been switched. A booking can only be switched once.', 'already_switched'],
    ["More than 10 players have joined, so it can't go back to 5 v 5.", 'too_many_players'],
    ['Only the booker can switch this booking.', 'not_booker'],
    ["This venue doesn't allow 6 v 6 on this pitch.", 'six_a_side_not_allowed'],
    ["This booking can't be switched.", 'not_switchable'],
    ['The booking is already that format.', 'already_that_format'],
    ['This booking has been cancelled.', 'booking_cancelled'],
    ['Finish paying for the booking first, then you can switch it.', 'booking_not_confirmed'],
  ])('shows "%s" (%s) in the sheet', async (message, code) => {
    // The screen's onSwitch resolves to lib/booking-switch's words for the code.
    const p = props({ onSwitch: jest.fn(async () => switchErrorMessage(code)) });
    await render(<SwitchFormat {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Switch to 6 v 6' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: switch to 6 v 6' }));
    expect(await screen.findByText(message)).toBeTruthy();
    // The sheet stays open, with the money still shown.
    expect(screen.getByText('Every player is told.')).toBeTruthy();
  });
});
