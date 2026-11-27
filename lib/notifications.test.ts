import {
  alwaysSentForViewer,
  clearQuietHours,
  getMyQuietHours,
  groupSwitchableTypes,
  notificationLabel,
  quietHoursCrossMidnight,
  quietHoursError,
  sectionsForViewer,
  setNotificationEnabled,
  setQuietHours,
  withDefaults,
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

describe('venue notification types', () => {
  const venueRows = [
    { type: 'venue_new_booking', always_sent: false },
    { type: 'venue_booking_cancelled', always_sent: false },
    { type: 'venue_short_game', always_sent: false },
    { type: 'venue_daily_summary', always_sent: false },
  ];

  it('go under Venue, not Other', () => {
    const sections = groupSwitchableTypes([{ type: 'squad_post', always_sent: false }, ...venueRows]);
    expect(sections).toEqual([
      { key: 'community', title: 'Community', types: ['squad_post'] },
      {
        key: 'venue',
        title: 'Venue',
        types: ['venue_new_booking', 'venue_booking_cancelled', 'venue_short_game', 'venue_daily_summary'],
      },
    ]);
  });

  it.each([
    ['venue_new_booking', 'A new booking at your venue'],
    ['venue_booking_cancelled', 'A booking at your venue is cancelled'],
    ['venue_short_game', 'A game at your venue is short of players'],
    ['venue_daily_summary', 'Tomorrow’s summary, at 20:00'],
  ])('%s has a plain-word label', (type, label) => {
    expect(notificationLabel(type)).toBe(label);
  });

  it('only venue staff see the Venue group', () => {
    const sections = groupSwitchableTypes([{ type: 'squad_post', always_sent: false }, ...venueRows]);
    expect(sectionsForViewer(sections, false).map((s) => s.key)).toEqual(['community']);
    expect(sectionsForViewer(sections, true).map((s) => s.key)).toEqual(['community', 'venue']);
  });

  it('a venue type the server makes always-sent is still hidden from non-staff', () => {
    expect(alwaysSentForViewer(['debt_created', 'venue_daily_summary'], false)).toEqual(['debt_created']);
    expect(alwaysSentForViewer(['debt_created', 'venue_daily_summary'], true)).toEqual([
      'debt_created',
      'venue_daily_summary',
    ]);
  });
});

// P6e: venue-offered players (supabase/migrations/20261117153008_pay_venue_player.sql).
// The staff's three go under Venue, for staff only; the booker's two under
// Your games.
describe('venue player notification types', () => {
  const rows = [
    'venue_player_offered',
    'venue_player_withdrawn',
    'venue_player_accepted',
    'venue_player_declined',
    'venue_player_removed',
  ].map((type) => ({ type, always_sent: false }));

  it('staff types under Venue, the booker’s under Your games, none under Other', () => {
    expect(groupSwitchableTypes(rows)).toEqual([
      { key: 'games', title: 'Your games', types: ['venue_player_offered', 'venue_player_withdrawn'] },
      {
        key: 'venue',
        title: 'Venue',
        types: ['venue_player_accepted', 'venue_player_declined', 'venue_player_removed'],
      },
    ]);
  });

  it('a booker who isn’t venue staff sees only theirs', () => {
    expect(sectionsForViewer(groupSwitchableTypes(rows), false).map((s) => s.key)).toEqual(['games']);
  });

  it.each([
    ['venue_player_offered', 'A venue offers your game a player'],
    ['venue_player_withdrawn', 'A venue withdraws its player'],
    ['venue_player_accepted', 'A booker accepts your player'],
    ['venue_player_declined', 'A booker declines your player'],
    ['venue_player_removed', 'A booker removes your player'],
  ])('%s has a plain-word label', (type, label) => {
    expect(notificationLabel(type)).toBe(label);
  });
});

// A7a: team of the week (supabase/migrations/20261118010100_match_team_of_the_week.sql).
describe('team of the week notification type', () => {
  it('goes under Your games, after man of the match voting, with its words', () => {
    const sections = groupSwitchableTypes([
      { type: 'motm_vote_open', always_sent: false },
      { type: 'team_of_the_week', always_sent: false },
    ]);
    expect(sections).toEqual([{ key: 'games', title: 'Your games', types: ['motm_vote_open', 'team_of_the_week'] }]);
    expect(notificationLabel('team_of_the_week')).toBe('You’re in the team of the week');
  });
});

describe('saved search notification type', () => {
  it('goes under Community, after team invites, with its words (decision 1d.1)', () => {
    const sections = groupSwitchableTypes([
      { type: 'squad_post', always_sent: false },
      { type: 'saved_search_match', always_sent: false },
      { type: 'team_invite', always_sent: false },
    ]);
    expect(sections).toEqual([
      { key: 'community', title: 'Community', types: ['squad_post', 'team_invite', 'saved_search_match'] },
    ]);
    expect(notificationLabel('saved_search_match')).toBe('Your saved searches');
  });
});

// A11: streak badges (supabase/migrations/20261118184516_match_streaks.sql).
describe('streak badge notification type', () => {
  it('goes under Your games, after team of the week, with its words', () => {
    const sections = groupSwitchableTypes([
      { type: 'team_of_the_week', always_sent: false },
      { type: 'streak_badge', always_sent: false },
    ]);
    expect(sections).toEqual([{ key: 'games', title: 'Your games', types: ['team_of_the_week', 'streak_badge'] }]);
    expect(notificationLabel('streak_badge')).toBe('Streak badges');
  });
});

// S14: "Premium and offers" (match-record.md decision 1k item 7), off by
// default (Apple guideline 4.5.4).
describe('Premium and offers notification type', () => {
  it('has its own Premium group and words', () => {
    const sections = groupSwitchableTypes([
      { type: 'team_of_the_week', always_sent: false },
      { type: 'premium_offers', always_sent: false, default_enabled: false },
    ]);
    expect(sections).toEqual([
      { key: 'games', title: 'Your games', types: ['team_of_the_week'] },
      { key: 'premium', title: 'Premium', types: ['premium_offers'] },
    ]);
    expect(notificationLabel('premium_offers')).toBe('Premium and offers');
  });

  it('withDefaults: a type that is off by default and has no row is off; a row wins', () => {
    const types = [
      { type: 'team_of_the_week', always_sent: false },
      { type: 'premium_offers', always_sent: false, default_enabled: false },
    ];
    expect(withDefaults(types, {})).toEqual({ premium_offers: false });
    expect(withDefaults(types, { premium_offers: true, team_of_the_week: false })).toEqual({
      premium_offers: true,
      team_of_the_week: false,
    });
    expect(withDefaults([], { squad_post: false })).toEqual({ squad_post: false });
  });
});

// Doc 28 prompt 1 (block clashes): staff moved a game to another pitch. Always
// sent, so it shows in the always-sent list with a label, not as its type.
describe('booking_pitch_moved', () => {
  it('has a plain-word label', () => {
    expect(notificationLabel('booking_pitch_moved')).toBe('Your game moves pitch');
  });
});

// S20: the two friend pushes are switchable, under Community, by name.
describe('friend notifications', () => {
  it('sit in Community with their labels', () => {
    const groups = groupSwitchableTypes([
      { type: 'friend_request', always_sent: false },
      { type: 'friend_accepted', always_sent: false },
    ] as Parameters<typeof groupSwitchableTypes>[0]);
    const community = groups.find((g) => g.key === 'community');
    expect(community?.types).toEqual(['friend_request', 'friend_accepted']);
    expect(notificationLabel('friend_request')).toBe('Friend requests');
    expect(notificationLabel('friend_accepted')).toBe('Accepted friend requests');
  });
});

// S20A: becoming captain and being removed from a team are switchable, under Community.
describe('team notifications', () => {
  it('sit in Community with their labels', () => {
    const groups = groupSwitchableTypes([
      { type: 'team_invite', always_sent: false },
      { type: 'team_captain', always_sent: false },
      { type: 'team_member_removed', always_sent: false },
    ] as Parameters<typeof groupSwitchableTypes>[0]);
    const community = groups.find((g) => g.key === 'community');
    expect(community?.types).toEqual(['team_invite', 'team_captain', 'team_member_removed']);
    expect(notificationLabel('team_captain')).toBe('You become captain');
    expect(notificationLabel('team_member_removed')).toBe('Removed from a team');
  });
});

// S20A (b): an invited card player's spot lapsed (always sent).
it('names the lapsed-spot notification', () => {
  expect(notificationLabel('booking_spot_lapsed')).toBe('Your game spot lapses');
});
