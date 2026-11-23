import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { AfterPayView, type AfterPayViewProps } from '@/components/booking/after-pay-view';
import type { BookingDetailData } from '@/lib/booking-detail';
import { bookerDetail } from '@/lib/booking-detail.fixtures';
import { v2Fixture } from '@/lib/booking-opposition.fixtures';
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

const sideA = v2Fixture().sides[0];
const openHalf = v2Fixture({ sides: [sideA], opposition: { found: false, open: true, invited: 0 } });

function props(detail: BookingDetailData, overrides: Partial<AfterPayViewProps> = {}): AfterPayViewProps {
  return {
    state: { status: 'ready', data: detail },
    onRetry: jest.fn(),
    onInviteFriend: jest.fn(async () => null),
    onShare: jest.fn(),
    onSearchTeams: jest.fn(async () => [
      { id: 't1', name: 'Apollon', city: 'Limassol' },
      { id: 't2', name: 'Apoel', city: null },
    ]),
    onInviteOpposition: jest.fn(async () => null),
    onPublishOpposition: jest.fn(async () => null),
    onPublishGame: jest.fn(async () => null),
    onDone: jest.fn(),
    ...overrides,
  };
}

describe('AfterPayView (B3: the screen after paying)', () => {
  it('shows the pitch name, the day and time and the venue; "Go to booking" opens it', async () => {
    const p = props(bookerDetail({ v2: openHalf }));
    await render(<AfterPayView {...p} />);
    expect(screen.getByText('Pitch 2')).toBeTruthy();
    expect(screen.getByText('Mon 16 Nov · 19:00–20:00')).toBeTruthy();
    expect(screen.getByText('Nuevo Campo')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('after-pay-done'));
    expect(p.onDone).toHaveBeenCalled();
  });

  it('Invite friends: by username, and the share menu', async () => {
    const p = props(bookerDetail({ v2: v2Fixture({ kind: 'whole', sides: [], opposition: null }) }));
    await render(<AfterPayView {...p} />);
    const friends = within(screen.getByTestId('after-pay-invite-friends'));
    await fireEvent.changeText(friends.getByLabelText('Username'), 'nikos');
    await fireEvent.press(screen.getByTestId('after-pay-invite'));
    expect(p.onInviteFriend).toHaveBeenCalledWith('nikos');
    await waitFor(() => expect(screen.getByText("Invite sent to nikos. They'll show up in the booking once they accept.")).toBeTruthy());
    await fireEvent.press(screen.getByTestId('after-pay-share'));
    expect(p.onShare).toHaveBeenCalled();
  });

  it('a whole pitch has no "Invite opposition"', async () => {
    await render(<AfterPayView {...props(bookerDetail({ v2: v2Fixture({ kind: 'whole', sides: [], opposition: null }) }))} />);
    expect(screen.queryByTestId('after-pay-opposition')).toBeNull();
  });

  it('a half pitch: invite players and teams as the opposition', async () => {
    const p = props(bookerDetail({ v2: openHalf }));
    await render(<AfterPayView {...p} />);
    const opposition = within(screen.getByTestId('after-pay-opposition'));
    await fireEvent.changeText(opposition.getByLabelText("Player's username"), 'nikos');
    await fireEvent.press(screen.getByTestId('after-pay-add-player'));
    expect(screen.getByTestId('after-pay-player-nikos')).toBeTruthy();
    await fireEvent.changeText(opposition.getByLabelText('Search teams'), 'apo');
    expect(p.onSearchTeams).toHaveBeenCalledWith('apo');
    await fireEvent.press(await screen.findByTestId('after-pay-team-t1'));
    await fireEvent.press(screen.getByTestId('after-pay-send-opposition'));
    expect(p.onInviteOpposition).toHaveBeenCalledWith({ usernames: ['nikos'], teamIds: ['t1'] });
    await waitFor(() => expect(screen.getByText('Invites sent. The first captain to accept plays you.')).toBeTruthy());
  });

  it('nothing to send until a player or a team is picked', async () => {
    await render(<AfterPayView {...props(bookerDetail({ v2: openHalf }))} />);
    expect(screen.getByTestId('after-pay-send-opposition').props.accessibilityState?.disabled).toBe(true);
  });

  it('"Publish" makes it a public opposition post; off again unpublishes', async () => {
    const p = props(bookerDetail({ v2: openHalf }));
    await render(<AfterPayView {...p} />);
    await fireEvent(screen.getByTestId('after-pay-publish-opposition'), 'valueChange', true);
    expect(p.onPublishOpposition).toHaveBeenCalledWith(true);
  });

  it('opposition found: says so, nothing more to invite', async () => {
    await render(<AfterPayView {...props(bookerDetail({ v2: v2Fixture() }))} />);
    expect(screen.queryByTestId('after-pay-opposition')).toBeNull();
    expect(screen.getByText('Opposition found.')).toBeTruthy();
  });

  it('"Publish game": open spots in Find a game, on and off', async () => {
    const p = props(bookerDetail({ v2: openHalf }));
    await render(<AfterPayView {...p} />);
    await fireEvent(screen.getByTestId('after-pay-publish-game'), 'valueChange', true);
    expect(p.onPublishGame).toHaveBeenCalledWith(true);
  });

  it('a refused publish shows why and the switch goes back', async () => {
    const p = props(bookerDetail({ v2: openHalf }), { onPublishGame: jest.fn(async () => 'Every spot is taken.') });
    await render(<AfterPayView {...p} />);
    await fireEvent(screen.getByTestId('after-pay-publish-game'), 'valueChange', true);
    await waitFor(() => expect(screen.getByText('Every spot is taken.')).toBeTruthy());
    expect(screen.getByTestId('after-pay-publish-game').props.value).toBe(false);
  });

  it('side B’s captain invites his own players and can publish his side, but not the opposition', async () => {
    const v2 = v2Fixture({ captain_of: 'b', my_side: 'b' });
    await render(<AfterPayView {...props(bookerDetail({ is_booker: false, v2 }))} />);
    expect(screen.getByTestId('after-pay-invite-friends')).toBeTruthy();
    expect(screen.getByTestId('after-pay-publish-game')).toBeTruthy();
    expect(screen.queryByTestId('after-pay-opposition')).toBeNull();
  });
});
