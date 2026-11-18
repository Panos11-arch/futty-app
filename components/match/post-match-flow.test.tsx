import { fireEvent, render, screen } from '@testing-library/react-native';

import { PostMatchFlow, type PostMatchFlowProps } from '@/components/match/post-match-flow';
import type { MatchRatings } from '@/lib/match/levels';
import {
  mockMatchPage,
  mockResultMatch,
  mockRoster,
  PAGE_CLOSED,
  PAGE_CLOSES_AT,
  PAGE_OPEN,
  RESULT_AFTER_END,
  RESULT_PEOPLE,
} from '@/lib/match/mock';
import { NOT_OPEN_YET, POST_MATCH_INTRO, WAITING_FOR_CAPTAIN } from '@/lib/match/post-match';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
// Each step reuses the match page's own panel, tested on its own; here they only show which one is up.
jest.mock('@/components/match/result-panel', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MatchResultPanel: () => <Text testID="step-result-panel">result panel</Text> };
});
jest.mock('@/components/match/match-scorers', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MatchScorers: ({ writable }: { writable: string[] }) => <Text testID="step-scorers">{`scorers ${writable.join(',')}`}</Text> };
});
jest.mock('@/components/match/match-motm', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MatchMotm: () => <Text testID="step-motm">motm</Text> };
});
jest.mock('@/components/match/match-ratings', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MatchRatingsPanel: () => <Text testID="step-ratings">ratings</Text> };
});

const { me: ME, booker: BOOKER } = RESULT_PEOPLE;

const ratings = (over: Partial<MatchRatings> = {}): MatchRatings => ({
  ratingsOpen: true,
  ratingsCloseAt: PAGE_CLOSES_AT,
  players: [],
  myRatings: [],
  ...over,
});

/** The captain straight after the game: score to enter, the rest not open yet. */
function pendingProps(over: Partial<PostMatchFlowProps> = {}): PostMatchFlowProps {
  return {
    match: mockResultMatch({ mySide: 'a' }),
    page: mockMatchPage({ status: 'played' }),
    roster: { status: 'ready', roster: mockRoster() },
    ratings: null,
    viewerId: BOOKER,
    captainTeamIds: new Set(),
    onChanged: jest.fn(),
    onRetryRoster: jest.fn(),
    onDone: jest.fn(),
    now: RESULT_AFTER_END,
    ...over,
  };
}

/** A checked-in player once the result is confirmed: vote and ratings open. */
function confirmedProps(over: Partial<PostMatchFlowProps> = {}): PostMatchFlowProps {
  return pendingProps({
    match: mockResultMatch({ status: 'confirmed', scores: [2, 1], mySide: 'a' }),
    page: mockMatchPage(),
    ratings: { ratings: ratings(), names: {} },
    viewerId: ME,
    now: PAGE_OPEN,
    ...over,
  });
}

const press = (id: string) => fireEvent.press(screen.getByTestId(id));

describe('PostMatchFlow', () => {
  it('starts with the intro, in the decided words', async () => {
    await render(<PostMatchFlow {...pendingProps()} />);
    expect(screen.getByText(POST_MATCH_INTRO)).toBeTruthy();
    expect(POST_MATCH_INTRO).toBe(
      "Add the result and your stats. You'll see them at the end of the week, and they put you in the running for team of the week."
    );
  });

  it('Skip on the intro goes back to the match', async () => {
    const props = pendingProps();
    await render(<PostMatchFlow {...props} />);
    await press('post-match-skip');
    expect(props.onDone).toHaveBeenCalled();
  });

  it('the captain: score, then goals, vote and ratings, which say they open once the result is confirmed', async () => {
    const props = pendingProps();
    await render(<PostMatchFlow {...props} />);
    await press('post-match-start');

    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(screen.getByTestId('step-result-panel')).toBeTruthy();
    await press('post-match-next');

    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    expect(screen.getByText('Goals and assists')).toBeTruthy();
    expect(screen.getByText(NOT_OPEN_YET)).toBeTruthy();
    expect(screen.queryByTestId('step-scorers')).toBeNull();
    await press('post-match-next');

    expect(screen.getByText('Man of the match')).toBeTruthy();
    expect(screen.getByText(NOT_OPEN_YET)).toBeTruthy();
    await press('post-match-next');

    expect(screen.getByText('Step 4 of 4')).toBeTruthy();
    expect(screen.getByText('Player ratings')).toBeTruthy();
    expect(screen.queryByTestId('post-match-next')).toBeNull();
    await press('post-match-done');
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });

  it('a player who is not a captain waits for their captain, and never gets goals', async () => {
    await render(<PostMatchFlow {...pendingProps({ viewerId: ME })} />);
    await press('post-match-start');
    expect(screen.getByText(WAITING_FOR_CAPTAIN)).toBeTruthy();
    expect(screen.queryByTestId('step-result-panel')).toBeNull();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    await press('post-match-next');
    expect(screen.getByText('Man of the match')).toBeTruthy();
  });

  it('every step has Skip, which moves on like Next', async () => {
    await render(<PostMatchFlow {...confirmedProps()} />);
    await press('post-match-start');
    expect(screen.getByTestId('step-motm')).toBeTruthy();
    await press('post-match-skip');
    expect(screen.getByTestId('step-ratings')).toBeTruthy();
    expect(screen.getByTestId('post-match-skip')).toBeTruthy();
  });

  it('Skip on the last step also goes back to the match', async () => {
    const props = confirmedProps();
    await render(<PostMatchFlow {...props} />);
    await press('post-match-start');
    await press('post-match-skip');
    await press('post-match-skip');
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });

  it('once confirmed, the booker adds both sides\' goals with the match page panel', async () => {
    await render(<PostMatchFlow {...confirmedProps({ viewerId: BOOKER })} />);
    await press('post-match-start');
    expect(screen.getByTestId('step-scorers').props.children).toBe('scorers a,b');
  });

  it('a step already done is left out: voted, so ratings come first', async () => {
    await render(<PostMatchFlow {...confirmedProps({ page: mockMatchPage({ myVote: 'p-nikos' }) })} />);
    await press('post-match-start');
    expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    expect(screen.getByTestId('step-ratings')).toBeTruthy();
    expect(screen.getByTestId('post-match-done')).toBeTruthy();
  });

  it('every window closed: nothing to add, and a way back to the match', async () => {
    const props = confirmedProps({ now: PAGE_CLOSED, ratings: { ratings: ratings({ ratingsOpen: false }), names: {} } });
    await render(<PostMatchFlow {...props} />);
    expect(screen.getByText('Nothing to add for this match.')).toBeTruthy();
    expect(screen.queryByText(POST_MATCH_INTRO)).toBeNull();
    await press('post-match-open-match');
    expect(props.onDone).toHaveBeenCalled();
  });

  it('keeps its steps while the data reloads after a save', async () => {
    const props = confirmedProps();
    const { rerender } = await render(<PostMatchFlow {...props} />);
    await press('post-match-start');
    // The vote went in; the reloaded page says so, but the player stays on the step to see it.
    await rerender(<PostMatchFlow {...props} page={mockMatchPage({ myVote: 'p-nikos' })} />);
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.getByTestId('step-motm')).toBeTruthy();
  });
});
