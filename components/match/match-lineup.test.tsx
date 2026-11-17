import { fireEvent, render, screen } from '@testing-library/react-native';

import { MatchLineup } from '@/components/match/match-lineup';
import { mockMatchPage, mockPagePlayer, mockRoster, RESULT_AFTER_END, RESULT_BEFORE_KICKOFF } from '@/lib/match/mock';
import { setMatchLineup } from '@/lib/match/page-api';
import type { Side } from '@/lib/match/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/lib/match/page-api', () => ({ setMatchLineup: jest.fn() }));

const save = setMatchLineup as jest.Mock;
const presets = { status: 'ready' as const, formations: ['1-2-1', '2-2'] };
const scheduled = mockMatchPage({ status: 'scheduled' });

beforeEach(() => save.mockReset().mockResolvedValue({ error: null }));

async function show({
  page = scheduled,
  writable = ['a', 'b'] as Side[],
  now = RESULT_BEFORE_KICKOFF,
}: { page?: ReturnType<typeof mockMatchPage>; writable?: Side[]; now?: number } = {}) {
  const onSaved = jest.fn();
  await render(
    <MatchLineup
      page={page}
      roster={{ status: 'ready', roster: mockRoster() }}
      onRetryRoster={jest.fn()}
      writable={writable}
      presets={presets}
      onRetryPresets={jest.fn()}
      onSaved={onSaved}
      now={now}
    />
  );
  return { onSaved };
}

describe('MatchLineup', () => {
  it('tap a player, then a position: the position is filled and saved with every key', async () => {
    const { onSaved } = await show();
    await fireEvent.press(screen.getByText('Set lineup'));
    expect(screen.getByLabelText('Goalkeeper: Need players')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('squad-p-me'));
    await fireEvent.press(screen.getByTestId('position-gk'));
    expect(screen.getByLabelText('Goalkeeper: Me Player')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('save-lineup'));
    expect(save).toHaveBeenCalledWith('m1', 'a', '1-2-1', { gk: 'p-me', d1: null, m1: null, m2: null, f1: null });
    expect(onSaved).toHaveBeenCalled();
  });

  it('moving a placed player empties their old position; a tap with nobody picked clears one', async () => {
    await show();
    await fireEvent.press(screen.getByText('Set lineup'));
    await fireEvent.press(screen.getByTestId('squad-p-me'));
    await fireEvent.press(screen.getByTestId('position-gk'));
    await fireEvent.press(screen.getByTestId('squad-p-me'));
    await fireEvent.press(screen.getByTestId('position-f1'));
    expect(screen.getByLabelText('Goalkeeper: Need players')).toBeTruthy();
    expect(screen.getByLabelText('Forward 1: Me Player')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('position-f1'));
    expect(screen.getByLabelText('Forward 1: Need players')).toBeTruthy();
  });

  it("only that side's players are offered (not the other side, not left, not unsided)", async () => {
    await show();
    await fireEvent.press(screen.getByText('Set lineup'));
    expect(screen.getByTestId('squad-p-booker')).toBeTruthy();
    expect(screen.getByTestId('squad-p-guest')).toBeTruthy();
    expect(screen.queryByTestId('squad-p-nikos')).toBeNull();
    expect(screen.queryByTestId('squad-p-left')).toBeNull();
    expect(screen.queryByTestId('squad-p-noside')).toBeNull();
  });

  it('changing formation keeps players whose position still exists', async () => {
    await show();
    await fireEvent.press(screen.getByText('Set lineup'));
    await fireEvent.press(screen.getByTestId('squad-p-me'));
    await fireEvent.press(screen.getByTestId('position-d1'));
    await fireEvent.press(screen.getByTestId('formation-2-2'));
    expect(screen.getByLabelText('Defender 1: Me Player')).toBeTruthy();
    expect(screen.getByLabelText('Defender 2: Need players')).toBeTruthy();
  });

  it('every position has an accessibilityLabel', async () => {
    await show();
    await fireEvent.press(screen.getByText('Set lineup'));
    for (const key of ['gk', 'd1', 'm1', 'm2', 'f1']) {
      expect(screen.getByTestId(`position-${key}`).props.accessibilityLabel).toMatch(/: /);
    }
  });

  it('a non-captain sees the lineup but no edit controls', async () => {
    const page = mockMatchPage({
      status: 'scheduled',
      lineups: [{ side: 'a', formation: '2-2', positions: [{ ...mockPagePlayer('p-booker'), key: 'gk' }] }],
    });
    await show({ page, writable: [] });
    expect(screen.getByLabelText('Goalkeeper: Andreas Booker')).toBeTruthy();
    expect(screen.getByLabelText('Defender 1: Need players')).toBeTruthy();
    expect(screen.queryByText('Edit lineup')).toBeNull();
    expect(screen.queryByText('Set lineup')).toBeNull();
  });

  it('after kickoff it is read-only, even for the captain', async () => {
    const page = mockMatchPage({
      status: 'played',
      lineups: [{ side: 'a', formation: '2-2', positions: [{ ...mockPagePlayer('p-me'), key: 'f2' }] }],
    });
    await show({ page, now: RESULT_AFTER_END });
    expect(screen.getByLabelText('Forward 2: Me Player')).toBeTruthy();
    expect(screen.queryByText('Edit lineup')).toBeNull();
    expect(screen.getByTestId('position-f2').props.accessibilityState?.disabled).toBe(true);
  });

  it('no lineup yet: an empty state', async () => {
    await show({ writable: [] });
    expect(screen.getByText('No lineup set yet.')).toBeTruthy();
  });

  it('a server error is shown in plain words', async () => {
    save.mockResolvedValue({ error: { message: 'lineup_locked' } });
    const { onSaved } = await show();
    await fireEvent.press(screen.getByText('Set lineup'));
    await fireEvent.press(screen.getByTestId('save-lineup'));
    expect(await screen.findByText('Lineups lock at kickoff.', { exact: true })).toBeTruthy();
    expect(onSaved).toHaveBeenCalled();
  });
});
