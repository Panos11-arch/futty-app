import './mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import InboxScreen from '@/app/messages';
import type { InboxRow } from '@/lib/messages';
import type { InboxState } from '@/lib/use-messages';

let mockInbox: { state: InboxState; refreshing: boolean; refresh: jest.Mock; retry: jest.Mock };
jest.mock('@/lib/use-messages', () => ({ useInbox: () => mockInbox }));

function row(over: Partial<InboxRow> = {}): InboxRow {
  return {
    id: 'c1',
    kind: 'captains',
    title: 'Ben',
    subtitle: 'Lions',
    other_profile_id: 'p2',
    other_team_id: 't2',
    avatar_style: 'initials',
    avatar_kit_colour: null,
    avatar_number: null,
    last_body: 'See you Friday',
    last_at: new Date().toISOString(),
    last_mine: false,
    unread: 1,
    ...over,
  };
}

function inbox(state: InboxState) {
  mockInbox = { state, refreshing: false, refresh: jest.fn(), retry: jest.fn() };
}

beforeEach(() => jest.clearAllMocks());

describe('Messages (inbox)', () => {
  it('loading: skeletons', async () => {
    inbox({ status: 'loading' });
    await render(<InboxScreen />);
    expect(screen.getByTestId('messages-skeleton')).toBeTruthy();
  });

  it('error: one line and Try again', async () => {
    inbox({ status: 'error', message: 'Something went wrong. Try again.' });
    await render(<InboxScreen />);
    expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockInbox.retry).toHaveBeenCalled();
  });

  it('empty: one line and one button', async () => {
    inbox({ status: 'ready', rows: [] });
    await render(<InboxScreen />);
    expect(screen.getByText('No messages yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open leagues' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/play', params: { segment: 'leagues' } });
  });

  it('data: a row opens its chat; the avatar opens the profile', async () => {
    inbox({ status: 'ready', rows: [row()] });
    await render(<InboxScreen />);
    expect(screen.getByText('See you Friday')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('inbox-row-c1'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/messages/[id]', params: { id: 'c1' } });
    await fireEvent.press(screen.getByTestId('inbox-avatar-c1'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/player-profile', params: { profileId: 'p2' } });
  });

  it('a team with no captain: the avatar opens the team', async () => {
    inbox({ status: 'ready', rows: [row({ other_profile_id: null, title: 'Lions' })] });
    await render(<InboxScreen />);
    await fireEvent.press(screen.getByTestId('inbox-avatar-c1'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/team-profile', params: { teamId: 't2' } });
  });

  it('a Former player has no profile to open', async () => {
    inbox({ status: 'ready', rows: [row({ kind: 'friends', title: 'Former player', other_team_id: null })] });
    await render(<InboxScreen />);
    await fireEvent.press(screen.getByTestId('inbox-avatar-c1'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('pull to refresh', async () => {
    inbox({ status: 'ready', rows: [row()] });
    await render(<InboxScreen />);
    const list = screen.getByTestId('messages-list');
    await list.props.refreshControl.props.onRefresh();
    expect(mockInbox.refresh).toHaveBeenCalled();
  });
});
