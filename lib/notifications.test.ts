import {
  clearQuietHours,
  getMyQuietHours,
  groupSwitchableTypes,
  notificationLabel,
  quietHoursCrossMidnight,
  quietHoursError,
  setNotificationEnabled,
  setQuietHours,
} from '@/lib/notifications';

let mockCalls: unknown[][] = [];
let mockResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'upsert', 'delete', 'maybeSingle']) {
    query[method] = (...args: unknown[]) => {
      mockCalls.push([method, ...args]);
      return query;
    };
  }
  query.then = (resolve: (r: unknown) => unknown) => resolve(mockResponse);
  return {
    supabase: {
      from: (table: string) => {
        mockCalls.push(['from', table]);
        return query;
      },
    },
  };
});

beforeEach(() => {
  mockCalls = [];
  mockResponse = { data: null, error: null };
});

describe('setNotificationEnabled', () => {
  it('turning a type off writes the player’s own row with enabled false', async () => {
    await setNotificationEnabled('me', 'match_reminder_2h', false);
    expect(mockCalls).toEqual([
      ['from', 'notification_settings'],
      ['upsert', { profile_id: 'me', type: 'match_reminder_2h', enabled: false }, { onConflict: 'profile_id,type' }],
    ]);
  });
});

describe('quiet hours', () => {
  it('saves a span past midnight as given', async () => {
    await setQuietHours('me', { starts: '23:00', ends: '07:00' });
    expect(mockCalls).toEqual([
      ['from', 'notification_quiet_hours'],
      ['upsert', { profile_id: 'me', starts_local: '23:00', ends_local: '07:00' }, { onConflict: 'profile_id' }],
    ]);
  });

  it('reads the row back as HH:MM', async () => {
    mockResponse = { data: { starts_local: '23:00:00', ends_local: '07:00:00' }, error: null };
    expect((await getMyQuietHours()).quietHours).toEqual({ starts: '23:00', ends: '07:00' });
  });

  it('no row means off', async () => {
    expect((await getMyQuietHours()).quietHours).toBeNull();
  });

  it('turning them off deletes the row', async () => {
    await clearQuietHours('me');
    expect(mockCalls).toEqual([['from', 'notification_quiet_hours'], ['delete'], ['eq', 'profile_id', 'me']]);
  });

  it('needs both times, and they can’t be the same', () => {
    expect(quietHoursError({ starts: '23:00' })).toBe('Pick a start and an end time.');
    expect(quietHoursError({ starts: '22:00', ends: '22:00' })).toBe('Start and end can’t be the same time.');
    expect(quietHoursError({ starts: '23:00', ends: '07:00' })).toBeNull();
  });

  it('knows a span past midnight', () => {
    expect(quietHoursCrossMidnight({ starts: '23:00', ends: '07:00' })).toBe(true);
    expect(quietHoursCrossMidnight({ starts: '13:00', ends: '15:00' })).toBe(false);
  });
});

describe('groupSwitchableTypes', () => {
  it('groups the switchable types, leaves always-sent ones out, and puts unknown ones under Other', () => {
    const sections = groupSwitchableTypes([
      { type: 'squad_post', always_sent: false },
      { type: 'match_reminder_2h', always_sent: false },
      { type: 'followed_team_result', always_sent: false },
      { type: 'debt_created', always_sent: true },
      { type: 'brand_new_thing', always_sent: false },
    ]);
    expect(sections).toEqual([
      { key: 'games', title: 'Your games', types: ['match_reminder_2h'] },
      { key: 'follows', title: 'Teams you follow', types: ['followed_team_result'] },
      { key: 'community', title: 'Community', types: ['squad_post'] },
      { key: 'other', title: 'Other', types: ['brand_new_thing'] },
    ]);
  });

  it('names an unknown type in words', () => {
    expect(notificationLabel('brand_new_thing')).toBe('Brand new thing');
    expect(notificationLabel('match_reminder_2h')).toBe('2 hours before a game');
  });
});
