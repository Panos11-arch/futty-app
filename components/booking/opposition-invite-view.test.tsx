import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { OppositionInviteView, type OppositionInviteViewProps } from '@/components/booking/opposition-invite-view';
import type { OppositionInvite } from '@/lib/booking-opposition';
import { primeRules } from '@/lib/rules.fixtures';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => primeRules());

// Spec 13's €40 5-a-side: side B's half is €20.00; paying for everyone
// €22.75 (example 4), paying for myself €4.80 and €20.00 held (example 5).
function invite(overrides: Partial<OppositionInvite> = {}): OppositionInvite {
  return {
    invite_id: 'i1',
    booking_id: 'b1',
    team_id: null,
    venue_name: 'Kamares Sports Centre',
    booking_day: '2026-11-26',
    start_time: '20:00:00',
    end_time: '21:00:00',
    format: '5-a-side',
    pitch_label: 'Pitch 2',
    side_pitch_cents: 2000,
    side_players: 5,
    pay_all_cents: 2275,
    each_pays_cents: 480,
    guarantee_cents: 2000,
    found: false,
    ...overrides,
  };
}

function props(data: OppositionInvite = invite(), overrides: Partial<OppositionInviteViewProps> = {}): OppositionInviteViewProps {
  return { state: { status: 'ready', data }, onRetry: jest.fn(), onPay: jest.fn(), paying: false, error: null, accepted: false, ...overrides };
}

const payButton = () => within(screen.getByTestId('sticky-action-bar')).getByRole('button');

describe('OppositionInviteView (B3: side B accepts)', () => {
  it('what, when, where and side B’s half, from the server', async () => {
    await render(<OppositionInviteView {...props()} />);
    expect(screen.getByText('Kamares Sports Centre')).toBeTruthy();
    expect(screen.getByText('Thu 26 Nov · 20:00–21:00')).toBeTruthy();
    expect(screen.getByText('Pitch 2 · 5-a-side · 5 v 5')).toBeTruthy();
    expect(screen.getByText("Your team's half: €20.00")).toBeTruthy();
  });

  it('"Accept as captain", then the way to pay with the server’s prices (examples 4 and 5)', async () => {
    const p = props();
    await render(<OppositionInviteView {...p} />);
    expect(screen.queryByTestId('opposition-way-pay-all')).toBeNull();
    await fireEvent.press(screen.getByTestId('opposition-accept'));
    expect(within(screen.getByTestId('opposition-way-pay-all')).getByText('€22.75')).toBeTruthy();
    expect(within(screen.getByTestId('opposition-way-pay-all')).getByText("You pay your team's half now.")).toBeTruthy();
    expect(within(screen.getByTestId('opposition-way-each-pays')).getByText('€4.80')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('opposition-way-each-pays'));
    expect(screen.getByText('We hold €20.00 on your card for unpaid spots, taken 2 hours after the game.')).toBeTruthy();
    expect(payButton()).toHaveProp('accessibilityLabel', 'Pay €4.80');
    await fireEvent.press(payButton());
    expect(p.onPay).toHaveBeenCalledWith('each_pays_responsible');
  });

  it('paying for everyone', async () => {
    const p = props();
    await render(<OppositionInviteView {...p} />);
    await fireEvent.press(screen.getByTestId('opposition-accept'));
    await fireEvent.press(screen.getByTestId('opposition-way-pay-all'));
    await fireEvent.press(payButton());
    expect(p.onPay).toHaveBeenCalledWith('pay_all');
  });

  it('Pay is off until a way to pay is chosen', async () => {
    const p = props();
    await render(<OppositionInviteView {...p} />);
    await fireEvent.press(screen.getByTestId('opposition-accept'));
    expect(payButton().props.accessibilityState?.disabled).toBe(true);
  });

  it('another captain was first: "Opposition found", and no accepting', async () => {
    await render(<OppositionInviteView {...props(invite({ found: true }))} />);
    expect(screen.getByText('Opposition found. Another captain accepted first.')).toBeTruthy();
    expect(screen.queryByTestId('opposition-accept')).toBeNull();
  });

  it('once accepted the way to pay is fixed; the error shows', async () => {
    const p = props(invite());
    await render(<OppositionInviteView {...p} />);
    await fireEvent.press(screen.getByTestId('opposition-accept'));
    await fireEvent.press(screen.getByTestId('opposition-way-pay-all'));
    await screen.rerender(<OppositionInviteView {...p} accepted error="Your card was declined." />);
    await fireEvent.press(screen.getByTestId('opposition-way-each-pays'));
    expect(screen.getByTestId('opposition-way-pay-all').props.accessibilityState?.selected).toBe(true);
    expect(within(screen.getByTestId('opposition-error')).getByText('Your card was declined.')).toBeTruthy();
  });
});

// B1d (spec 13 "Losers pay"): side B sees Losers pay and its hold before
// accepting; the button reads "Accept Losers pay" and there's no other.
describe('OppositionInviteView: Losers pay', () => {
  const losers = () =>
    invite({ losers_pay: true, losers_pay_all_cents: 4550, losers_each_pays_cents: 960, losers_spot_cents: 960 });

  it('says Losers pay before accepting, and the only button is "Accept Losers pay"', async () => {
    await render(<OppositionInviteView {...props(losers())} />);
    expect(screen.getByTestId('opposition-losers-pay')).toBeTruthy();
    expect(screen.getByText(/The losing team pays the whole pitch/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept Losers pay' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept as captain' })).toBeNull();
  });

  it('the holds, from the server: €45.50 paying for everyone (7a), €9.60 paying for myself (8a)', async () => {
    const onPay = jest.fn();
    await render(<OppositionInviteView {...props(losers(), { onPay })} />);
    await fireEvent.press(screen.getByTestId('opposition-accept'));
    expect(screen.getAllByText('€45.50').length).toBeGreaterThan(0);
    expect(screen.getAllByText('€9.60').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('opposition-way-each-pays'));
    expect(screen.getByText(/Each player's card is held for €9\.60\. 24 hours before kickoff, we hold €9\.60/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('opposition-pay'));
    expect(onPay).toHaveBeenCalledWith('each_pays_responsible');
  });

  it('not Losers pay: as before', async () => {
    await render(<OppositionInviteView {...props()} />);
    expect(screen.queryByTestId('opposition-losers-pay')).toBeNull();
    expect(screen.getByRole('button', { name: 'Accept as captain' })).toBeTruthy();
  });
});
