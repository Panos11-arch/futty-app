// S2 (spec 15 section 0.5): the fixed header on every tab. The Futty
// wordmark on Home, the tab's name elsewhere, a bell with a dot while
// anything is unread, and a menu that opens Account.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { AppHeader } from '@/components/navigation/app-header';
import { flatStyle, withTheme } from '@/components/ui/test-utils';
import { fontFamilies, lightPalette } from '@/constants/futty-theme';

let mockUnreadCount = 0;
jest.mock('@/lib/use-notifications', () => ({ useNotifications: () => ({ unreadCount: mockUnreadCount }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => {
  mockUnreadCount = 0;
  jest.mocked(router.push).mockClear();
});

describe('title', () => {
  it('shows the Futty wordmark in Cairo on Home', async () => {
    await render(withTheme(<AppHeader title="Home" home />));
    const wordmark = screen.getByRole('header', { name: 'Futty' });
    expect(flatStyle(wordmark).fontFamily).toMatch(/^Cairo_/);
    expect(screen.queryByText('Home')).toBeNull();
  });

  it.each(['Community', 'Rankings', 'Profile', 'Play'])('shows the tab name on %s', async (title) => {
    await render(withTheme(<AppHeader title={title} />));
    expect(screen.getByRole('header', { name: title })).toBeTruthy();
    expect(screen.queryByText('Futty')).toBeNull();
  });

  it('sits on the screen background (canvas), with the Cairo heading family', async () => {
    await render(withTheme(<AppHeader title="Community" />));
    expect(flatStyle(screen.getByTestId('app-header')).backgroundColor).toBe(lightPalette.canvas);
    expect(Object.values(fontFamilies.cairo)).toContain(flatStyle(screen.getByRole('header')).fontFamily);
  });
});

describe('bell', () => {
  it('opens notifications', async () => {
    await render(withTheme(<AppHeader title="Home" home />));
    await fireEvent.press(screen.getByTestId('header-bell'));
    expect(router.push).toHaveBeenCalledWith('/notifications');
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
  });

  it('shows no dot when nothing is unread', async () => {
    await render(withTheme(<AppHeader title="Home" home />));
    expect(screen.queryByTestId('unread-dot')).toBeNull();
  });

  it('shows the dot, and says how many, when there are unread notifications', async () => {
    mockUnreadCount = 3;
    await render(withTheme(<AppHeader title="Profile" />));
    expect(screen.getByTestId('unread-dot')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy();
  });
});

describe('menu', () => {
  it('opens Account', async () => {
    await render(withTheme(<AppHeader title="Rankings" />));
    await fireEvent.press(screen.getByTestId('header-menu'));
    expect(router.push).toHaveBeenCalledWith('/account');
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
  });
});
