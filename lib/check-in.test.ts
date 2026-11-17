// P6 check-in QR (docs/specs/match-record.md decision 1a.4 and section 5.4;
// spec 05 section 12, item 7). The QR holds futtyapp://check-in?match=<id>&code=<code>
// (agreed with Anghelo, 17 November). The server checks the code, the player
// and the window; the app only reads the link, shows the window and words the
// server's refusal.
import {
  checkInErrorWords,
  checkInLink,
  checkInToMatch,
  checkInWindow,
  checkLinkFor,
  fetchCheckInMatch,
  fetchMyCheckIn,
  groupCode,
  loadCheckInQr,
  normaliseCode,
  parseCheckInLink,
  parseCheckInParams,
  scanWords,
  windowState,
} from './check-in';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockNeq = jest.fn();
let mockResult: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => {
  const query = {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return query;
    },
    eq: (...args: unknown[]) => {
      mockEq(...args);
      return query;
    },
    neq: (...args: unknown[]) => {
      mockNeq(...args);
      return query;
    },
    maybeSingle: () => Promise.resolve(mockResult),
  };
  return {
    supabase: {
      rpc: (...args: unknown[]) => mockRpc(...args),
      from: (table: string) => {
        mockFrom(table);
        return query;
      },
    },
  };
});

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockNeq.mockReset();
  mockResult = { data: null, error: null };
});

const MATCH = '6f1c2a9e-1b2c-4d3e-8f90-0a1b2c3d4e5f';
const OTHER = '0b9a8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
const CODE = '3f9a1c0e5b7d2a4c6e8f0a1b2c3d4e5f';

describe('checkInLink', () => {
  it('encodes the match id and the code as agreed', () => {
    expect(checkInLink(MATCH, CODE)).toBe(`futtyapp://check-in?match=${MATCH}&code=${CODE}`);
  });

  it('reads back what it wrote', () => {
    expect(parseCheckInLink(checkInLink(MATCH, CODE))).toEqual({ kind: 'ok', matchId: MATCH, code: CODE });
  });
});

describe('parseCheckInLink', () => {
  it('reads the match and the code in either order, ignoring other parameters', () => {
    expect(parseCheckInLink(`futtyapp://check-in?code=${CODE}&utm=x&match=${MATCH}`)).toEqual({
      kind: 'ok',
      matchId: MATCH,
      code: CODE,
    });
  });

  it('takes a trailing slash, three slashes, upper-case scheme and spaces around it', () => {
    for (const link of [
      `futtyapp://check-in/?match=${MATCH}&code=${CODE}`,
      `futtyapp:///check-in?match=${MATCH}&code=${CODE}`,
      `  FUTTYAPP://check-in?match=${MATCH}&code=${CODE}\n`,
    ]) {
      expect(parseCheckInLink(link)).toEqual({ kind: 'ok', matchId: MATCH, code: CODE });
    }
  });

  it('lower-cases the code and the match id', () => {
    expect(parseCheckInLink(`futtyapp://check-in?match=${MATCH.toUpperCase()}&code=${CODE.toUpperCase()}`)).toEqual({
      kind: 'ok',
      matchId: MATCH,
      code: CODE,
    });
  });

  it('says a QR that is not a Futty check-in link is not one', () => {
    for (const text of [
      '',
      'hello',
      `https://futty.app/check-in?match=${MATCH}&code=${CODE}`,
      `futtyapp://booking?match=${MATCH}&code=${CODE}`,
      `otherapp://check-in?match=${MATCH}&code=${CODE}`,
      `futtyapp://check-inx?match=${MATCH}&code=${CODE}`,
    ]) {
      expect(parseCheckInLink(text)).toEqual({ kind: 'not_futty' });
    }
  });

  it('says a broken Futty link is malformed', () => {
    for (const text of [
      'futtyapp://check-in',
      'futtyapp://check-in?',
      `futtyapp://check-in?match=${MATCH}`,
      `futtyapp://check-in?code=${CODE}`,
      `futtyapp://check-in?match=${MATCH}&code=`,
      `futtyapp://check-in?match=not-a-uuid&code=${CODE}`,
      `futtyapp://check-in?match=${MATCH}&code=%E0%A4%A`,
      `futtyapp://check-in?match=${MATCH}&code=abc%20def`,
    ]) {
      expect(parseCheckInLink(text)).toEqual({ kind: 'malformed' });
    }
  });
});

describe('parseCheckInParams (the deep link route)', () => {
  it('takes the router params', () => {
    expect(parseCheckInParams({ match: MATCH, code: CODE })).toEqual({ kind: 'ok', matchId: MATCH, code: CODE });
  });

  it('takes the first of repeated params', () => {
    expect(parseCheckInParams({ match: [MATCH, OTHER], code: [CODE] })).toEqual({ kind: 'ok', matchId: MATCH, code: CODE });
  });

  it('is malformed with a param missing or wrong', () => {
    expect(parseCheckInParams({ match: MATCH })).toEqual({ kind: 'malformed' });
    expect(parseCheckInParams({ code: CODE })).toEqual({ kind: 'malformed' });
    expect(parseCheckInParams({ match: 'x', code: CODE })).toEqual({ kind: 'malformed' });
    expect(parseCheckInParams({})).toEqual({ kind: 'malformed' });
  });
});

describe('checkLinkFor', () => {
  it('gives the code when the QR is for this match', () => {
    expect(checkLinkFor(MATCH, checkInLink(MATCH, CODE))).toEqual({ kind: 'ok', code: CODE });
  });

  it('refuses another match’s QR', () => {
    expect(checkLinkFor(MATCH, checkInLink(OTHER, CODE))).toEqual({ kind: 'other_match' });
  });

  it('passes on not-Futty and malformed', () => {
    expect(checkLinkFor(MATCH, 'hello')).toEqual({ kind: 'not_futty' });
    expect(checkLinkFor(MATCH, 'futtyapp://check-in?match=x')).toEqual({ kind: 'malformed' });
  });
});

describe('codes', () => {
  it('normalises typed codes: spaces, dashes and case', () => {
    expect(normaliseCode(' 3F9A 1c0e-5b7d\t2a4c ')).toBe('3f9a1c0e5b7d2a4c');
    expect(normaliseCode('')).toBe('');
  });

  it('groups a code in fours for reading out', () => {
    expect(groupCode(CODE)).toBe('3f9a 1c0e 5b7d 2a4c 6e8f 0a1b 2c3d 4e5f');
    expect(groupCode('abcdef')).toBe('abcd ef');
  });
});

describe('the check-in window (decision 1a.4)', () => {
  // A 20:00–21:00 Cyprus game in winter (UTC+2): 18:00Z to 19:00Z.
  const match = { kickoff_at: '2026-11-20T18:00:00+00:00', ends_at: '2026-11-20T19:00:00+00:00', status: 'scheduled' };
  const at = (iso: string) => new Date(iso);

  it('opens 60 minutes before kickoff and closes 1 hour after the end', () => {
    const w = checkInWindow(match);
    expect(w.opens.toISOString()).toBe('2026-11-20T17:00:00.000Z');
    expect(w.closes.toISOString()).toBe('2026-11-20T20:00:00.000Z');
  });

  it('is before, open and closed at the edges, as the server is', () => {
    expect(windowState(match, at('2026-11-20T16:59:59.999Z'))).toBe('before');
    expect(windowState(match, at('2026-11-20T17:00:00.000Z'))).toBe('open');
    expect(windowState(match, at('2026-11-20T19:59:59.999Z'))).toBe('open');
    expect(windowState(match, at('2026-11-20T20:00:00.000Z'))).toBe('closed');
  });

  it('is closed for a void match', () => {
    expect(windowState({ ...match, status: 'void' }, at('2026-11-20T18:30:00Z'))).toBe('closed');
  });
});

describe('server calls', () => {
  it('checks in with the match id and the normalised code only', async () => {
    await checkInToMatch(MATCH, ' 3F9A-1C0E ');
    expect(mockRpc).toHaveBeenCalledWith('check_in_to_match', { p_match_id: MATCH, p_code: '3f9a1c0e' });
  });

  it('reads a booking’s match, leaving out a void one', async () => {
    mockResult = {
      data: { id: MATCH, kickoff_at: 'k', ends_at: 'e', status: 'scheduled', venues: { name: 'Pitch Club' } },
      error: null,
    };
    expect(await fetchCheckInMatch({ bookingId: 'b1' })).toEqual({
      data: { id: MATCH, kickoff_at: 'k', ends_at: 'e', status: 'scheduled', venue_name: 'Pitch Club' },
      error: null,
    });
    expect(mockFrom).toHaveBeenCalledWith('matches');
    expect(mockSelect).toHaveBeenCalledWith('id, kickoff_at, ends_at, status, venues(name)');
    expect(mockEq).toHaveBeenCalledWith('booking_id', 'b1');
    expect(mockNeq).toHaveBeenCalledWith('status', 'void');
  });

  it('reads a match by id', async () => {
    mockResult = { data: { id: MATCH, kickoff_at: 'k', ends_at: 'e', status: 'played', venues: null }, error: null };
    expect(await fetchCheckInMatch({ matchId: MATCH })).toEqual({
      data: { id: MATCH, kickoff_at: 'k', ends_at: 'e', status: 'played', venue_name: null },
      error: null,
    });
    expect(mockEq).toHaveBeenCalledWith('id', MATCH);
  });

  it('gives null when there is no match, and passes an error on', async () => {
    expect(await fetchCheckInMatch({ bookingId: 'b1' })).toEqual({ data: null, error: null });
    mockResult = { data: null, error: { message: 'boom' } };
    expect(await fetchCheckInMatch({ bookingId: 'b1' })).toEqual({ data: null, error: { message: 'boom' } });
  });

  it('reads whether the player has checked in', async () => {
    mockResult = { data: { match_id: MATCH }, error: null };
    expect(await fetchMyCheckIn(MATCH, 'me')).toEqual({ data: true, error: null });
    expect(mockFrom).toHaveBeenCalledWith('match_attendance');
    expect(mockEq).toHaveBeenCalledWith('match_id', MATCH);
    expect(mockEq).toHaveBeenCalledWith('profile_id', 'me');
    mockResult = { data: null, error: null };
    expect(await fetchMyCheckIn(MATCH, 'me')).toEqual({ data: false, error: null });
    mockResult = { data: null, error: { message: 'boom' } };
    expect(await fetchMyCheckIn(MATCH, 'me')).toEqual({ data: false, error: { message: 'boom' } });
  });
});

describe('loadCheckInQr (venue staff)', () => {
  it('gets the code from get_match_check_in_code and the match times', async () => {
    mockRpc.mockResolvedValue({ data: CODE, error: null });
    mockResult = { data: { id: MATCH, kickoff_at: 'k', ends_at: 'e', status: 'scheduled', venues: null }, error: null };
    expect(await loadCheckInQr(MATCH)).toEqual({ code: CODE, kickoffAt: 'k', endsAt: 'e' });
    expect(mockRpc).toHaveBeenCalledWith('get_match_check_in_code', { p_match_id: MATCH });
    expect(mockEq).toHaveBeenCalledWith('id', MATCH);
  });

  it('words a refusal of the code', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not_venue_staff' } });
    expect(await loadCheckInQr(MATCH)).toEqual({ error: "Only this venue's staff can show its check-in code." });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'match_not_found' } });
    expect(await loadCheckInQr(MATCH)).toEqual({ error: "We couldn't find this game." });
  });

  it('fails when the match times cannot be read', async () => {
    mockRpc.mockResolvedValue({ data: CODE, error: null });
    mockResult = { data: null, error: null };
    expect(await loadCheckInQr(MATCH)).toEqual({ error: "We couldn't find this game." });
    mockResult = { data: null, error: { message: 'boom' } };
    expect(await loadCheckInQr(MATCH)).toEqual({ error: "We couldn't load the check-in code. Try again." });
  });
});

describe('words', () => {
  it('words each refusal of check_in_to_match plainly', () => {
    expect(checkInErrorWords('invalid_code')).toBe("That code doesn't match this game. Check it with the venue.");
    expect(checkInErrorWords('check_in_closed')).toBe(
      'Check-in for this game is closed. It opens an hour before kickoff and closes an hour after the end.',
    );
    expect(checkInErrorWords('not_in_match')).toBe("You're not in this game, so you can't check in to it.");
    expect(checkInErrorWords('match_not_found')).toBe("We couldn't find this game.");
    expect(checkInErrorWords('something else')).toBe("We couldn't check you in. Try again.");
  });

  it('words what a scan can find', () => {
    expect(scanWords('not_futty')).toBe("That's not a Futty check-in code. Scan the QR the venue shows you.");
    expect(scanWords('malformed')).toBe("That check-in code can't be read. Scan it again, or type the code.");
    expect(scanWords('other_match')).toBe('That code is for a different game.');
  });
});
