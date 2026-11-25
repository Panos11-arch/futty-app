// S19: a player's favourite player is reportable. The report goes to the
// reports table with context 'favourite_player'; the server makes it urgent
// when that player is a minor (A7). S20 adds the button.
import { reportFavouritePlayer, submitReport } from '@/lib/moderation';

const mockInsert = jest.fn();
const mockFrom = jest.fn((_table: string) => ({ insert: (row: unknown) => mockInsert(row) }));
jest.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => mockFrom(table) } }));

beforeEach(() => {
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockFrom.mockClear();
});

describe('reportFavouritePlayer', () => {
  it('reports the player, with the favourite player context', async () => {
    await expect(reportFavouritePlayer('me', 'them', 'Offensive')).resolves.toEqual({ error: null });
    expect(mockFrom).toHaveBeenCalledWith('reports');
    expect(mockInsert).toHaveBeenCalledWith({
      reporter_id: 'me',
      reported_user_id: 'them',
      context: 'favourite_player',
      context_id: null,
      reason: 'Offensive',
    });
  });

  it('passes the server error back', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'denied' } });
    await expect(reportFavouritePlayer('me', 'them', 'Offensive')).resolves.toEqual({ error: { message: 'denied' } });
  });
});

describe('submitReport', () => {
  it('sends null for a missing player or context id', async () => {
    await submitReport({ reporterId: 'me', context: 'team', reason: 'Spam' });
    expect(mockInsert).toHaveBeenCalledWith({
      reporter_id: 'me',
      reported_user_id: null,
      context: 'team',
      context_id: null,
      reason: 'Spam',
    });
  });
});
