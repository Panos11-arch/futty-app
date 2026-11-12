import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import NotificationSettingsScreen from '@/app/account/settings/notifications';

// The server's state, as the mocked tables hold it.
let mockTypes: { type: string; always_sent: boolean }[];
let mockSettings: { type: string; enabled: boolean }[];
let mockQuiet: { starts_local: string; ends_local: string } | null;
let mockFailTypes = false;
const mockWrites: unknown[][] = [];

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ status: 'ready', profile: { id: 'me' } }) }));
jest.mock('@/lib/preferences', () => ({
  preferences: { isPushNotificationsEnabled: () => true, setPushNotificationsEnabled: jest.fn() },
}));
jest.mock('@/lib/push-notifications', () => ({
  registerForPushNotifications: jest.fn(),
  unregisterPushNotifications: jest.fn(),
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: (props: object) => React.createElement(View, props),
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

// A tiny in-memory stand-in for the three tables, so a save can be reloaded.
jest.mock('@/lib/supabase', () => {
  function table(name: string) {
    let op: 'select' | 'upsert' | 'delete' = 'select';
    let payload: unknown;
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      eq: () => q,
      maybeSingle: () => q,
      upsert: (row: unknown, opts: unknown) => {
        op = 'upsert';
        payload = row;
        mockWrites.push([name, 'upsert', row, opts]);
        return q;
      },
      delete: () => {
        op = 'delete';
        mockWrites.push([name, 'delete']);
        return q;
      },
      then: (resolve: (r: unknown) => unknown) => {
        if (op === 'upsert' && name === 'notification_settings') {
          const row = payload as { type: string; enabled: boolean };
          mockSettings = [...mockSettings.filter((s) => s.type !== row.type), { type: row.type, enabled: row.enabled }];
          return resolve({ data: null, error: null });
        }
        if (op === 'upsert' && name === 'notification_quiet_hours') {
          const row = payload as { starts_local: string; ends_local: string };
          mockQuiet = { starts_local: `${row.starts_local}:00`, ends_local: `${row.ends_local}:00` };
          return resolve({ data: null, error: null });
        }
        if (op === 'delete') {
          mockQuiet = null;
          return resolve({ data: null, error: null });
        }
        if (name === 'notification_types') {
          return resolve(mockFailTypes ? { data: null, error: { message: 'boom' } } : { data: mockTypes, error: null });
        }
        if (name === 'notification_settings') return resolve({ data: mockSettings, error: null });
        return resolve({ data: mockQuiet, error: null });
      },
    };
    return q;
  }
  return { supabase: { from: (name: string) => table(name) } };
});

beforeEach(() => {
  mockTypes = [
    { type: 'match_reminder_2h', always_sent: false },
    { type: 'followed_team_result', always_sent: false },
    { type: 'squad_post', always_sent: false },
    { type: 'debt_created', always_sent: true },
    { type: 'booking_cancelled', always_sent: true },
  ];
  mockSettings = [];
  mockQuiet = null;
  mockFailTypes = false;
  mockWrites.length = 0;
});

async function renderReady() {
  const view = await render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByText('Your games')).toBeTruthy(), { timeout: 5000 });
  return view;
}

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};

describe('Notification settings', () => {
  it('groups the switchable types under Your games, Teams you follow and Community', async () => {
    await renderReady();
    expect(screen.getByText('Teams you follow')).toBeTruthy();
    expect(screen.getByText('Community')).toBeTruthy();
    expect(screen.getByTestId('switch-match_reminder_2h').props.value).toBe(true);
  });

  it('always-sent types are listed with the reason and have no switch', async () => {
    await renderReady();
    expect(screen.getByText('Always sent')).toBeTruthy();
    expect(screen.getByText('About money or a cancelled game, so we always send these.')).toBeTruthy();
    expect(screen.getByTestId('notification-debt_created')).toBeTruthy();
    expect(screen.queryByTestId('switch-debt_created')).toBeNull();
    expect(screen.queryByTestId('switch-booking_cancelled')).toBeNull();
  });

  it('turning a type off writes the player’s own row', async () => {
    await renderReady();
    await fireEvent(screen.getByTestId('switch-match_reminder_2h'), 'valueChange', false);
    expect(mockWrites).toContainEqual([
      'notification_settings',
      'upsert',
      { profile_id: 'me', type: 'match_reminder_2h', enabled: false },
      { onConflict: 'profile_id,type' },
    ]);
    expect(screen.getByTestId('switch-match_reminder_2h').props.value).toBe(false);
  });

  it('shows a type the player turned off as off', async () => {
    mockSettings = [{ type: 'squad_post', enabled: false }];
    await renderReady();
    expect(screen.getByTestId('switch-squad_post').props.value).toBe(false);
  });

  it('quiet hours are off by default, need both times, and save across midnight', async () => {
    const { unmount } = await renderReady();
    expect(screen.getByLabelText('Quiet hours').props.value).toBe(false);

    await fireEvent(screen.getByLabelText('Quiet hours'), 'valueChange', true);
    expect(mockWrites).toEqual([]); // no defaults: nothing saved yet
    expect(screen.getByText('Save quiet hours')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('quiet-start'));
    await fireEvent(screen.getByTestId('quiet-start-picker'), 'change', { type: 'set' }, at(23, 0));
    await fireEvent.press(screen.getByTestId('quiet-end'));
    await fireEvent(screen.getByTestId('quiet-end-picker'), 'change', { type: 'set' }, at(7, 0));
    expect(screen.getByText('Cyprus time · ends the next day')).toBeTruthy();

    await fireEvent.press(screen.getByText('Save quiet hours'));
    expect(mockWrites).toContainEqual([
      'notification_quiet_hours',
      'upsert',
      { profile_id: 'me', starts_local: '23:00', ends_local: '07:00' },
      { onConflict: 'profile_id' },
    ]);

    // Reload: the same times come back.
    await unmount();
    await renderReady();
    expect(screen.getByLabelText('Quiet hours').props.value).toBe(true);
    expect(screen.getByLabelText('Start: 23:00')).toBeTruthy();
    expect(screen.getByLabelText('End: 07:00')).toBeTruthy();
    expect(screen.getByText('Cyprus time · ends the next day')).toBeTruthy();
  });

  it('turning quiet hours off deletes the row', async () => {
    mockQuiet = { starts_local: '23:00:00', ends_local: '07:00:00' };
    await renderReady();
    await fireEvent(screen.getByLabelText('Quiet hours'), 'valueChange', false);
    expect(mockWrites).toEqual([['notification_quiet_hours', 'delete']]);
    expect(mockQuiet).toBeNull();
  });

  it('error: an inline error with retry', async () => {
    mockFailTypes = true;
    await render(<NotificationSettingsScreen />);
    await waitFor(() => expect(screen.getByText('Couldn’t load your notification settings.')).toBeTruthy());
    mockFailTypes = false;
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Your games')).toBeTruthy());
  });
});
