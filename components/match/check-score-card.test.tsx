import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { CheckScoreCard } from '@/components/match/check-score-card';
import { respondToMatchScore } from '@/lib/match/score-check-api';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/match/score-check-api', () => ({ respondToMatchScore: jest.fn() }));

const respond = respondToMatchScore as jest.Mock;

const score = {
  matchId: 'm1',
  kickoffAt: '2026-11-25T18:00:00.000Z',
  labelA: 'Bibs',
  labelB: 'Non-bibs',
  sideAScore: 2,
  sideBScore: 1,
  checkUntil: '2026-11-26T20:00:00.000Z',
};
const NOW = Date.parse('2026-11-26T15:00:00.000Z');

beforeEach(() => respond.mockReset().mockResolvedValue({ result: { status: 'accepted', ignored: false }, error: null }));

describe('CheckScoreCard (levels like Playtomic, Panos 25 November)', () => {
  it('shows the score and the countdown', async () => {
    await render(<CheckScoreCard score={score} onAnswered={jest.fn()} now={NOW} />);
    expect(screen.getByText('Check the score')).toBeTruthy();
    expect(screen.getByText('Bibs 2–1 Non-bibs')).toBeTruthy();
    expect(screen.getByTestId('check-score-countdown-m1')).toHaveTextContent(
      '5 hours left. No answer counts as accepted.'
    );
  });

  it('Accept sends true and reloads', async () => {
    const onAnswered = jest.fn();
    await render(<CheckScoreCard score={score} onAnswered={onAnswered} now={NOW} />);
    await fireEvent.press(screen.getByTestId('check-score-accept-m1'));
    expect(respond).toHaveBeenCalledWith('m1', true);
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
  });

  it('Reject sends false and reloads', async () => {
    respond.mockResolvedValue({ result: { status: 'rejected', ignored: false }, error: null });
    const onAnswered = jest.fn();
    await render(<CheckScoreCard score={score} onAnswered={onAnswered} now={NOW} />);
    await fireEvent.press(screen.getByTestId('check-score-reject-m1'));
    expect(respond).toHaveBeenCalledWith('m1', false);
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
  });

  it('a refusal shows in words and reloads', async () => {
    respond.mockResolvedValue({ result: null, error: { message: 'cannot_check_score' } });
    const onAnswered = jest.fn();
    await render(<CheckScoreCard score={score} onAnswered={onAnswered} now={NOW} />);
    await fireEvent.press(screen.getByTestId('check-score-accept-m1'));
    await waitFor(() => expect(screen.getByText("Only the other side's players can check this score.")).toBeTruthy());
    expect(onAnswered).toHaveBeenCalled();
  });

  it("hidden for the booker's side (the server says they can't answer)", async () => {
    await render(<CheckScoreCard score={score} canAnswer={false} onAnswered={jest.fn()} now={NOW} />);
    expect(screen.queryByTestId('check-score-card-m1')).toBeNull();
  });

  it('hidden once its 24 hours have passed', async () => {
    await render(<CheckScoreCard score={score} onAnswered={jest.fn()} now={Date.parse(score.checkUntil)} />);
    expect(screen.queryByTestId('check-score-card-m1')).toBeNull();
  });
});
