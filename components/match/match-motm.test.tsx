import { fireEvent, render, screen } from '@testing-library/react-native';

import { MatchMotm } from '@/components/match/match-motm';
import { mockMatchPage, mockPagePlayer, mockRoster, PAGE_CLOSED, PAGE_OPEN } from '@/lib/match/mock';
import { castMotmVote } from '@/lib/match/page-api';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/lib/match/page-api', () => ({ castMotmVote: jest.fn() }));

const vote = castMotmVote as jest.Mock;

beforeEach(() => vote.mockReset().mockResolvedValue({ error: null }));

async function show({
  page = mockMatchPage(),
  viewerId = 'me',
  now = PAGE_OPEN,
  member = true,
}: { page?: ReturnType<typeof mockMatchPage>; viewerId?: string; now?: number; member?: boolean } = {}) {
  const onVoted = jest.fn();
  const view = await render(
    <MatchMotm
      page={page}
      roster={member ? { status: 'ready', roster: mockRoster() } : null}
      onRetryRoster={jest.fn()}
      viewerId={viewerId}
      onVoted={onVoted}
      now={now}
    />
  );
  return { onVoted, view };
}

describe('MatchMotm', () => {
  it('a checked-in player votes once for someone else', async () => {
    const { onVoted } = await show();
    expect(screen.queryByTestId('nominee-p-me')).toBeNull();
    expect(screen.queryByTestId('nominee-p-guest')).toBeNull();
    expect(screen.queryByTestId('nominee-p-maria')).toBeNull(); // not checked in
    await fireEvent.press(screen.getByTestId('nominee-p-nikos'));
    await fireEvent.press(screen.getByText('Vote for Nikos Away'));
    expect(vote).toHaveBeenCalledWith('m1', 'p-nikos');
    expect(onVoted).toHaveBeenCalled();
  });

  it('after voting: "You voted for X", no vote buttons and no result yet', async () => {
    await show({ page: mockMatchPage({ myVote: 'p-nikos' }) });
    expect(screen.getByText('You voted for Nikos Away')).toBeTruthy();
    expect(screen.queryByTestId('cast-vote')).toBeNull();
    expect(screen.queryByText(/votes?$/)).toBeNull();
  });

  it('a second vote is refused in plain words', async () => {
    vote.mockResolvedValue({ error: { message: 'already_voted' } });
    const { onVoted } = await show();
    await fireEvent.press(screen.getByTestId('nominee-p-booker'));
    await fireEvent.press(screen.getByTestId('cast-vote'));
    expect(await screen.findByText("You've already voted.")).toBeTruthy();
    expect(onVoted).toHaveBeenCalled(); // reload to show the vote
  });

  it('voting for yourself is refused in plain words', async () => {
    vote.mockResolvedValue({ error: { message: 'cannot_vote_for_self' } });
    await show();
    await fireEvent.press(screen.getByTestId('nominee-p-booker'));
    await fireEvent.press(screen.getByTestId('cast-vote'));
    expect(await screen.findByText("You can't vote for yourself.")).toBeTruthy();
  });

  it('not checked in, or a stranger: voting is open, no buttons', async () => {
    await show({ viewerId: 'maria' });
    expect(screen.getByText(/^Voting is open until/)).toBeTruthy();
    expect(screen.queryByTestId('cast-vote')).toBeNull();
  });

  it('a stranger while open sees no result', async () => {
    await show({ viewerId: 'stranger', member: false });
    expect(screen.getByText(/^Voting is open until/)).toBeTruthy();
  });

  it('after voting closes, ties are shared and each shows its count', async () => {
    const motm = [
      { ...mockPagePlayer('p-booker'), votes: 2 },
      { ...mockPagePlayer('p-nikos'), votes: 2 },
    ];
    await show({ page: mockMatchPage({ motm }), now: PAGE_CLOSED });
    expect(screen.getByText('Shared between 2 players')).toBeTruthy();
    expect(screen.getByText('Andreas Booker')).toBeTruthy();
    expect(screen.getByText('Nikos Away')).toBeTruthy();
    expect(screen.getAllByText('2 votes')).toHaveLength(2);
    expect(screen.queryByTestId('cast-vote')).toBeNull();
  });

  it('closed with no votes: an empty state', async () => {
    await show({ now: PAGE_CLOSED });
    expect(screen.getByText('No votes were cast.')).toBeTruthy();
  });

  it('nothing for a forfeit', async () => {
    const { view } = await show({ page: mockMatchPage({ forfeit: { side: 'b', reason: 'no_show' } }) });
    expect(view.toJSON()).toBeNull();
  });
});
