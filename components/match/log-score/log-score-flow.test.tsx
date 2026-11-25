import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { LogScoreFlow } from '@/components/match/log-score/log-score-flow';
import { mockLogPlayer, mockMatchLog, mockNamedLog } from '@/lib/match/log-score-mock';
import { logMatchResult, setMatchStats } from '@/lib/match/log-score-api';
import type { MatchLog } from '@/lib/match/log-score';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/lib/match/log-score-api', () => ({ logMatchResult: jest.fn(), setMatchStats: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() } }));
// Message <captain> on the mismatch screen (follow-up to S13).
const mockContact = jest.fn();
jest.mock('@/lib/messages', () => ({
  ...jest.requireActual('@/lib/messages'),
  fetchMatchCaptainContact: (id: string) => mockContact(id),
  openMatchCaptainConversation: jest.fn(),
}));

const logResult = logMatchResult as jest.Mock;
const correct = setMatchStats as jest.Mock;

beforeEach(() => {
  mockContact.mockReset().mockResolvedValue({ my_team_id: 't1', team_id: 't2', team_name: 'Paphos 5', captain_id: 'p2', captain_name: 'Marios' });
  logResult.mockReset().mockResolvedValue({ result: { status: 'confirmed', tries: 1, maxTries: 3 }, error: null });
  correct.mockReset().mockResolvedValue({ error: null });
});

async function show(log: MatchLog = mockMatchLog()) {
  const props = { onLogged: jest.fn(), onExit: jest.fn(), onOpenMatch: jest.fn(), onStale: jest.fn() };
  await render(<LogScoreFlow log={log} {...props} />);
  return props;
}

const press = (id: string) => fireEvent.press(screen.getByTestId(id));
/** A player's line in the stats payload: every player is listed, with played (decision 1l). */
const row = (playerId: string, goals = 0, assists = 0, played = true) => ({ playerId, goals, assists, played });
const SIDE_A = ['a1', 'a2', 'a3'];
const disabled = (id: string) => screen.getByTestId(id).props.accessibilityState?.disabled === true;
/** The progress bar's value, as a screen reader hears it. */
const width = () => `${screen.getByTestId('log-score-progress-bar').props.accessibilityValue.now}%`;

describe('LogScoreFlow: a pickup the captain booked (both sides his)', () => {
  it('Score (0%), Goals (33%), Assists (66%), Review (100%), then Confirm logs everything', async () => {
    const { onLogged } = await show();
    expect(screen.getByTestId('post-match-step-score')).toBeTruthy();
    expect(width()).toBe('0%');
    expect(screen.getByRole('header', { name: 'Score' })).toBeTruthy();
    expect(screen.getByText('Thu 26 Nov · Kamares · Pitch 2')).toBeTruthy();

    // 2–1: Bibs, Non-bibs.
    await press('add-goal');
    await press('add-goal');
    await press('log-score-b-plus');
    expect(screen.getByTestId('log-score-a-value')).toHaveTextContent('2');
    await press('post-match-next');

    // Goals: both halves open, Continue only once each side adds up exactly.
    expect(screen.getByTestId('post-match-step-goals')).toBeTruthy();
    expect(width()).toBe('33%');
    expect(screen.getByTestId('log-score-half-a')).toBeTruthy();
    expect(screen.getByTestId('log-score-half-b')).toBeTruthy();
    expect(screen.getByTestId('log-score-counter-a')).toHaveTextContent('Bibs 0 of 2');
    expect(disabled('post-match-next')).toBe(true);
    await press('log-score-goal-plus-a2');
    await press('log-score-goal-plus-a2');
    expect(disabled('log-score-goal-plus-a3')).toBe(true); // 2 of 2: no more
    expect(screen.getByTestId('log-score-count-a2')).toHaveTextContent('2');
    expect(disabled('post-match-next')).toBe(true); // Non-bibs still 0 of 1
    await press('log-score-own-goal-b');
    expect(screen.getByTestId('log-score-counter-b')).toHaveTextContent('Non-bibs 1 of 1');
    expect(disabled('post-match-next')).toBe(false);
    await press('post-match-next');

    // Assists: optional, never more than the goals.
    expect(screen.getByTestId('post-match-step-assists')).toBeTruthy();
    expect(width()).toBe('66%');
    expect(screen.getByTestId('log-score-counter-a')).toHaveTextContent('Bibs 0 of up to 2 · optional');
    expect(disabled('post-match-next')).toBe(false);
    await press('log-score-assist-plus-a3');
    await press('post-match-next');

    // Review: text only.
    expect(screen.getByTestId('post-match-step-review')).toBeTruthy();
    expect(width()).toBe('100%');
    expect(screen.getByTestId('log-score-win-a')).toBeTruthy();
    expect(screen.getByTestId('log-score-review-goals-a')).toHaveTextContent(/Panos2/);
    expect(screen.getByTestId('log-score-review-goals-b')).toHaveTextContent(/Own goal1/);
    expect(screen.getByTestId('log-score-review-assists-a')).toHaveTextContent(/1 of 2 goals assisted.*Dimitris1/);
    expect(screen.queryByTestId('scorers-editor')).toBeNull(); // no lineup picture
    await press('post-match-done');

    expect(logResult).toHaveBeenCalledWith('m1', { a: 2, b: 1 }, {
      a: { players: [row('a1'), row('a2', 2), row('a3', 0, 1)], ownGoals: 0 },
      b: { players: [row('b1'), row('b2')], ownGoals: 1 },
    });
    expect(onLogged).toHaveBeenCalledWith('confirmed');
  });

  it('Continue is allowed with no assists at all', async () => {
    await show(mockMatchLog({ myEntry: { a: 1, b: 0 }, stats: { a: { players: [{ playerId: 'a2', goals: 1, assists: 0 }], ownGoals: 0 }, b: { players: [], ownGoals: 0 } } }));
    await press('post-match-next'); // score
    await press('post-match-next'); // goals: 1 of 1
    expect(disabled('post-match-next')).toBe(false);
    await press('post-match-next'); // assists: none
    expect(screen.getByTestId('post-match-step-review')).toBeTruthy();
    expect(screen.queryByTestId('log-score-review-assists')).toBeNull(); // empty section hidden
  });

  it('Back moves a step back; on the first step it leaves', async () => {
    const { onExit } = await show();
    await press('post-match-next');
    await press('log-score-back');
    expect(screen.getByTestId('post-match-step-score')).toBeTruthy();
    await press('log-score-back');
    expect(onExit).toHaveBeenCalled();
  });

  it('a refusal shows one line; a stale one reloads the match', async () => {
    logResult.mockResolvedValue({ result: null, error: { message: 'result_window_closed' } });
    const { onStale, onLogged } = await show();
    await press('post-match-next');
    await press('post-match-next');
    await press('post-match-next');
    await press('post-match-done');
    expect(screen.getByText('The time to log this score has passed.')).toBeTruthy();
    expect(onStale).toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
  });
});

describe('LogScoreFlow: two captains (he does not know the opposition)', () => {
  it('only his half is open; the other side is locked with its score only', async () => {
    await show(mockNamedLog());
    await press('add-goal');
    await press('log-score-b-plus');
    await press('log-score-b-plus');
    await press('post-match-next');
    expect(screen.getByTestId('log-score-half-a')).toBeTruthy();
    expect(screen.queryByTestId('log-score-half-b')).toBeNull();
    expect(screen.getByTestId('log-score-locked-b')).toHaveTextContent(/Paphos 5 · 2 goals.*Logged by their captain/);
    expect(screen.getByTestId('log-score-counter-b')).toHaveTextContent('Paphos 5 locked');
    expect(screen.queryByTestId('log-score-goal-plus-b1')).toBeNull();
    await press('log-score-goal-plus-a1');
    await press('post-match-next');
    expect(screen.getByTestId('log-score-locked-b')).toHaveTextContent(/assists locked/);
    await press('post-match-next');
    expect(screen.getByTestId('log-score-review-goals-b')).toHaveTextContent(/2 goals.*Logged by their captain/);
    await press('post-match-done');
    expect(logResult).toHaveBeenCalledWith('m1', { a: 1, b: 2 }, { a: { players: [row('a1', 1), row('a2'), row('a3')], ownGoals: 0 } });
  });

  it('waiting for the other captain: his score, Open match, Change score', async () => {
    const { onOpenMatch } = await show(mockNamedLog({ myEntry: { a: 1, b: 0 } }));
    expect(screen.getByTestId('log-score-waiting')).toBeTruthy();
    expect(screen.getByTestId('log-score-mine')).toHaveTextContent(/Kato United 1 : 0 Paphos 5/);
    await press('post-match-open-match');
    expect(onOpenMatch).toHaveBeenCalled();
    await press('log-score-change');
    expect(screen.getByTestId('post-match-step-score')).toBeTruthy();
  });

  it('the scores differ: both shown, tries left; changing only their side keeps his goals (Score → Review)', async () => {
    const log = mockNamedLog({
      myEntry: { a: 4, b: 1 },
      theirEntry: { a: 4, b: 2 },
      tries: 1,
      stats: { a: { players: [{ playerId: 'a2', goals: 4, assists: 0 }], ownGoals: 0 } },
    });
    await show(log);
    expect(screen.getByTestId('log-score-mismatch')).toBeTruthy();
    expect(screen.getByText("Scores don't match. Check with their captain.")).toBeTruthy();
    expect(screen.getByTestId('log-score-theirs')).toHaveTextContent(/Kato United 4 : 2 Paphos 5/);
    expect(screen.getByTestId('log-score-tries')).toHaveTextContent('2 tries left');
    await press('log-score-change');
    await press('log-score-b-plus'); // 4–2: only their side
    await press('post-match-next');
    expect(screen.getByTestId('post-match-step-review')).toBeTruthy();
    await press('post-match-done');
    expect(logResult).toHaveBeenCalledWith('m1', { a: 4, b: 2 }, {});
  });

  it('offers Message <captain> for the match, under Change score', async () => {
    await show(mockNamedLog({ myEntry: { a: 4, b: 1 }, theirEntry: { a: 4, b: 2 }, tries: 1 }));
    expect(await screen.findByTestId('score-mismatch-message-captain')).toHaveTextContent('Message Marios');
    expect(mockContact).toHaveBeenCalledWith('m1');
  });

  it('no Message <captain> when a side has no team: the server is not asked', async () => {
    await show(
      mockNamedLog({
        sides: [
          { side: 'a', label: 'Bibs', teamId: null },
          { side: 'b', label: 'Non-bibs', teamId: 't2' },
        ],
        myEntry: { a: 4, b: 1 },
        theirEntry: { a: 4, b: 2 },
        tries: 1,
      }),
    );
    expect(screen.getByTestId('log-score-mismatch')).toBeTruthy();
    expect(mockContact).not.toHaveBeenCalled();
    expect(screen.queryByTestId('score-mismatch-message-captain')).toBeNull();
  });

  it('changing his own side reopens Goals and Assists (4–1 becomes 5–1: one more scorer)', async () => {
    const log = mockNamedLog({
      myEntry: { a: 4, b: 1 },
      theirEntry: { a: 5, b: 1 },
      stats: { a: { players: [{ playerId: 'a2', goals: 4, assists: 0 }], ownGoals: 0 } },
    });
    await show(log);
    await press('log-score-change');
    await press('add-goal');
    await press('post-match-next');
    expect(screen.getByTestId('post-match-step-goals')).toBeTruthy();
    expect(screen.getByTestId('log-score-counter-a')).toHaveTextContent('Kato United 4 of 5');
    expect(disabled('post-match-next')).toBe(true);
    await press('log-score-goal-plus-a3');
    await press('post-match-next');
    await press('post-match-next');
    await press('post-match-done');
    expect(logResult).toHaveBeenCalledWith('m1', { a: 5, b: 1 }, {
      a: { players: [row('a1'), row('a2', 4), row('a3', 1)], ownGoals: 0 },
    });
  });

  it('1 try left says so', async () => {
    await show(mockNamedLog({ myEntry: { a: 1, b: 0 }, theirEntry: { a: 0, b: 1 }, tries: 2 }));
    expect(screen.getByTestId('log-score-tries')).toHaveTextContent('1 try left');
  });
});

describe('LogScoreFlow: a correction (24 hours after the result)', () => {
  const stats = {
    a: { players: [{ playerId: 'a2', goals: 1, assists: 0 }], ownGoals: 0 },
    b: { players: [], ownGoals: 0 },
  };

  // Decided 25 November: a lone captain can correct the score too.
  it('a lone captain: Score → Goals → Assists → Review; a changed score needs its goals redone', async () => {
    const log = mockMatchLog({ status: 'confirmed', score: { a: 1, b: 0 }, canLog: false, canCorrect: true, stats });
    const { onLogged } = await show(log);
    expect(screen.getByTestId('post-match-step-score')).toBeTruthy();
    await press('add-goal');
    await press('post-match-next');
    expect(screen.getByTestId('log-score-counter-a')).toHaveTextContent('Bibs 1 of 2');
    expect(disabled('post-match-next')).toBe(true);
    await press('log-score-goal-plus-a3');
    await press('post-match-next');
    await press('post-match-next');
    await press('save-scorers');
    expect(correct).toHaveBeenCalledWith(
      'm1',
      {
        a: { players: SIDE_A.map((id) => row(id, id === 'a1' ? 0 : 1)), ownGoals: 0 },
        b: { players: [row('b1'), row('b2')], ownGoals: 0 },
      },
      { a: 2, b: 0 }
    );
    expect(logResult).not.toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledWith('corrected');
  });

  it('two captains: Goals → Assists → Review, the agreed score fixed', async () => {
    const log = mockNamedLog({
      status: 'confirmed',
      score: { a: 1, b: 0 },
      canLog: false,
      canCorrect: true,
      stats: { a: stats.a },
    });
    await show(log);
    expect(screen.getByTestId('post-match-step-goals')).toBeTruthy();
    expect(screen.queryByTestId('post-match-step-score')).toBeNull();
    await press('log-score-goal-minus-a2');
    await press('log-score-goal-plus-a3');
    await press('post-match-next');
    await press('post-match-next');
    await press('save-scorers');
    expect(correct).toHaveBeenCalledWith('m1', {
      a: { players: SIDE_A.map((id) => row(id, id === 'a3' ? 1 : 0)), ownGoals: 0 },
    });
  });
});

// S12 (spec 05 section 16, A5): get_match_log sends a minor's first name
// only. The logging screens show exactly the name the server sent: no
// username, no surname, nothing rebuilt from the profile.
describe('LogScoreFlow: a teammate under 18', () => {
  const players = [
    mockLogPlayer('a1', 'a', 'Kostas Ioannou'),
    mockLogPlayer('a2', 'a', 'Eleni'),
    mockLogPlayer('b1', 'b', 'Marios Charalambous'),
  ];

  it('shows the first name the server sent on the pitch and in the review', async () => {
    await show(mockMatchLog({ players }));
    await press('add-goal');
    await press('post-match-next');

    expect(within(screen.getByTestId('log-score-player-a2')).getByText('Eleni')).toBeTruthy();
    await press('log-score-goal-plus-a2');
    await press('post-match-next');
    expect(within(screen.getByTestId('log-score-player-a2')).getByText('Eleni')).toBeTruthy();
    await press('post-match-next');

    expect(screen.getByTestId('log-score-review-goals-a')).toHaveTextContent(/Eleni1/);
    expect(screen.queryByText(/prof-a2/)).toBeNull();
    expect(screen.getByTestId('log-score-review-goals-a')).not.toHaveTextContent(/Eleni \w/);
  });
});

// Decision 1l (25 November): the captain confirms who played on the Goals
// step. Everyone on his sides counts as played; "Didn't play" greys a
// player out so they can't score or assist.
describe("LogScoreFlow: Didn't play", () => {
  const spotDisabled = (id: string) => screen.getByTestId(`log-score-player-${id}`).props.accessibilityState?.disabled === true;

  it('toggles a player out and back, blocking + for goals and assists, and sends played false', async () => {
    await show();
    await press('add-goal');
    await press('post-match-next');

    expect(spotDisabled('a2')).toBe(false);
    await press('log-score-didnt-play-a2');
    expect(spotDisabled('a2')).toBe(true);
    expect(disabled('log-score-goal-plus-a2')).toBe(true);
    await press('log-score-didnt-play-a2');
    expect(spotDisabled('a2')).toBe(false);
    expect(disabled('log-score-goal-plus-a2')).toBe(false);

    await press('log-score-didnt-play-a3');
    await press('log-score-goal-plus-a2');
    await press('post-match-next');
    expect(spotDisabled('a3')).toBe(true);
    expect(disabled('log-score-assist-plus-a3')).toBe(true);
    expect(screen.queryByTestId('log-score-didnt-play-a3')).toBeNull(); // Goals only
    await press('post-match-next');
    await press('post-match-done');

    const stats = logResult.mock.calls[0][2];
    expect(stats.a.players).toContainEqual({ playerId: 'a3', goals: 0, assists: 0, played: false });
    expect(stats.a.players).toContainEqual({ playerId: 'a2', goals: 1, assists: 0, played: true });
  });

  it('no control for a QR check-in or on the other captain\'s locked side', async () => {
    const log = mockNamedLog({
      players: [
        { ...mockLogPlayer('a1', 'a', 'Kostas'), checkIn: 'qr' },
        mockLogPlayer('a2', 'a', 'Panos'),
        mockLogPlayer('b1', 'b', 'Marios'),
      ],
    });
    await show(log);
    await press('add-goal');
    await press('post-match-next');
    expect(screen.queryByTestId('log-score-didnt-play-a1')).toBeNull();
    expect(screen.getByTestId('log-score-didnt-play-a2')).toBeTruthy();
    expect(screen.queryByTestId('log-score-didnt-play-b1')).toBeNull();
  });
});
