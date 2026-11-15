import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { GipedoPanel, type GipedoPanelProps } from '@/components/booking/gipedo-panel';
import { loadWithFile } from '@/components/ui/test-utils';
import type { GipedoDetail } from '@/lib/booking-search';

// The pull-out sheet is a Modal: load it with the file, not in the first test.
loadWithFile(Modal, GipedoPanel);

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

function gipedo(overrides: Partial<GipedoDetail> = {}): GipedoDetail {
  return {
    team: { id: 't1', name: 'Lions' },
    opponent: { state: 'held', team: { id: 't2', name: 'Tigers' } },
    my_side: 'a',
    pull_out: { kind: 'fee', cents: 1000, fee_per_player_cents: 100 },
    choice_due: false,
    choice: null,
    play_normal_cents: 6550,
    settlement: null,
    ...overrides,
  };
}

function props(overrides: Partial<GipedoPanelProps> = {}): GipedoPanelProps {
  return {
    gipedo: gipedo(),
    live: true,
    onPullOut: jest.fn(async () => null),
    onChoose: jest.fn(async () => null),
    ...overrides,
  };
}

describe('GipedoPanel', () => {
  it('says where the game stands', async () => {
    await render(<GipedoPanel {...props()} />);
    expect(screen.getByText('Lions v Tigers. Both cards are held; the losing team pays the pitch.')).toBeTruthy();
  });

  it('pulling out shows what it costs first; a second tap confirms', async () => {
    const p = props();
    await render(<GipedoPanel {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pull out' }));
    expect(screen.getByText('€10.00 is taken from your hold (€1.00 per player) and the rest is released.')).toBeTruthy();
    expect(p.onPullOut).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: pull out' }));
    expect(p.onPullOut).toHaveBeenCalledTimes(1);
  });

  it('a refused pull-out shows the server’s reason', async () => {
    const p = props({ onPullOut: jest.fn(async () => "You can't pull out of this game.") });
    await render(<GipedoPanel {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pull out' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: pull out' }));
    expect(await screen.findByText("You can't pull out of this game.")).toBeTruthy();
  });

  it('no pull-out once the game has started, or when the server offers none', async () => {
    await render(<GipedoPanel {...props({ live: false })} />);
    expect(screen.queryByRole('button', { name: 'Pull out' })).toBeNull();
  });

  it('with no opponent, the booking captain chooses: play as normal for the server’s amount, or cancel free', async () => {
    const p = props({ gipedo: gipedo({ opponent: { state: 'none', team: null }, choice_due: true, pull_out: { kind: 'free', cents: 0, fee_per_player_cents: null } }) });
    await render(<GipedoPanel {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Play as normal: €65.50' }));
    expect(p.onChoose).toHaveBeenCalledWith('play_normal');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel free' }));
    expect(p.onChoose).toHaveBeenCalledWith('cancel');
  });

  it('after the match: what the hold paid', async () => {
    await render(
      <GipedoPanel {...props({ live: false, gipedo: gipedo({ pull_out: null, settlement: { reason: 'split', capture_cents: 3275, status: 'done' } }) })} />,
    );
    expect(screen.getByText('Split 50/50: €32.75 was taken from your hold.')).toBeTruthy();
  });
});
