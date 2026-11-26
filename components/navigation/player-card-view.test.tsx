// S19: the card's avatar is a rounded square: green with initials, or the
// player's kit or illustration (S18) on canvas. The night top and the white
// QR bottom keep their colours in dark mode, so the QR always scans.
import { render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { PlayerCardView } from '@/components/navigation/player-card-view';
import { flatStyle, loadWithFile, withTheme } from '@/components/ui/test-utils';
import { darkPalette, lightPalette, radius } from '@/constants/futty-theme';
import type { PlayerCard } from '@/lib/player-card';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-premium-player', () => ({ usePremiumPlayer: () => false }));
jest.mock('react-native-qrcode-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return function QRCodeMock(props: { color: string; backgroundColor: string }) {
    return React.createElement(View, { testID: 'qr', accessibilityHint: `${props.color} on ${props.backgroundColor}` });
  };
});

loadWithFile(Image);

const CARD: PlayerCard = {
  username: 'dimi',
  full_name: 'Dimi Card',
  avatar_style: 'initials',
  avatar_kit_colour: null,
  avatar_number: null,
  avatar_illustration: null,
  level: 3,
  position: 'Forward',
  preferred_foot: 'Left',
  favourite_player: null,
  member_since: '2026-03-01',
  teams: [],
  team_count: 0,
  show_qr: true,
};

async function draw(card: Partial<PlayerCard> = {}, appearance: 'light' | 'dark' = 'light') {
  await render(
    withTheme(<PlayerCardView card={{ ...CARD, ...card }} onOpenProfile={jest.fn()} onOpenQr={jest.fn()} />, {
      appearance,
    }),
  );
}

describe('the avatar', () => {
  it('is a green rounded square with initials by default', async () => {
    await draw();
    const square = flatStyle(screen.getByTestId('my-card-avatar'));
    expect(square.borderRadius).toBe(radius.card);
    expect(square.backgroundColor).toBe(lightPalette.green);
    expect(screen.getByText('DC')).toBeTruthy();
  });

  it('draws the kit shirt on canvas', async () => {
    await draw({ avatar_style: 'kit', avatar_kit_colour: 'kitRed', avatar_number: 9 });
    expect(flatStyle(screen.getByTestId('my-card-avatar')).backgroundColor).toBe(lightPalette.canvas);
    expect(screen.getByTestId('avatar-kit')).toBeTruthy();
    expect(screen.queryByText('DC')).toBeNull();
  });

  it('draws the illustration on canvas', async () => {
    await draw({ avatar_style: 'illustration', avatar_illustration: 'avatar-07' });
    expect(screen.getByTestId('avatar-illustration')).toBeTruthy();
  });

  it('falls back to the username, then "Player", with no name', async () => {
    await draw({ full_name: '  ' });
    expect(screen.getByTestId('my-card-name')).toHaveTextContent('dimi');
  });
});

describe('colours', () => {
  it('keeps the night top and a dark-on-white QR in dark mode', async () => {
    await draw({}, 'dark');
    expect(flatStyle(screen.getByTestId('my-card')).backgroundColor).toBe(darkPalette.night);
    expect(screen.getByTestId('qr').props.accessibilityHint).toBe(`${darkPalette.night} on ${darkPalette.onNight}`);
  });

  it('the level pill is green on night, never on white', async () => {
    await draw();
    expect(flatStyle(screen.getByTestId('my-card-level')).backgroundColor).toBe(lightPalette.greenSoft);
  });
});

describe('the QR', () => {
  it('needs a username as well as show_qr', async () => {
    await draw({ username: null });
    expect(screen.queryByTestId('my-card-qr')).toBeNull();
    expect(screen.queryByTestId('my-card-username')).toBeNull();
  });
});

// S20: another player's card (the player sheet) uses its own testIDs and
// never shows a QR, even if one were allowed: there is no QR to open.
describe("another player's card", () => {
  it('takes a testID prefix, and has no QR without onOpenQr', async () => {
    await render(withTheme(<PlayerCardView card={CARD} onOpenProfile={jest.fn()} testIDPrefix="profile-card" />));
    expect(screen.getByTestId('profile-card')).toBeTruthy();
    expect(screen.getByTestId('profile-card-name')).toBeTruthy();
    expect(screen.getByTestId('profile-card-avatar')).toBeTruthy();
    expect(screen.queryByTestId('my-card')).toBeNull();
    expect(screen.queryByTestId('profile-card-qr')).toBeNull();
    expect(screen.queryByTestId('qr')).toBeNull();
  });
});
