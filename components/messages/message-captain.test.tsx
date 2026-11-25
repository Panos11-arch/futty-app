import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Modal } from 'react-native';

import { MessageCaptainButton } from '@/components/messages/message-captain';
import { loadWithFile } from '@/components/ui/test-utils';

loadWithFile(Modal);

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

const contacts = [
  { my_team_id: 'mine', team_id: 't1', team_name: 'Lions', captain_id: 'p1', captain_name: 'Ben', avatar_style: 'initials', avatar_kit_colour: null, avatar_number: null },
  { my_team_id: 'mine', team_id: 't2', team_name: 'Wolves', captain_id: 'p2', captain_name: 'Cara', avatar_style: 'initials', avatar_kit_colour: null, avatar_number: null },
];

function answer(map: Record<string, { data: unknown; error: unknown }>) {
  mockRpc.mockImplementation((name: string) => Promise.resolve(map[name] ?? { data: null, error: null }));
}

beforeEach(() => {
  mockRpc.mockReset();
  (router.push as jest.Mock).mockClear();
});

describe('Message a captain', () => {
  it('hidden for anyone who is not a captain in the league (no teams from the server)', async () => {
    answer({ league_captain_contacts: { data: [], error: null } });
    await render(<MessageCaptainButton leagueId="l1" />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('league_captain_contacts', { p_league_id: 'l1' }));
    expect(screen.queryByTestId('league-message-captain')).toBeNull();
  });

  it('hidden when the teams cannot load', async () => {
    answer({ league_captain_contacts: { data: null, error: { message: 'x' } } });
    await render(<MessageCaptainButton leagueId="l1" />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(screen.queryByTestId('league-message-captain')).toBeNull();
  });

  it('opens a sheet of the other teams with their captain, searchable', async () => {
    answer({ league_captain_contacts: { data: contacts, error: null } });
    await render(<MessageCaptainButton leagueId="l1" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Message a captain' }));
    expect(screen.getByRole('button', { name: 'Message Ben, Lions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Message Cara, Wolves' })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search teams or captains'), 'wol');
    expect(screen.queryByRole('button', { name: 'Message Ben, Lions' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search teams or captains'), 'zzz');
    expect(screen.getByText('No teams found.')).toBeTruthy();
  });

  it('a captain opens the chat between the two teams', async () => {
    answer({
      league_captain_contacts: { data: contacts, error: null },
      open_captain_conversation: { data: 'c9', error: null },
    });
    await render(<MessageCaptainButton leagueId="l1" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Message a captain' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Message Ben, Lions' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 'c9' } }));
    expect(mockRpc).toHaveBeenCalledWith('open_captain_conversation', { p_my_team_id: 'mine', p_other_team_id: 't1' });
  });

  it('refused (blocked, or an adult and a minor): one line, no chat', async () => {
    answer({
      league_captain_contacts: { data: contacts, error: null },
      open_captain_conversation: { data: null, error: { message: 'age_pair_refused' } },
    });
    await render(<MessageCaptainButton leagueId="l1" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Message a captain' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Message Cara, Wolves' }));
    expect(await screen.findByText("You can't message this player.")).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });
});
