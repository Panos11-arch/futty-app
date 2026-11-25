import type { BookingV2Info } from './booking-opposition';
import { armStartMatch, startMatchPublishKind, takeStartMatch, waitUntilConfirmed } from './start-match';

function v2(over: Partial<BookingV2Info> = {}): BookingV2Info {
  return {
    kind: 'whole',
    pitch_label: null,
    captain_of: null,
    my_side: null,
    sides: [],
    roster_sides: {},
    opposition: null,
    posts: { players: null, opposition: null },
    no_opponent: null,
    ...over,
  };
}

describe('the Start a match flag', () => {
  afterEach(() => armStartMatch(false));

  it('is taken once', () => {
    armStartMatch(true);
    expect(takeStartMatch()).toBe(true);
    expect(takeStartMatch()).toBe(false);
  });
  it('is off when Book a pitch closed first', () => {
    armStartMatch(true);
    armStartMatch(false);
    expect(takeStartMatch()).toBe(false);
  });
});

describe('startMatchPublishKind', () => {
  it('publishes a whole pitch for players, for its booker', () => {
    expect(startMatchPublishKind({ is_booker: true, v2: v2() })).toBe('players');
    expect(startMatchPublishKind({ is_booker: false, v2: v2() })).toBeNull();
  });
  it('publishes a half pitch for an opponent, for side A\'s captain while the invite is open', () => {
    const half = v2({ kind: 'half', captain_of: 'a', opposition: { found: false, open: true, invited: 0 } });
    expect(startMatchPublishKind({ is_booker: true, v2: half })).toBe('opposition');
    expect(startMatchPublishKind({ is_booker: true, v2: { ...half, captain_of: 'b' } })).toBeNull();
    expect(startMatchPublishKind({ is_booker: true, v2: { ...half, opposition: { found: true, open: false, invited: 0 } } })).toBeNull();
  });
  it('does nothing when already published or not Booking v2', () => {
    expect(startMatchPublishKind({ is_booker: true, v2: v2({ posts: { players: 'p', opposition: null } }) })).toBeNull();
    expect(
      startMatchPublishKind({
        is_booker: true,
        v2: v2({ kind: 'half', captain_of: 'a', opposition: { found: false, open: true, invited: 0 }, posts: { players: null, opposition: 'o' } }),
      }),
    ).toBeNull();
    expect(startMatchPublishKind({ is_booker: true, v2: null })).toBeNull();
  });
});

describe('waitUntilConfirmed', () => {
  const sleep = jest.fn(() => Promise.resolve());
  beforeEach(() => sleep.mockClear());

  it('is true at once when confirmed', async () => {
    await expect(waitUntilConfirmed(() => Promise.resolve(true), { tries: 3, delayMs: 10, sleep })).resolves.toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });
  it('asks again until confirmed, counting a failed check as not yet', async () => {
    const check = jest
      .fn<Promise<boolean>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(waitUntilConfirmed(check, { tries: 5, delayMs: 10, sleep })).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it('gives up after the tries', async () => {
    await expect(waitUntilConfirmed(() => Promise.resolve(false), { tries: 3, delayMs: 10, sleep })).resolves.toBe(false);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
