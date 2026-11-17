import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import FixtureChatScreen from '@/app/fixture-chat';
import FixtureConfirmedScreen from '@/app/fixture-confirmed';
import { colors } from '@/constants/futty-theme';

const params = globalThis as { mockSearchParams?: Record<string, string> };
const mockGetFixture = jest.fn();
const mockListMessages = jest.fn();
const mockSendMessage = jest.fn();
const mockSubmitReport = jest.fn();

jest.mock('@/lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { channel: () => channel, removeChannel: jest.fn() } };
});
jest.mock('@/lib/realtime', () => ({ useRealtimeChannelName: (name: string) => name }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/use-fixtures', () => ({ useMyCaptainTeamIds: () => new Set(['home']) }));
jest.mock('@/lib/moderation', () => ({ submitReport: (...args: unknown[]) => mockSubmitReport(...args) }));
jest.mock('@/lib/fixtures', () => ({
  ...jest.requireActual('@/lib/fixtures'),
  getFixture: (...args: unknown[]) => mockGetFixture(...args),
  listFixtureMessages: (...args: unknown[]) => mockListMessages(...args),
  sendFixtureMessage: (...args: unknown[]) => mockSendMessage(...args),
}));
jest.mock('@/components/popup-modal', () => {
  const { View, Text, Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PopupModal: ({
      title,
      footer,
      children,
      onClose,
      backgroundImage,
      dark,
    }: {
      title: string;
      footer: React.ReactNode;
      children: React.ReactNode;
      onClose: () => void;
      backgroundImage?: React.ReactNode;
      dark?: boolean;
    }) => (
      <View testID={backgroundImage || dark ? 'popup-with-background' : 'popup'}>
        <Text>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} />
        {children}
        {footer}
      </View>
    ),
  };
});

const fixture = {
  id: 'f1',
  home_team_id: 'home',
  away_team_id: 'away',
  scheduled_day: null,
  scheduled_time: null,
  status: 'agreed',
  home_team: { id: 'home', name: 'Tigers' },
  away_team: { id: 'away', name: 'Lions' },
  venue: { id: 'v1', name: 'Arena', city: 'Nicosia' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmitReport.mockResolvedValue({ error: null });
});

describe('Fixture confirmed', () => {
  beforeEach(() => {
    params.mockSearchParams = { kind: 'league', id: 'f1' };
  });

  it('loading: a skeleton, plain background (no drawn pitch)', async () => {
    mockGetFixture.mockReturnValue(new Promise(() => {}));
    const view = await render(<FixtureConfirmedScreen />);
    expect(screen.getByTestId('popup')).toBeTruthy();
    expect(screen.getByTestId('fixture-confirmed-skeleton')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('ready: both teams, venue and the same buttons', async () => {
    mockGetFixture.mockResolvedValue({ data: fixture, error: null });
    const view = await render(<FixtureConfirmedScreen />);
    await screen.findByText('Tigers');
    expect(mockGetFixture).toHaveBeenCalledWith('f1');
    expect(screen.getByText('Match found')).toBeTruthy();
    expect(screen.getByText('Arena · Nicosia')).toBeTruthy();
    expect(view.toJSON()).toMatchSnapshot();
    await fireEvent.press(screen.getByRole('button', { name: 'View booking' }));
    expect(router.replace).toHaveBeenCalledWith('/my-bookings');
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('error: shown inline', async () => {
    mockGetFixture.mockResolvedValue({ data: null, error: { message: 'gone' } });
    await render(<FixtureConfirmedScreen />);
    expect(await screen.findByText('gone')).toBeTruthy();
  });
});

describe('Fixture chat', () => {
  beforeEach(() => {
    params.mockSearchParams = { fixtureId: 'f1' };
    mockGetFixture.mockResolvedValue({ data: fixture, error: null });
  });

  it('loading', async () => {
    mockListMessages.mockReturnValue(new Promise(() => {}));
    await render(<FixtureChatScreen />);
    expect(screen.getByTestId('chat-skeleton')).toBeTruthy();
  });

  it('empty', async () => {
    mockListMessages.mockResolvedValue({ data: [], error: null });
    const view = await render(<FixtureChatScreen />);
    await screen.findByText('No messages yet — say hello.');
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('populated: brandSoft bubbles for mine, surface for theirs', async () => {
    mockListMessages.mockResolvedValue({
      data: [
        { id: 'm1', message: 'Hi', sender_team_id: 'away', sender_team: { name: 'Lions' }, created_at: '2026-11-17T10:00:00Z' },
        { id: 'm2', message: 'Hello', sender_team_id: 'home', sender_team: { name: 'Tigers' }, created_at: '2026-11-17T10:01:00Z' },
      ],
      error: null,
    });
    await render(<FixtureChatScreen />);
    await screen.findByText('Hello');
    expect(StyleSheet.flatten(screen.getByTestId('bubble-mine').props.style).backgroundColor).toBe(colors.brandSoft);
    expect(StyleSheet.flatten(screen.getByTestId('bubble-theirs').props.style).backgroundColor).toBe(colors.surface);
    expect(screen.getByText('Lions')).toBeTruthy();
  });

  it('sends the trimmed message and reports with the same arguments', async () => {
    mockListMessages.mockResolvedValue({ data: [], error: null });
    mockSendMessage.mockResolvedValue({ error: null });
    await render(<FixtureChatScreen />);
    await screen.findByText('Tigers vs Lions');
    await fireEvent.changeText(screen.getByLabelText('Message'), '  see you there ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledWith('f1', 'see you there'));

    await fireEvent.press(screen.getByRole('button', { name: 'Report this chat' }));
    await fireEvent.changeText(screen.getByLabelText('Reason for reporting'), 'rude');
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() =>
      expect(mockSubmitReport).toHaveBeenCalledWith({
        reporterId: 'me',
        context: 'fixture_chat',
        contextId: 'f1',
        reason: 'rude',
      })
    );
  });
});
