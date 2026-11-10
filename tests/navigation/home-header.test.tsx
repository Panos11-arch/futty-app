import './mocks';

import { router } from 'expo-router';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { HomeHeader } from '@/app/(tabs)/index';

let mockUnreadCount = 0;
jest.mock('@/lib/use-notifications', () => ({ useNotifications: () => ({ unreadCount: mockUnreadCount }) }));
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), router: { push: jest.fn() } }));

describe('Home header', () => {
  beforeEach(() => {
    mockUnreadCount = 0;
    jest.mocked(router.push).mockClear();
  });

  it('shows a large Home title', async () => {
    await render(<HomeHeader />);
    expect(screen.getByRole('header', { name: 'Home' })).toBeTruthy();
  });

  it('opens notifications from the bell', async () => {
    await render(<HomeHeader />);
    await fireEvent.press(screen.getByRole('button', { name: 'Notifications' }));
    expect(router.push).toHaveBeenCalledWith('/notifications');
  });

  it('shows no dot when nothing is unread', async () => {
    await render(<HomeHeader />);
    expect(screen.queryByTestId('unread-dot')).toBeNull();
  });

  it('shows the dot, and says how many, when there are unread notifications', async () => {
    mockUnreadCount = 3;
    await render(<HomeHeader />);
    expect(screen.getByTestId('unread-dot')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy();
  });

  it('keeps the account menu', async () => {
    await render(<HomeHeader />);
    await fireEvent.press(screen.getByRole('button', { name: 'Account menu' }));
    expect(router.push).toHaveBeenCalledWith('/account');
  });
});
