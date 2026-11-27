// S15: the Team of the Week pitch (images 13, 15): the format's shape with
// the keeper at the bottom, each player's name, rating and goals, empty
// slots marked, and a tap opens the player. A minor shows by first name only.
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { PlayerOfTheWeekCard } from '@/components/match/player-of-the-week-card';
import { NO_ELIGIBLE_PLAYER, pitchPlayerLabel, TotwPitch } from '@/components/match/totw-pitch';
import type { TeamOfTheWeekPlayer, TeamShape } from '@/lib/match/stats-api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const SHAPES: Record<string, TeamShape> = {
  '5-a-side': { format: '5-a-side', keepers: 1, defenders: 1, midfielders: 2, strikers: 1 },
  '7-a-side': { format: '7-a-side', keepers: 1, defenders: 2, midfielders: 3, strikers: 1 },
  '11-a-side': { format: '11-a-side', keepers: 1, defenders: 4, midfielders: 3, strikers: 3 },
};

let n = 0;
const player = (over: Partial<TeamOfTheWeekPlayer>): TeamOfTheWeekPlayer => ({
  profile_id: `p${++n}`,
  name: `Player ${n}`,
  slot: 'mid',
  sort: n,
  games: 1,
  goals: 1,
  assists: 0,
  clean_sheets: 0,
  average_rating: 7.5,
  player_of_the_week: false,
  ...over,
});

/** A full team in the shape, keeper first. */
function full(shape: TeamShape): TeamOfTheWeekPlayer[] {
  const slots = [
    ...Array(shape.keepers).fill('gk'),
    ...Array(shape.defenders).fill('def'),
    ...Array(shape.midfielders).fill('mid'),
    ...Array(shape.strikers).fill('fwd'),
  ] as TeamOfTheWeekPlayer['slot'][];
  return slots.map((slot) => player({ slot }));
}

beforeEach(() => {
  mockPush.mockClear();
  n = 0;
});

describe('TotwPitch', () => {
  it.each(Object.entries(SHAPES))('%s: every player in the shape, strikers at the top, keeper at the bottom', async (_, shape) => {
    const players = full(shape);
    await render(<TotwPitch players={players} shape={shape} />);
    for (const p of players) expect(screen.getByTestId(`totw-pitch-player-${p.profile_id}`)).toBeTruthy();
    const rows = screen.getAllByTestId(/^totw-pitch-row-/).map((r) => r.props.testID);
    expect(rows).toEqual(['totw-pitch-row-fwd', 'totw-pitch-row-mid', 'totw-pitch-row-def', 'totw-pitch-row-gk']);
    expect(within(screen.getByTestId('totw-pitch-row-fwd')).getAllByRole('button')).toHaveLength(shape.strikers);
    expect(within(screen.getByTestId('totw-pitch-row-gk')).getAllByRole('button')).toHaveLength(1);
  });

  it('each player: name, rating and goals and assists; the keeper’s clean sheet', async () => {
    const players = [
      player({ profile_id: 'st', name: 'Panos', slot: 'fwd', goals: 4, assists: 1, average_rating: 8.94, player_of_the_week: true }),
      player({ profile_id: 'gk', name: 'Kostas', slot: 'gk', goals: 0, clean_sheets: 1, average_rating: 7.4 }),
    ];
    await render(<TotwPitch players={players} shape={SHAPES['5-a-side']} />);
    expect(screen.getByText('Panos')).toBeTruthy();
    expect(screen.getByText('8.9')).toBeTruthy();
    expect(screen.getByText('4 G · 1 A')).toBeTruthy();
    expect(screen.getByText('1 clean sheet')).toBeTruthy();
    expect(screen.getByLabelText('Panos, Striker, rating 8.9, 4 G · 1 A, Player of the week')).toBeTruthy();
    expect(screen.getByLabelText('Kostas, Goalkeeper, rating 7.4, 1 clean sheet')).toBeTruthy();
  });

  it('too few eligible players: the rest say "No eligible player" (decision 1k item 4.4)', async () => {
    await render(<TotwPitch players={[player({ slot: 'fwd' })]} shape={SHAPES['5-a-side']} />);
    expect(screen.getAllByText(NO_ELIGIBLE_PLAYER)).toHaveLength(4);
    expect(screen.getByTestId('totw-pitch-empty-gk-0')).toBeTruthy();
    expect(screen.getByTestId('totw-pitch-empty-mid-1')).toBeTruthy();
    expect(screen.getByLabelText('Goalkeeper: No eligible player')).toBeTruthy();
  });

  it('a tap opens the player’s profile; a caller can take the tap instead', async () => {
    const p = player({ profile_id: 'abc', slot: 'fwd' });
    await render(<TotwPitch players={[p]} shape={SHAPES['5-a-side']} />);
    await fireEvent.press(screen.getByTestId('totw-pitch-player-abc'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'abc' } });

    const onPress = jest.fn();
    await render(<TotwPitch players={[p]} shape={SHAPES['5-a-side']} onPressPlayer={onPress} />);
    await fireEvent.press(screen.getByTestId('totw-pitch-player-abc'));
    expect(onPress).toHaveBeenCalledWith(p);
  });

  it('pitchPlayerLabel leaves out what isn’t there', () => {
    expect(pitchPlayerLabel(player({ name: 'Nikos', slot: 'def', goals: 0, average_rating: 7 }))).toBe('Nikos, Defence, rating 7.0');
  });
});

describe('PlayerOfTheWeekCard', () => {
  it('name, games, goals and assists, and the rating; no team; a tap opens the profile', async () => {
    const p = player({ profile_id: 'pa', name: 'Panos', games: 2, goals: 4, assists: 1, average_rating: 8.9, player_of_the_week: true });
    await render(<PlayerOfTheWeekCard player={p} />);
    expect(screen.getByText('Player of the week')).toBeTruthy();
    expect(screen.getByText('Panos')).toBeTruthy();
    expect(screen.getByText('2 games · 4 goals, 1 assist')).toBeTruthy();
    expect(screen.getByText('8.9')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('potw-card'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'pa' } });
  });
});

// Spec 05 section 16 (A5): the server names a minor by first name only to
// everyone else (get_public_profiles; supabase/tests/match-s15-rankings).
// The pitch and the card show exactly that name, and nothing else about them.
describe('an under-18 player', () => {
  const minor = player({ profile_id: 'minor', name: 'Eleni', slot: 'fwd', games: 2, goals: 3, average_rating: 8.4, player_of_the_week: true });

  it('on the pitch: first name only, in the text and what a screen reader says', async () => {
    await render(<TotwPitch players={[minor]} shape={SHAPES['5-a-side']} />);
    const spot = screen.getByTestId('totw-pitch-player-minor');
    expect(within(spot).getByText('Eleni')).toBeTruthy();
    expect(spot.props.accessibilityLabel).toBe('Eleni, Striker, rating 8.4, 3 G, Player of the week');
    expect(screen.queryByText(/Constantinou/)).toBeNull();
  });

  it('on the Player of the week card: first name only', async () => {
    await render(<PlayerOfTheWeekCard player={minor} />);
    expect(screen.getByText('Eleni')).toBeTruthy();
    expect(screen.getByTestId('potw-card').props.accessibilityLabel).toBe('Player of the week: Eleni, 2 games · 3 goals, rating 8.4');
    expect(screen.queryByText(/Constantinou/)).toBeNull();
  });
});
