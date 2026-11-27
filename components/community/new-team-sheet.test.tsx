// S20A (a): New team: a name, a town, a kit colour and friends to invite.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { NewTeamSheet } from '@/components/community/new-team-sheet';

const mockCreate = jest.fn();
const mockReload = jest.fn();
let mockFriends: Record<string, unknown> = { status: 'loading' };

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/use-friends', () => ({
  useFriends: () => ({ state: mockFriends, reload: mockReload }),
}));
jest.mock('@/lib/teams', () => ({
  ...jest.requireActual('@/lib/teams'),
  createMyTeam: (...a: unknown[]) => mockCreate(...a),
}));

const friend = (id: string, name: string, kind = 'friend') => ({
  kind,
  request_id: kind === 'request' ? `r-${id}` : null,
  profile_id: id,
  name,
  first_name: name.split(' ')[0],
  avatar_style: null,
  avatar_kit_colour: null,
  avatar_number: null,
  avatar_illustration: null,
  level: null,
});

const onClose = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockFriends = { status: 'ready', rows: [friend('p-ben', 'Ben Friend'), friend('p-cy', 'Cy Friend'), friend('p-req', 'Req Pending', 'request')] };
});

async function open() {
  await render(<NewTeamSheet visible onClose={onClose} />);
}

describe('New team sheet', () => {
  it('shows a skeleton while friends load', async () => {
    mockFriends = { status: 'loading' };
    await open();
    expect(screen.getByTestId('new-team-friends-skeleton')).toBeTruthy();
  });

  it('friends failed: one line and Try again', async () => {
    mockFriends = { status: 'error', message: "Friends couldn't load." };
    await open();
    expect(screen.getByText("Friends couldn't load.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('no friends: one line and Find friends', async () => {
    mockFriends = { status: 'ready', rows: [] };
    await open();
    expect(screen.getByText('No friends yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Find friends' }));
    expect(onClose).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/friends');
  });

  it('lists friends only, not pending requests', async () => {
    await open();
    expect(screen.getByTestId('new-team-friend-p-ben')).toBeTruthy();
    expect(screen.getByTestId('new-team-friend-p-cy')).toBeTruthy();
    expect(screen.queryByText('Req Pending')).toBeNull();
  });

  it('creates the team with the kit and the picked friends, then opens it', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'tm9' }, error: null });
    await open();
    expect(screen.getByRole('button', { name: 'Create team' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Team name'), ' Kato United ');
    await fireEvent.press(screen.getByRole('button', { name: 'Limassol' }));
    await fireEvent.press(screen.getByTestId('new-team-kit-sky'));
    expect(screen.getByTestId('new-team-kit-sky')).toBeSelected();

    const ben = screen.getByTestId('new-team-friend-p-ben');
    await fireEvent.press(ben);
    expect(ben).toBeChecked();
    await fireEvent.press(screen.getByTestId('new-team-friend-p-cy'));
    await fireEvent.press(screen.getByTestId('new-team-friend-p-cy'));
    expect(screen.getByTestId('new-team-friend-p-cy')).not.toBeChecked();

    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Create team' }));
    });
    expect(mockCreate).toHaveBeenCalledWith({
      name: 'Kato United',
      city: 'Limassol',
      kitColour: 'kitSky',
      rosterSize: 11,
      substituteSlots: 0,
      memberIds: ['p-ben'],
    });
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 'tm9' } }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('defaults: Nicosia and a red kit, no friends needed', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'tm1' }, error: null });
    await open();
    await fireEvent.changeText(screen.getByLabelText('Team name'), 'Solo FC');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Create team' }));
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Solo FC', city: 'Nicosia', kitColour: 'kitRed', memberIds: [] }),
    );
  });

  it('a refused team says why in one line and stays open', async () => {
    mockCreate.mockResolvedValue({ data: null, error: { message: 'not_friends' } });
    await open();
    await fireEvent.changeText(screen.getByLabelText('Team name'), 'X');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Create team' }));
    });
    expect(await screen.findByText('Only friends can join. Add them as a friend first.')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('every kit chip and friend row has a label', async () => {
    await open();
    for (const colour of ['Red', 'Blue', 'Sky', 'Green', 'Yellow', 'Orange', 'Black', 'White']) {
      expect(screen.getByRole('button', { name: colour })).toBeTruthy();
    }
    expect(screen.getByRole('checkbox', { name: 'Ben Friend' })).toBeTruthy();
  });
});
