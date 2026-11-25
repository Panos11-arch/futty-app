import { fireEvent, render, screen } from '@testing-library/react-native';

import { pitchSides, PitchStep } from '@/components/match/log-score/pitch-step';
import { ProgressHeader } from '@/components/match/log-score/progress-header';
import { ReviewStep } from '@/components/match/log-score/review-step';
import { ScoreStep } from '@/components/match/log-score/score-step';
import { changeGoals, changeOwnGoals, draftFrom, setScore, type Draft } from '@/lib/match/log-score';
import { mockMatchLog, mockNamedLog } from '@/lib/match/log-score-mock';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);

const disabled = (id: string) => screen.getByTestId(id).props.accessibilityState?.disabled === true;

describe('ProgressHeader', () => {
  it.each([
    ['score', 0],
    ['goals', 33],
    ['assists', 66],
    ['review', 100],
  ] as const)('%s is %s%%, with the four step names', async (step, now) => {
    await render(<ProgressHeader step={step} />);
    expect(screen.getByTestId('log-score-progress-bar').props.accessibilityValue).toEqual({ min: 0, max: 100, now });
    for (const name of ['Score', 'Goals', 'Assists', 'Review']) expect(screen.getByText(name)).toBeTruthy();
  });
});

describe('ScoreStep', () => {
  it("shows both sides' names (team names in a named game), never below 0", async () => {
    const onChange = jest.fn();
    const log = mockNamedLog();
    await render(<ScoreStep log={log} draft={draftFrom(log)} onChange={onChange} />);
    expect(screen.getByText('Kato United')).toBeTruthy();
    expect(screen.getByText('Paphos 5')).toBeTruthy();
    expect(disabled('log-score-a-minus')).toBe(true);
    await fireEvent.press(screen.getByTestId('log-score-b-plus'));
    expect((onChange.mock.calls[0][0] as Draft).score).toEqual({ a: 0, b: 1 });
    expect(screen.getByLabelText('Kato United one goal more')).toBeTruthy();
  });
});

describe('PitchStep', () => {
  it('the caller writes both sides: his side a at the bottom; one captain of a named game: his own side', () => {
    expect(pitchSides(mockMatchLog())).toEqual({ bottom: 'a', top: 'b' });
    expect(pitchSides(mockNamedLog({ writableSides: ['b'] }))).toEqual({ bottom: 'b', top: 'a' });
  });

  it('own goals: + while goals are left, − back to none; the score line at the top', async () => {
    const onChange = jest.fn();
    let draft = setScore(draftFrom(mockMatchLog()), 'a', 1);
    await render(<PitchStep log={mockMatchLog()} draft={draft} mode="goals" onChange={onChange} />);
    expect(screen.getByTestId('log-score-score-line')).toHaveTextContent('Bibs 1 : 0 Non-bibs');
    await fireEvent.press(screen.getByTestId('log-score-own-goal-a'));
    expect((onChange.mock.calls[0][0] as Draft).ownGoals.a).toBe(1);

    draft = changeOwnGoals(draft, 'a', 1);
    await render(<PitchStep log={mockMatchLog()} draft={draft} mode="goals" onChange={onChange} />);
    expect(screen.getByTestId('log-score-own-goal-a')).toHaveTextContent('Own goal 1');
    expect(screen.getByTestId('log-score-own-goal-a').props.accessibilityState).toEqual({ disabled: true });
    expect(screen.getByTestId('log-score-counter-a')).toHaveTextContent('Bibs 1 of 1');
    await fireEvent.press(screen.getByTestId('log-score-own-goal-minus-a'));
    expect((onChange.mock.calls[1][0] as Draft).ownGoals.a).toBe(0);
  });

  it('assists: the goals so far as a reference line, a separate count bubble', async () => {
    let draft = setScore(draftFrom(mockNamedLog()), 'a', 2);
    draft = changeGoals(changeGoals(draft, 'a', 'a2', 1), 'a', 'a2', 1);
    await render(<PitchStep log={mockNamedLog()} draft={draft} mode="assists" onChange={jest.fn()} />);
    expect(screen.getByTestId('log-score-goals-line')).toHaveTextContent('Goals: Panos 2');
    expect(screen.queryByTestId('log-score-count-a2')).toBeNull(); // no assists yet
    expect(screen.getByLabelText('Paphos 5 locked. Logged by their captain')).toBeTruthy();
  });
});

describe('ReviewStep', () => {
  it('a draw has no WIN; empty sections are hidden', async () => {
    const log = mockMatchLog();
    const draft = setScore(setScore(draftFrom(log), 'a', 0), 'b', 0);
    await render(<ReviewStep log={log} draft={draft} />);
    expect(screen.queryByTestId('log-score-win-a')).toBeNull();
    expect(screen.queryByTestId('log-score-win-b')).toBeNull();
    expect(screen.queryByTestId('log-score-review-assists')).toBeNull();
    expect(screen.getByTestId('log-score-review-goals-a')).toHaveTextContent(/0 of 0/);
  });
});
