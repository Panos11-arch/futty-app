import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import FixtureChatScreen from '@/app/fixture-chat';
import FixtureConfirmedScreen from '@/app/fixture-confirmed';
import { colors } from '@/constants/futty-theme';

import { CYPRUS_LATE_KICKOFF, onPhoneIn, restorePhoneZone, ZONES_AND_SEASONS } from '../phone-time-zone';

const params = globalThis as { mockSearchParams?: Record<string, string> };
const mockGetFixture = jest.fn();
const mockListMessages = jest.fn();
const mockSendMessage = jest.fn();
const mockSubmitReport = jest.fn();

// Rows the fake supabase.from(table) returns, set per test.
const mockTables: Record<string, { data: unknown; error: unknown }> = {};
jest.mock('@/lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  const from = (table: string) => {
    const result = () => mockTables[table] ?? { data: null, error: null };
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      maybeSingle: () => Promise.resolve(result()),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  };
  return { supabase: { channel: () => channel, removeChannel: jest.fn(), from } };
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

  it('error: "Try again" shows the skeleton and loads the same fixture again', async () => {
    mockGetFixture.mockResolvedValueOnce({ data: null, error: { message: 'gone' } });
    mockGetFixture.mockReturnValueOnce(new Promise(() => {}));
    await render(<FixtureConfirmedScreen />);
    await screen.findByText('gone');
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByTestId('fixture-confirmed-skeleton')).toBeTruthy();
    expect(screen.queryByText('gone')).toBeNull();
    expect(mockGetFixture).toHaveBeenCalledTimes(2);
    expect(mockGetFixture).toHaveBeenLastCalledWith('f1');
  });

  it('error: "Try again" then shows the fixture', async () => {
    mockGetFixture.mockResolvedValueOnce({ data: null, error: { message: 'gone' } });
    mockGetFixture.mockResolvedValueOnce({ data: fixture, error: null });
    await render(<FixtureConfirmedScreen />);
    await screen.findByText('gone');
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Tigers')).toBeTruthy();
  });

  it('missing id: no retry, since there is nothing to load', async () => {
    params.mockSearchParams = { kind: 'league' };
    await render(<FixtureConfirmedScreen />);
    expect(await screen.findByText('Missing booking.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(mockGetFixture).not.toHaveBeenCalled();
  });
});

// Times on "Match found" are Cyprus time (Asia/Nicosia), whatever zone the
// phone is set to. Cyprus is UTC+2 in winter and UTC+3 in summer.
describe.each(['Asia/Nicosia', 'America/New_York', 'Asia/Tokyo'])('Fixture confirmed times, phone on %s', (zone) => {
  afterEach(restorePhoneZone);
  beforeEach(() => {
    onPhoneIn(zone);
    for (const key of Object.keys(mockTables)) delete mockTables[key];
    mockTables.venues = { data: { name: 'Arena', city: 'Nicosia' }, error: null };
  });

  it('matched squad post: the instant shown in Cyprus time (winter, UTC+2)', async () => {
    params.mockSearchParams = { kind: 'squad', id: 'sp1' };
    mockTables.squad_posts = {
      data: {
        team_id: 'a',
        matched_team_id: 'b',
        venue_id: 'v1',
        scheduled_at: '2026-11-14T17:00:00+00:00',
        format: '5v5',
        payment_mode: 'split',
      },
      error: null,
    };
    mockTables.teams = {
      data: [
        { id: 'a', name: 'Tigers' },
        { id: 'b', name: 'Lions' },
      ],
      error: null,
    };
    await render(<FixtureConfirmedScreen />);
    expect(await screen.findByText('Sat 14 Nov · 19:00')).toBeTruthy();
  });

  it('matched squad post: summer time (UTC+3) and a late kick-off on the right Cyprus day', async () => {
    params.mockSearchParams = { kind: 'squad', id: 'sp1' };
    mockTables.squad_posts = {
      data: {
        team_id: 'a',
        matched_team_id: 'b',
        venue_id: null,
        scheduled_at: '2026-07-04T20:30:00+00:00',
        format: '5v5',
        payment_mode: 'split',
      },
      error: null,
    };
    mockTables.teams = { data: [], error: null };
    await render(<FixtureConfirmedScreen />);
    expect(await screen.findByText('Sat 4 Jul · 23:30')).toBeTruthy();
  });

  it('plain booking: its Cyprus day and start time, as stored', async () => {
    params.mockSearchParams = { kind: 'booking', id: 'b1' };
    mockTables.venue_bookings = {
      data: { venue_id: 'v1', booking_day: '2026-11-14', start_time: '19:00:00', format: '5v5' },
      error: null,
    };
    await render(<FixtureConfirmedScreen />);
    expect(await screen.findByText('Sat 14 Nov · 19:00')).toBeTruthy();
    expect(screen.getByText('Arena · Nicosia')).toBeTruthy();
  });

  it('plain booking: a booking error retries the same booking', async () => {
    params.mockSearchParams = { kind: 'booking', id: 'b1' };
    mockTables.venue_bookings = { data: null, error: { message: 'offline' } };
    await render(<FixtureConfirmedScreen />);
    await screen.findByText('offline');
    mockTables.venue_bookings = {
      data: { venue_id: 'v1', booking_day: '2026-11-14', start_time: '19:00:00', format: '5v5' },
      error: null,
    };
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sat 14 Nov · 19:00')).toBeTruthy();
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

// Every date and time is Cyprus time (Asia/Nicosia), whatever zone the phone is in.
describe.each(ZONES_AND_SEASONS)('Fixture chat times, phone on %s in %s', (zone, season) => {
  const sent = CYPRUS_LATE_KICKOFF[season];
  beforeEach(() => {
    onPhoneIn(zone);
    params.mockSearchParams = { fixtureId: 'f1' };
    mockGetFixture.mockResolvedValue({ data: fixture, error: null });
  });
  afterEach(restorePhoneZone);

  it('each message shows the Cyprus time it was sent', async () => {
    mockListMessages.mockResolvedValue({
      data: [{ id: 'm1', message: 'Hi', sender_team_id: 'away', sender_team: { name: 'Lions' }, created_at: sent.iso }],
      error: null,
    });
    await render(<FixtureChatScreen />);
    await screen.findByText('Hi');
    expect(screen.getByText(sent.clock)).toBeTruthy();
  });
});
