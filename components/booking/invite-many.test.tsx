// S20A (b): Invite all friends and Invite a team, on the after-pay screen and
// the booking page (spec 13 "Player invites").
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { InviteMany } from '@/components/booking/invite-many';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() } }));
const haptic = jest.requireMock<{ haptic: Record<'success' | 'error', jest.Mock> }>('@/lib/haptics').haptic;

const teams = [
  { id: 't1', name: 'Kato United' },
  { id: 't2', name: 'Paphos 5' },
];

beforeEach(() => jest.clearAllMocks());

async function show(over: Partial<Parameters<typeof InviteMany>[0]> = {}) {
  const props = {
    testIDPrefix: 'after-pay' as const,
    teams,
    onInviteAllFriends: jest.fn().mockResolvedValue({ count: 3, error: null }),
    onInviteTeam: jest.fn().mockResolvedValue({ count: 2, error: null }),
    ...over,
  };
  await render(<InviteMany {...props} />);
  return props;
}

it('Invite all friends sends and says how many', async () => {
  const props = await show();
  await act(async () => {
    await fireEvent.press(screen.getByTestId('after-pay-invite-all-friends'));
  });
  expect(props.onInviteAllFriends).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Invited 3 friends.')).toBeTruthy();
  expect(haptic.success).toHaveBeenCalled();
});

it('Invite a team shows my teams; a team invites its members', async () => {
  const props = await show({ testIDPrefix: 'booking-detail' });
  await fireEvent.press(screen.getByTestId('booking-detail-invite-team'));
  await act(async () => {
    await fireEvent.press(screen.getByTestId('booking-detail-invite-team-t2'));
  });
  expect(props.onInviteTeam).toHaveBeenCalledWith('t2');
  expect(screen.getByText('Invited 2 from Paphos 5.')).toBeTruthy();
});

it('nobody left to invite says so; one invite is singular', async () => {
  await show({ onInviteAllFriends: jest.fn().mockResolvedValue({ count: 0, error: null }) });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('after-pay-invite-all-friends'));
  });
  expect(screen.getByText('Nobody new to invite.')).toBeTruthy();
  await act(async () => {});
});

it('one friend', async () => {
  await show({ onInviteAllFriends: jest.fn().mockResolvedValue({ count: 1, error: null }) });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('after-pay-invite-all-friends'));
  });
  expect(screen.getByText('Invited 1 friend.')).toBeTruthy();
});

it('a refusal is one line, with an error haptic', async () => {
  await show({ onInviteTeam: jest.fn().mockResolvedValue({ count: 0, error: 'The game has started. Invites are closed.' }) });
  await fireEvent.press(screen.getByTestId('after-pay-invite-team'));
  await act(async () => {
    await fireEvent.press(screen.getByTestId('after-pay-invite-team-t1'));
  });
  expect(screen.getByText('The game has started. Invites are closed.')).toBeTruthy();
  expect(haptic.error).toHaveBeenCalled();
});

it('no teams: no Invite a team', async () => {
  await show({ teams: [] });
  expect(screen.queryByTestId('after-pay-invite-team')).toBeNull();
  expect(screen.getByTestId('after-pay-invite-all-friends')).toBeTruthy();
});

it('buttons are 1-3 words, each labelled', async () => {
  await show();
  for (const id of ['after-pay-invite-all-friends', 'after-pay-invite-team']) {
    const label = screen.getByTestId(id).props.accessibilityLabel as string;
    expect(label.split(' ').length).toBeLessThanOrEqual(3);
  }
});
