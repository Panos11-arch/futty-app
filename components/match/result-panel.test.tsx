import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { MatchResultPanel } from '@/components/match/result-panel';
import {
  mockResultMatch,
  RESULT_AFTER_END,
  RESULT_BEFORE_KICKOFF,
  RESULT_DEADLINE,
  RESULT_PEOPLE,
} from '@/lib/match/mock';
import { respondToMatchResult, submitMatchResult } from '@/lib/match/results-api';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/lib/match/results-api', () => ({
  submitMatchResult: jest.fn(),
  respondToMatchResult: jest.fn(),
}));

const submit = submitMatchResult as jest.Mock;
const respond = respondToMatchResult as jest.Mock;
const { me, booker, awayCaptain } = RESULT_PEOPLE;
const none = new Set<string>();
// 18:00Z on 15 Nov is 20:00 in Cyprus.
const DEADLINE_TEXT = 'Sun 15 Nov · 20:00';

beforeEach(() => {
  submit.mockReset().mockResolvedValue({ error: null });
  respond.mockReset().mockResolvedValue({ error: null });
});

async function show(props: Partial<React.ComponentProps<typeof MatchResultPanel>> & { viewerId: string | null }) {
  const onChanged = jest.fn();
  await render(
      <MatchResultPanel
        match={mockResultMatch()}
        captainTeamIds={none}
        onChanged={onChanged}
        now={RESULT_AFTER_END}
        {...props}
      />
  );
  return { onChanged };
}

describe('MatchResultPanel states', () => {
  it('before kickoff: the kickoff time and when the score opens', async () => {
    await show({ viewerId: booker, match: mockResultMatch({ status: 'scheduled' }), now: RESULT_BEFORE_KICKOFF });
    expect(screen.getByText('19:00')).toBeTruthy();
    expect(screen.getByText('The score can be entered from kickoff.')).toBeTruthy();
    expect(screen.queryByText('Submit score')).toBeNull();
  });

  it('played, for a captain: the form and the deadline in Cyprus time', async () => {
    await show({ viewerId: booker });
    expect(screen.getByText('Waiting for the result')).toBeTruthy();
    expect(screen.getByText(`Enter the score by ${DEADLINE_TEXT}.`)).toBeTruthy();
    expect(screen.getByText('Submit score')).toBeTruthy();
  });

  it('played, for a non-captain: no submit button, just the wait', async () => {
    await show({ viewerId: me, match: mockResultMatch({ mySide: 'a' }) });
    expect(screen.getByText('Waiting for the result')).toBeTruthy();
    expect(screen.getByText(`A captain enters the score by ${DEADLINE_TEXT}.`)).toBeTruthy();
    expect(screen.queryByText('Submit score')).toBeNull();
    expect(screen.queryByText('Accept')).toBeNull();
  });

  it('a submission, seen by the side that entered it', async () => {
    await show({ viewerId: booker, match: mockResultMatch({ submission: {} }) });
    expect(screen.getByText('Bibs 5–3 Non-bibs')).toBeTruthy();
    expect(
      screen.getByText(`Waiting for Non-bibs to accept or reject it. If nobody answers by ${DEADLINE_TEXT}, it stands.`)
    ).toBeTruthy();
    expect(screen.queryByText('Accept')).toBeNull();
  });

  it('a submission, seen by a pickup player with no side', async () => {
    await show({ viewerId: me, match: mockResultMatch({ submission: {}, mySide: null }) });
    expect(
      screen.getByText(`Only Non-bibs players can accept or reject this score, by ${DEADLINE_TEXT}.`)
    ).toBeTruthy();
    expect(screen.queryByText('Accept')).toBeNull();
  });

  it('past the deadline, before the job settles it', async () => {
    await show({ viewerId: booker, now: Date.parse(RESULT_DEADLINE) });
    expect(screen.getByText('The time to enter or answer the result has passed.')).toBeTruthy();
    expect(screen.queryByText('Submit score')).toBeNull();
  });

  it.each([
    ['disputed', 'Disputed · not in stats'],
    ['no_result', 'No result entered'],
    ['void', 'Cancelled'],
  ] as const)('%s shows "%s" and no actions', async (status, words) => {
    await show({ viewerId: booker, match: mockResultMatch({ status, submission: {}, mySide: 'b' }) });
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByText('Submit score')).toBeNull();
    expect(screen.queryByText('Accept')).toBeNull();
  });

  it('confirmed shows the score', async () => {
    await show({ viewerId: booker, match: mockResultMatch({ status: 'confirmed', scores: [5, 3] }) });
    expect(screen.getByText('5 – 3')).toBeTruthy();
  });

  it('a confirmed forfeit shows who pulled out', async () => {
    await show({
      viewerId: booker,
      match: mockResultMatch({ kind: 'named', status: 'confirmed', forfeit: { side: 'b', reason: 'pulled_out' } }),
    });
    expect(screen.getByText('Forfeit')).toBeTruthy();
    expect(screen.getByText('Away FC pulled out')).toBeTruthy();
  });
});

describe('MatchResultPanel actions', () => {
  it('a captain submits the score through submit_match_result', async () => {
    const { onChanged } = await show({ viewerId: booker });
    await fireEvent.changeText(screen.getByLabelText('Bibs'), '5');
    await fireEvent.changeText(screen.getByLabelText('Non-bibs'), '3');
    await fireEvent.press(screen.getByText('Submit score'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith('m1', 5, 3);
  });

  it('pickup: a Non-bibs player accepts', async () => {
    const { onChanged } = await show({ viewerId: me, match: mockResultMatch({ submission: {}, mySide: 'b' }) });
    expect(screen.getByText(`Bibs entered this score. Accept or reject it by ${DEADLINE_TEXT}. If nobody answers by then, it stands.`)).toBeTruthy();
    await fireEvent.press(screen.getByText('Accept'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(respond).toHaveBeenCalledWith('m1', true);
  });

  it('named: the other captain rejects, after confirming', async () => {
    const { onChanged } = await show({
      viewerId: awayCaptain,
      match: mockResultMatch({ kind: 'named', submission: {} }),
    });
    await fireEvent.press(screen.getByText('Reject'));
    expect(respond).not.toHaveBeenCalled();
    expect(screen.getByText('Reject this score? The match will be disputed and not in stats.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Reject score'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(respond).toHaveBeenCalledWith('m1', false);
  });

  it('named: a player on the other side who is not its captain cannot answer', async () => {
    await show({ viewerId: me, match: mockResultMatch({ kind: 'named', submission: {}, mySide: 'b' }) });
    expect(screen.queryByText('Accept')).toBeNull();
    expect(screen.getByText(/Waiting for Away FC to accept or reject it/)).toBeTruthy();
  });

  it.each([
    ['not_captain', 'Only a captain can enter the score.', false],
    ['result_window_closed', 'The time to enter or answer the result has passed.', true],
    ['result_already_submitted', 'The other side has already entered a score. Check it below.', true],
    ['sides_locked', 'Sides are locked once a score is entered.', false],
  ])('submit refused with %s shows plain words', async (code, words, reloads) => {
    submit.mockResolvedValue({ error: { message: code } });
    const { onChanged } = await show({ viewerId: booker });
    await fireEvent.changeText(screen.getByLabelText('Bibs'), '1');
    await fireEvent.changeText(screen.getByLabelText('Non-bibs'), '0');
    await fireEvent.press(screen.getByText('Submit score'));
    expect(await screen.findByText(words)).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(reloads ? 1 : 0);
  });

  it.each([
    ['already_answered', 'This score has already been answered.'],
    ['not_allowed', 'Only the other side can accept or reject this score.'],
  ])('answer refused with %s shows plain words', async (code, words) => {
    respond.mockResolvedValue({ error: { message: code } });
    await show({ viewerId: me, match: mockResultMatch({ submission: {}, mySide: 'b' }) });
    await fireEvent.press(screen.getByText('Accept'));
    expect(await screen.findByText(words)).toBeTruthy();
  });

  it('Submit stays off until both scores are numbers', async () => {
    await show({ viewerId: booker });
    await fireEvent.changeText(screen.getByLabelText('Bibs'), '2');
    await fireEvent.changeText(screen.getByLabelText('Non-bibs'), 'x');
    await fireEvent.press(screen.getByText('Submit score'));
    expect(submit).not.toHaveBeenCalled();
  });
});
