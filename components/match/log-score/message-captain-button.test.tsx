// "Message <captain>" on the score mismatch screen: shown only when the
// server finds the other team's current captain for the caller; opens the
// captain chat for that match; a refusal shows one line.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { MessageCaptainButton } from '@/components/match/log-score/message-captain-button';
import { withTheme } from '@/components/ui/test-utils';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
const mockTap = jest.fn();
jest.mock('@/lib/haptics', () => ({ haptic: { tap: () => mockTap(), success: jest.fn(), error: jest.fn() } }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (to: unknown) => mockPush(to) } }));

const mockContact = jest.fn();
const mockOpen = jest.fn();
jest.mock('@/lib/messages', () => ({
  ...jest.requireActual('@/lib/messages'),
  fetchMatchCaptainContact: (id: string) => mockContact(id),
  openMatchCaptainConversation: (id: string) => mockOpen(id),
}));

const CONTACT = {
  my_team_id: 't1',
  team_id: 't2',
  team_name: 'Paphos 5',
  captain_id: 'p2',
  captain_name: 'Marios',
  avatar_style: null,
  avatar_kit_colour: null,
  avatar_number: null,
};

beforeEach(() => {
  mockContact.mockReset().mockResolvedValue(CONTACT);
  mockOpen.mockReset().mockResolvedValue({ conversationId: 'c9', error: null });
  mockPush.mockReset();
  mockTap.mockReset();
});

async function draw() {
  await render(withTheme(<MessageCaptainButton matchId="m1" />));
}

describe('MessageCaptainButton', () => {
  it('asks the server for the other captain of this match', async () => {
    await draw();
    await waitFor(() => expect(mockContact).toHaveBeenCalledWith('m1'));
  });

  it('shows "Message <captain>" once the server names them', async () => {
    await draw();
    const button = await screen.findByTestId('score-mismatch-message-captain');
    expect(button).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Message Marios' })).toBeTruthy();
  });

  it('shows nothing while loading, or when there is no captain to message', async () => {
    mockContact.mockReturnValue(new Promise(() => {}));
    await draw();
    expect(screen.queryByTestId('score-mismatch-message-captain')).toBeNull();
  });

  it('shows nothing when the server finds no captain (not a captain, no teams)', async () => {
    mockContact.mockResolvedValue(null);
    await draw();
    await waitFor(() => expect(mockContact).toHaveBeenCalled());
    expect(screen.queryByTestId('score-mismatch-message-captain')).toBeNull();
  });

  it('shows nothing when the lookup fails', async () => {
    mockContact.mockRejectedValue(new Error('offline'));
    await draw();
    await waitFor(() => expect(mockContact).toHaveBeenCalled());
    expect(screen.queryByTestId('score-mismatch-message-captain')).toBeNull();
  });

  it('opens the captain chat for the match, with a tap', async () => {
    await draw();
    await fireEvent.press(await screen.findByTestId('score-mismatch-message-captain'));
    expect(mockOpen).toHaveBeenCalledWith('m1');
    expect(mockTap).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 'c9' } }),
    );
  });

  it('a refusal shows one line and goes nowhere', async () => {
    mockOpen.mockResolvedValue({ conversationId: null, error: { message: 'age_pair_refused' } });
    await draw();
    await fireEvent.press(await screen.findByTestId('score-mismatch-message-captain'));
    expect(await screen.findByText("You can't message this player.")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('a blocked player gets the same line', async () => {
    mockOpen.mockResolvedValue({ conversationId: null, error: { message: 'blocked' } });
    await draw();
    await fireEvent.press(await screen.findByTestId('score-mismatch-message-captain'));
    expect(await screen.findByText("You can't message this player.")).toBeTruthy();
  });
});
