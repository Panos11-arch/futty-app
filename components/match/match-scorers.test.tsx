import { fireEvent, render, screen } from '@testing-library/react-native';

import { MatchScorers } from '@/components/match/match-scorers';
import { mockMatchPage, mockPagePlayer, mockRoster, PAGE_CLOSED, PAGE_OPEN } from '@/lib/match/mock';
import { setMatchGoals } from '@/lib/match/page-api';
import type { Side } from '@/lib/match/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/lib/match/page-api', () => ({ setMatchGoals: jest.fn() }));

const save = setMatchGoals as jest.Mock;

beforeEach(() => save.mockReset().mockResolvedValue({ error: null }));

async function show({
  page = mockMatchPage(),
  writable = ['a', 'b'] as Side[],
  now = PAGE_OPEN,
}: { page?: ReturnType<typeof mockMatchPage>; writable?: Side[]; now?: number } = {}) {
  const onSaved = jest.fn();
  await render(
    <MatchScorers
      page={page}
      roster={{ status: 'ready', roster: mockRoster() }}
      onRetryRoster={jest.fn()}
      writable={writable}
      onSaved={onSaved}
      now={now}
    />
  );
  return { onSaved };
}

const saveButton = () => screen.getByTestId('save-scorers');
const disabled = () => saveButton().props.accessibilityState?.disabled;

describe('MatchScorers', () => {
  it('shows scorers and assists; a null scorer reads "Own goal or unknown"', async () => {
    await show({
      writable: [],
      page: mockMatchPage({
        goals: [
          { side: 'a', scorer: mockPagePlayer('p-me'), assist: mockPagePlayer('p-booker') },
          { side: 'a', scorer: null, assist: null },
          { side: 'b', scorer: mockPagePlayer('p-nikos'), assist: null },
        ],
      }),
    });
    expect(screen.getByText('Bibs 2')).toBeTruthy();
    expect(screen.getByText('Me Player · assist Andreas Booker')).toBeTruthy();
    expect(screen.getByText('Own goal or unknown')).toBeTruthy();
    expect(screen.getByText('Nikos Away')).toBeTruthy();
  });

  it('Save stays off until the number of goals matches the score', async () => {
    const { onSaved } = await show();
    await fireEvent.press(screen.getByText('Add Bibs scorers'));
    expect(disabled()).toBe(true);
    await fireEvent.press(screen.getByText('Add goal'));
    await fireEvent.press(screen.getByTestId('scorer-0-p-me'));
    expect(disabled()).toBe(true); // 1 of 2
    await fireEvent.press(screen.getByText('Add goal'));
    expect(disabled()).toBe(true); // 2 of 2, but goal 2 has no scorer choice yet
    await fireEvent.press(screen.getByTestId('scorer-1-own'));
    expect(disabled()).toBe(false);
    await fireEvent.press(saveButton());
    // The booker writes both sides of a pickup, so the side is sent.
    expect(save).toHaveBeenCalledWith(
      'm1',
      [
        { scorerPlayerId: 'p-me', assistPlayerId: null },
        { scorerPlayerId: null, assistPlayerId: null },
      ],
      'a'
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('a one-side captain sends no side; assists exclude the scorer', async () => {
    await show({ writable: ['b'] });
    await fireEvent.press(screen.getByText('Add Non-bibs scorers'));
    await fireEvent.press(screen.getByText('Add goal'));
    await fireEvent.press(screen.getByTestId('scorer-0-p-nikos'));
    expect(screen.queryByTestId('assist-0-p-nikos')).toBeNull();
    await fireEvent.press(screen.getByTestId('assist-0-p-maria'));
    await fireEvent.press(saveButton());
    expect(save).toHaveBeenCalledWith('m1', [{ scorerPlayerId: 'p-nikos', assistPlayerId: 'p-maria' }], undefined);
  });

  it("guests are offered; the other side's and departed players aren't", async () => {
    await show();
    await fireEvent.press(screen.getByText('Add Bibs scorers'));
    await fireEvent.press(screen.getByText('Add goal'));
    expect(screen.getByTestId('scorer-0-p-guest')).toBeTruthy();
    expect(screen.queryByTestId('scorer-0-p-nikos')).toBeNull();
    expect(screen.queryByTestId('scorer-0-p-left')).toBeNull();
  });

  it("can't add more goals than the score", async () => {
    await show({ writable: ['b'] });
    await fireEvent.press(screen.getByText('Add Non-bibs scorers'));
    await fireEvent.press(screen.getByText('Add goal'));
    expect(screen.getByTestId('add-goal').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText('1 of 1 goals added. The number of goals must match the score.')).toBeTruthy();
  });

  it('a non-captain sees no edit controls', async () => {
    await show({ writable: [] });
    expect(screen.queryByText(/scorers$/)).toBeNull();
    expect(screen.queryByText(/Scorers can be added/)).toBeNull();
  });

  it('after scorersOpenUntil nobody can edit', async () => {
    await show({ now: PAGE_CLOSED });
    expect(screen.queryByText('Add Bibs scorers')).toBeNull();
  });

  it('a server error is shown in plain words', async () => {
    save.mockResolvedValue({ error: { message: 'score_mismatch' } });
    await show({ writable: ['b'] });
    await fireEvent.press(screen.getByText('Add Non-bibs scorers'));
    await fireEvent.press(screen.getByText('Add goal'));
    await fireEvent.press(screen.getByTestId('scorer-0-own'));
    await fireEvent.press(saveButton());
    expect(await screen.findByText('The number of goals must match the score.')).toBeTruthy();
  });
});
