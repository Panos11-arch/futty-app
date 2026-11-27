// S19: the Card button's sheet holds the player card (image 20, the S19 card
// mockup): loading, error and data states; Share, Edit and (from S20) Scan;
// the QR full screen; the avatar and name open Profile; a minor's card has
// no QR and no Share (A5).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { Modal, Platform } from 'react-native';

import { CARD_LOAD_FAILED, MyCardSheet } from '@/components/navigation/my-card-sheet';
import { flatStyle, loadWithFile, withTheme } from '@/components/ui/test-utils';
import { lightPalette } from '@/constants/futty-theme';
import type { CardLoad, PlayerCard } from '@/lib/player-card';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-premium-player', () => ({ usePremiumPlayer: () => false }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }), SafeAreaView: View };
});
const mockHaptic = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({ impactAsync: () => mockHaptic(), ImpactFeedbackStyle: { Light: 'light' } }));
const mockLoadFont = jest.fn(() => Promise.resolve());
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: { loadFont: () => mockLoadFont() } }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (to: unknown) => mockPush(to) } }));

const mockQr = jest.fn();
jest.mock('react-native-qrcode-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return function QRCodeMock(props: { value: string; size: number }) {
    mockQr(props);
    return React.createElement(View, { testID: `qr-${props.size}` });
  };
});

const mockFetch = jest.fn<Promise<CardLoad>, []>();
const mockScanRoute = jest.fn<string | null, []>(() => null);
jest.mock('@/lib/player-card', () => ({
  ...jest.requireActual('@/lib/player-card'),
  fetchMyPlayerCard: () => mockFetch(),
  scanRoute: () => mockScanRoute(),
}));
const mockShare = jest.fn();
jest.mock('@/lib/player-card-share', () => ({ shareMyCard: (...a: unknown[]) => mockShare(...a) }));
const mockRestore = jest.fn();
const mockRaise = jest.fn(() => Promise.resolve(mockRestore));
jest.mock('@/lib/screen-brightness', () => ({ raiseBrightness: () => mockRaise() }));

loadWithFile(Image, Modal);

const CARD: PlayerCard = {
  username: 'dimi',
  full_name: 'Dimi Card',
  avatar_style: 'initials',
  avatar_kit_colour: null,
  avatar_number: null,
  avatar_illustration: null,
  level: 4.25,
  position: 'Midfielder',
  preferred_foot: 'Right',
  favourite_player: 'Iniesta',
  member_since: '2026-11-03',
  teams: [
    { id: 't1', name: 'Limassol Lions' },
    { id: 't2', name: 'Sunday Casuals' },
  ],
  team_count: 3,
  show_qr: true,
};

function ready(card: Partial<PlayerCard> = {}): CardLoad {
  return { status: 'ready', card: { ...CARD, ...card } };
}

async function open(props: Partial<Parameters<typeof MyCardSheet>[0]> = {}) {
  const onClose = jest.fn();
  const onOpenProfile = jest.fn();
  const utils = await render(
    withTheme(<MyCardSheet visible onClose={onClose} onOpenProfile={onOpenProfile} {...props} />),
  );
  return { ...utils, onClose, onOpenProfile };
}

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(ready());
  mockScanRoute.mockReset().mockReturnValue(null);
  mockShare.mockReset().mockResolvedValue({ status: 'shared' });
  mockPush.mockReset();
  mockQr.mockReset();
  mockRaise.mockClear();
  mockRestore.mockClear();
  mockHaptic.mockClear();
});

describe('the sheet', () => {
  it('shows nothing while closed', async () => {
    await render(withTheme(<MyCardSheet visible={false} onClose={jest.fn()} onOpenProfile={jest.fn()} />));
    expect(screen.queryByTestId('my-card-sheet')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('on Android, loads the button icons before it first opens', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    try {
      mockLoadFont.mockClear();
      await render(withTheme(<MyCardSheet visible={false} onClose={jest.fn()} onOpenProfile={jest.fn()} />));
      await waitFor(() => expect(mockLoadFont).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
    }
  });

  it('on iPhone, loads nothing (SF Symbols are built in)', async () => {
    mockLoadFont.mockClear();
    await render(withTheme(<MyCardSheet visible={false} onClose={jest.fn()} onOpenProfile={jest.fn()} />));
    await act(async () => {});
    expect(mockLoadFont).not.toHaveBeenCalled();
  });

  it('shows skeletons while the card loads', async () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    await open();
    expect(screen.getByTestId('my-card-sheet')).toBeTruthy();
    expect(screen.getByTestId('my-card-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('my-card')).toBeNull();
  });

  it('has a drag handle, and closes from a tap outside', async () => {
    const { onClose } = await open();
    expect(screen.getByTestId('my-card-handle')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('my-card-backdrop', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a failed load shows one line and Try again, which loads again', async () => {
    mockFetch.mockResolvedValueOnce({ status: 'error' });
    await open();
    expect(await screen.findByText(CARD_LOAD_FAILED)).toBeTruthy();
    expect(CARD_LOAD_FAILED.split(/\s+/).length).toBeLessThanOrEqual(10);
    await fireEvent.press(screen.getByTestId('my-card-retry'));
    expect(await screen.findByTestId('my-card')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('loads the card again each time it opens', async () => {
    const { rerender, onClose, onOpenProfile } = await open();
    await screen.findByTestId('my-card');
    await rerender(withTheme(<MyCardSheet visible={false} onClose={onClose} onOpenProfile={onOpenProfile} />));
    await rerender(withTheme(<MyCardSheet visible onClose={onClose} onOpenProfile={onOpenProfile} />));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});

describe('the card', () => {
  it('shows the night top: logo, avatar, @username, name and level', async () => {
    await open();
    await screen.findByTestId('my-card');
    expect(screen.getByTestId('futty-logo-basic')).toBeTruthy();
    expect(screen.getByTestId('my-card-avatar')).toBeTruthy();
    expect(screen.getByText('DC')).toBeTruthy();
    expect(screen.getByText('@dimi')).toBeTruthy();
    expect(screen.getByText('Dimi Card')).toBeTruthy();
    expect(screen.getByText('Level 4.3')).toBeTruthy();
    expect(flatStyle(screen.getByTestId('my-card')).backgroundColor).toBe(lightPalette.night);
  });

  it('shows the band: Position, Strong foot, Favourite player, Teams, Member since', async () => {
    await open();
    await screen.findByTestId('my-card-details');
    for (const [label, value] of [
      ['Position', 'Midfielder'],
      ['Strong foot', 'Right'],
      ['Favourite player', 'Iniesta'],
      ['Teams', 'Limassol Lions · Sunday Casuals +1'],
      ['Member since', 'November 2026'],
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(value)).toBeTruthy();
      expect(screen.getByLabelText(`${label}, ${value}`)).toBeTruthy();
    }
  });

  it('hides each empty detail', async () => {
    mockFetch.mockResolvedValue(ready({ favourite_player: null, teams: [], team_count: 0 }));
    await open();
    await screen.findByTestId('my-card-details');
    expect(screen.queryByText('Favourite player')).toBeNull();
    expect(screen.queryByText('Teams')).toBeNull();
    expect(screen.getByText('Position')).toBeTruthy();
  });

  it('hides the band and the level pill when everything is empty', async () => {
    mockFetch.mockResolvedValue(
      ready({ position: null, preferred_foot: null, favourite_player: null, teams: [], team_count: 0, member_since: null, level: null }),
    );
    await open();
    await screen.findByTestId('my-card');
    expect(screen.queryByTestId('my-card-details')).toBeNull();
    expect(screen.queryByTestId('my-card-level')).toBeNull();
  });

  it('draws the QR for futty.app/p/<username> with "Tap to view full screen"', async () => {
    await open();
    await screen.findByTestId('my-card-qr');
    expect(mockQr).toHaveBeenCalledWith(expect.objectContaining({ value: 'https://futty.app/p/dimi' }));
    expect(screen.getByText('Tap to view full screen')).toBeTruthy();
  });

  it('tapping the avatar or name closes the sheet and opens Profile', async () => {
    const { onClose, onOpenProfile } = await open();
    await fireEvent.press(await screen.findByTestId('my-card-open-profile'));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it('shows nothing private', async () => {
    await open();
    await screen.findByTestId('my-card');
    expect(screen.queryByText(/@futty\.test|\+357|born/i)).toBeNull();
  });
});

describe('a minor, or no username (show_qr false)', () => {
  it('has no QR and no Share; Edit stays', async () => {
    mockFetch.mockResolvedValue(ready({ show_qr: false }));
    await open();
    await screen.findByTestId('my-card');
    expect(screen.queryByTestId('my-card-qr')).toBeNull();
    expect(screen.queryByText('Tap to view full screen')).toBeNull();
    expect(screen.queryByTestId('my-card-share')).toBeNull();
    expect(screen.getByTestId('my-card-edit')).toBeTruthy();
    expect(mockQr).not.toHaveBeenCalled();
  });
});

describe('the buttons', () => {
  it('shows Share and Edit, round with labels, and no Scan without a scanner route', async () => {
    await open();
    await screen.findByTestId('my-card');
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByTestId('my-card-scan')).toBeNull();
    expect(screen.getByTestId('icon-square.and.arrow.up')).toBeTruthy();
    expect(screen.getByTestId('icon-pencil')).toBeTruthy();
  });

  it('Share captures the card and shares it with the link, with a tap', async () => {
    await open();
    await fireEvent.press(await screen.findByTestId('my-card-share'));
    expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({ current: expect.anything() }), 'https://futty.app/p/dimi');
    expect(mockHaptic).toHaveBeenCalled();
    expect(screen.queryByTestId('my-card-share-error')).toBeNull();
  });

  it('a failed Share shows its one line', async () => {
    mockShare.mockResolvedValue({ status: 'error', message: "Your card couldn't be shared. Try again." });
    await open();
    await fireEvent.press(await screen.findByTestId('my-card-share'));
    expect(await screen.findByText("Your card couldn't be shared. Try again.")).toBeTruthy();
  });

  it('Edit closes the sheet and opens Edit profile', async () => {
    const { onClose } = await open();
    await fireEvent.press(await screen.findByTestId('my-card-edit'));
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/edit-profile');
  });

  it('Scan appears with its route (S20: the scanner), and opens it', async () => {
    mockScanRoute.mockReturnValue('/scan');
    const { onClose } = await open();
    await fireEvent.press(await screen.findByTestId('my-card-scan'));
    expect(screen.getByTestId('icon-qrcode.viewfinder')).toBeTruthy();
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/scan');
  });

  it('every button is at least 44 points', async () => {
    await open();
    await screen.findByTestId('my-card');
    for (const id of ['my-card-share', 'my-card-edit']) {
      expect(flatStyle(screen.getByTestId(id)).minWidth).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('the QR full screen', () => {
  it('opens on a tap, bigger, with the brightness raised, and restores it on Close', async () => {
    await open();
    await fireEvent.press(await screen.findByTestId('my-card-qr'));
    expect(screen.getByTestId('my-card-qr-full')).toBeTruthy();
    expect(screen.getAllByText('@dimi')).toHaveLength(2);
    await waitFor(() => expect(mockRaise).toHaveBeenCalledTimes(1));
    const sizes = mockQr.mock.calls.map(([p]) => p.size as number);
    expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes));

    await act(async () => {
      fireEvent.press(screen.getByTestId('my-card-qr-full-close'));
    });
    await waitFor(() => expect(mockRestore).toHaveBeenCalledTimes(1));
  });
});
