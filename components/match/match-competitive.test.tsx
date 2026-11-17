import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { MatchCompetitive } from '@/components/match/match-competitive';
import { setMatchCompetitive } from '@/lib/match/levels-api';
import { mockResultMatch, RESULT_AFTER_END, RESULT_BEFORE_KICKOFF } from '@/lib/match/mock';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/lib/match/levels-api', () => ({ setMatchCompetitive: jest.fn() }));

const set = setMatchCompetitive as jest.Mock;

beforeEach(() => set.mockReset().mockResolvedValue({ error: null }));

describe('MatchCompetitive', () => {
  it('shows which it is: a pickup is casual by default', async () => {
    await render(<MatchCompetitive match={mockResultMatch({ status: 'scheduled' })} captainSide={null} onChanged={jest.fn()} now={RESULT_BEFORE_KICKOFF} />);
    expect(screen.getByTestId('competitive-label')).toHaveTextContent('Casual');
    expect(screen.queryByTestId('competitive-switch')).toBeNull();
  });

  it('a captain switches it before kickoff', async () => {
    const onChanged = jest.fn();
    await render(<MatchCompetitive match={mockResultMatch({ status: 'scheduled' })} captainSide="a" onChanged={onChanged} now={RESULT_BEFORE_KICKOFF} />);
    await fireEvent.press(screen.getByText('Competitive'));
    expect(set).toHaveBeenCalledWith('m1', true);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('read-only after kickoff, even for a captain', async () => {
    await render(<MatchCompetitive match={mockResultMatch({ status: 'scheduled', competitive: true })} captainSide="a" onChanged={jest.fn()} now={RESULT_AFTER_END} />);
    expect(screen.getByTestId('competitive-label')).toHaveTextContent('Competitive');
    expect(screen.queryByTestId('competitive-switch')).toBeNull();
  });

  it('read-only for a player who is not a captain', async () => {
    await render(<MatchCompetitive match={mockResultMatch({ kind: 'named', status: 'scheduled' })} captainSide={null} onChanged={jest.fn()} now={RESULT_BEFORE_KICKOFF} />);
    expect(screen.getByTestId('competitive-label')).toHaveTextContent('Competitive');
    expect(screen.queryByTestId('competitive-switch')).toBeNull();
  });

  it('a refusal shows in words and reloads the match', async () => {
    set.mockResolvedValue({ error: { message: 'competitive_locked' } });
    const onChanged = jest.fn();
    await render(<MatchCompetitive match={mockResultMatch({ status: 'scheduled' })} captainSide="a" onChanged={onChanged} now={RESULT_BEFORE_KICKOFF} />);
    await fireEvent.press(screen.getByText('Competitive'));
    await waitFor(() => expect(screen.getByText('This can only be changed before kickoff.')).toBeTruthy());
    expect(onChanged).toHaveBeenCalled();
  });
});
