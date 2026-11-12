import { fireEvent, render, screen } from '@testing-library/react-native';

import { squadPostParams, SquadNeedPanel, type SquadNeedPanelProps } from '@/components/booking/squad-need';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const booking = { id: 'b1', venueId: 'v1', kickoffAt: '2026-11-16T17:00:00+00:00', format: '5-a-side', openSpots: 6 };

describe('squadPostParams', () => {
  it('a Need players post is linked to the booking, at its kickoff, with no payment choice', () => {
    const params = squadPostParams(booking, { type: 'players', playersNeeded: 3, level: 'Casual', positionNeeded: 'Goalkeeper' });
    expect(params).toEqual({
      venueId: 'v1',
      scheduledAt: '2026-11-16T17:00:00+00:00',
      format: '5-a-side',
      postType: 'players',
      venueBookingId: 'b1',
      level: 'Casual',
      playersNeeded: 3,
      positionNeeded: 'Goalkeeper',
      levelNeeded: undefined,
    });
    expect(params).not.toHaveProperty('paymentMode');
  });

  it('a Need opposition post names the team and has no payment choice either', () => {
    const params = squadPostParams(booking, { type: 'opposition', teamId: 't1', levelNeeded: 'Gold' });
    expect(params).toEqual({
      venueId: 'v1',
      scheduledAt: '2026-11-16T17:00:00+00:00',
      format: '5-a-side',
      postType: 'opposition',
      venueBookingId: 'b1',
      level: undefined,
      teamId: 't1',
      levelNeeded: 'Gold',
    });
    expect(params).not.toHaveProperty('paymentMode');
  });
});

function props(overrides: Partial<SquadNeedPanelProps> = {}): SquadNeedPanelProps {
  return {
    openSpots: 6,
    captainTeams: [{ id: 't1', name: 'Latsia Lions' }],
    posted: {},
    busy: null,
    error: null,
    onPost: jest.fn(),
    onCancelPost: jest.fn(),
    ...overrides,
  };
}

describe('SquadNeedPanel', () => {
  it('Need players: asks how many (the open spots by default) and posts', async () => {
    const p = props();
    await render(<SquadNeedPanel {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Need players' }));
    expect(screen.getByLabelText('How many more players?').props.value).toBe('6');
    await fireEvent.changeText(screen.getByLabelText('How many more players?'), '2');
    await fireEvent.press(screen.getByRole('button', { name: 'Goalkeeper' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Post: need 2 players' }));
    expect(p.onPost).toHaveBeenCalledWith({
      type: 'players',
      playersNeeded: 2,
      level: undefined,
      positionNeeded: 'Goalkeeper',
      levelNeeded: undefined,
    });
  });

  it('Need opposition: pick the team, then post; no payment choice is offered', async () => {
    const p = props();
    await render(<SquadNeedPanel {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Need opposition' }));
    expect(screen.queryByText(/Gipedo Pano/)).toBeNull();
    expect(screen.queryByText(/Split/)).toBeNull();
    const post = () => screen.getByRole('button', { name: 'Post: need opposition' });
    expect(post().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Latsia Lions' }));
    await fireEvent.press(post());
    expect(p.onPost).toHaveBeenCalledWith({ type: 'opposition', teamId: 't1', level: undefined, levelNeeded: undefined });
  });

  it('only a captain can post for opposition', async () => {
    await render(<SquadNeedPanel {...props({ captainTeams: [] })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Need opposition' }));
    expect(screen.getByText('Only a team captain can post for opposition.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Post: need opposition' })).toBeNull();
  });

  it('an open post can be cancelled from the same place', async () => {
    const p = props({ posted: { players: 'post1' } });
    await render(<SquadNeedPanel {...p} />);
    expect(screen.queryByRole('button', { name: 'Need players' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel players post' }));
    expect(p.onCancelPost).toHaveBeenCalledWith('players');
  });
});
