// S19: the player card's data and words (lib/player-card.ts).
import {
  cardLink,
  cardLevelLabel,
  FAVOURITE_PLAYER_MAX,
  FEET,
  fetchMyPlayerCard,
  memberSinceLabel,
  normaliseFavouritePlayer,
  POSITIONS,
  scanRoute,
  teamsLabel,
  type PlayerCard,
} from '@/lib/player-card';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const row: PlayerCard = {
  username: 'dimi',
  full_name: 'Dimi Card',
  avatar_style: 'initials',
  avatar_kit_colour: null,
  avatar_number: null,
  avatar_illustration: null,
  level: 4.25,
  position: 'Midfielder',
  preferred_foot: 'Right',
  favourite_player: 'Iniesta',
  member_since: '2026-11-03',
  teams: [
    { id: 't1', name: 'Limassol Lions' },
    { id: 't2', name: 'Sunday Casuals' },
  ],
  team_count: 3,
  show_qr: true,
};

function single(result: { data: unknown; error: unknown }) {
  return { maybeSingle: jest.fn(() => Promise.resolve(result)) };
}

beforeEach(() => mockRpc.mockReset());

describe('fetchMyPlayerCard', () => {
  it('reads my_player_card from the server', async () => {
    mockRpc.mockReturnValue(single({ data: row, error: null }));
    await expect(fetchMyPlayerCard()).resolves.toEqual({ status: 'ready', card: row });
    expect(mockRpc).toHaveBeenCalledWith('my_player_card');
  });

  it('turns a level sent as text into a number', async () => {
    mockRpc.mockReturnValue(single({ data: { ...row, level: '4.25' }, error: null }));
    const result = await fetchMyPlayerCard();
    expect(result.status === 'ready' && result.card.level).toBe(4.25);
  });

  it('is an error when the server fails or returns no row', async () => {
    mockRpc.mockReturnValue(single({ data: null, error: { message: 'boom' } }));
    await expect(fetchMyPlayerCard()).resolves.toEqual({ status: 'error' });
    mockRpc.mockReturnValue(single({ data: null, error: null }));
    await expect(fetchMyPlayerCard()).resolves.toEqual({ status: 'error' });
  });

  it('is an error when the call throws', async () => {
    mockRpc.mockImplementation(() => {
      throw new Error('offline');
    });
    await expect(fetchMyPlayerCard()).resolves.toEqual({ status: 'error' });
  });
});

describe('teamsLabel', () => {
  it('joins up to two names, then +N for the rest', () => {
    expect(teamsLabel(row.teams, 3)).toBe('Limassol Lions · Sunday Casuals +1');
    expect(teamsLabel(row.teams, 2)).toBe('Limassol Lions · Sunday Casuals');
    expect(teamsLabel([row.teams[0]], 1)).toBe('Limassol Lions');
    expect(teamsLabel(row.teams, 7)).toBe('Limassol Lions · Sunday Casuals +5');
  });

  it('is null with no teams', () => {
    expect(teamsLabel([], 0)).toBeNull();
  });
});

describe('memberSinceLabel', () => {
  it('shows the month and year of the Cyprus date the server sends', () => {
    expect(memberSinceLabel('2026-11-03')).toBe('November 2026');
    expect(memberSinceLabel('2026-01-31')).toBe('January 2026');
    expect(memberSinceLabel('2025-12-01')).toBe('December 2025');
  });

  it('is null for a missing or unreadable date', () => {
    expect(memberSinceLabel(null)).toBeNull();
    expect(memberSinceLabel('')).toBeNull();
    expect(memberSinceLabel('2026-13-01')).toBeNull();
    expect(memberSinceLabel('soon')).toBeNull();
  });
});

describe('cardLevelLabel', () => {
  it('shows the A5 level with one decimal', () => {
    expect(cardLevelLabel(4.25)).toBe('Level 4.3');
    expect(cardLevelLabel(1)).toBe('Level 1.0');
  });

  it('is null with no level yet', () => {
    expect(cardLevelLabel(null)).toBeNull();
  });
});

describe('cardLink', () => {
  it('is futty.app/p/<username>', () => {
    expect(cardLink('dimi')).toBe('https://futty.app/p/dimi');
    expect(cardLink('a.b_c')).toBe('https://futty.app/p/a.b_c');
  });

  it('encodes anything unexpected', () => {
    expect(cardLink('a b')).toBe('https://futty.app/p/a%20b');
  });
});

describe('normaliseFavouritePlayer', () => {
  it('trims, and sends null when empty', () => {
    expect(normaliseFavouritePlayer('  Iniesta ')).toBe('Iniesta');
    expect(normaliseFavouritePlayer('   ')).toBeNull();
    expect(normaliseFavouritePlayer('')).toBeNull();
  });

  it('keeps at most 40 characters, the server limit', () => {
    expect(FAVOURITE_PLAYER_MAX).toBe(40);
    expect(normaliseFavouritePlayer('a'.repeat(45))).toBe('a'.repeat(40));
    expect(normaliseFavouritePlayer(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
  });
});

describe('the values the server accepts', () => {
  it('positions are Goalkeeper, Defender, Midfielder, Forward', () => {
    expect(POSITIONS).toEqual(['Goalkeeper', 'Defender', 'Midfielder', 'Forward']);
  });

  it('strong foot is Left, Right or Both', () => {
    expect(FEET).toEqual(['Left', 'Right', 'Both']);
  });
});

describe('scanRoute', () => {
  it('is null until S20 builds scanning, so Scan stays hidden', () => {
    expect(scanRoute()).toBeNull();
  });
});
