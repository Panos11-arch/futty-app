import { mockAuth, pending } from './mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { LockScreen } from '@/components/lock-screen';

const mockUnlock = jest.fn();
jest.mock('@/lib/app-lock', () => ({ useAppLock: () => ({ unlock: mockUnlock, label: 'Face ID' }) }));

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => jest.clearAllMocks());

describe('Lock screen', () => {
  it('prompts on open, shows loading, and cannot unlock twice at once', async () => {
    const request = pending<boolean>();
    mockUnlock.mockReturnValue(request.promise);
    await render(<LockScreen />);
    expect(mockUnlock).toHaveBeenCalledTimes(1);
    expect(button('Unlock with Face ID').props.accessibilityState).toMatchObject({ busy: true });
    await fireEvent.press(button('Unlock with Face ID'));
    expect(mockUnlock).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(false));
    expect(screen.getByText('Not recognised. Try again, or sign out.')).toBeTruthy();
  });

  it('signs out instead', async () => {
    mockUnlock.mockResolvedValue(false);
    await render(<LockScreen />);
    await act(async () => {});
    await fireEvent.press(button('Sign out instead'));
    expect(mockAuth.signOut).toHaveBeenCalled();
  });
});
