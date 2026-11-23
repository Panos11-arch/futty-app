// Settings → Delete account: when the server refuses, the reason is shown with
// a button to where the player can sort it out (spec 13 "Deleting an account").
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import SettingsScreen from '@/app/account/settings/index';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a) } }));

const mockDelete = jest.fn();
jest.mock('@/lib/account', () => ({ deleteMyAccount: () => mockDelete() }));

const mockSignOut = jest.fn(() => Promise.resolve());
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signOut: mockSignOut }) }));

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

async function deleteAndConfirm() {
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
  await fireEvent.press(screen.getByText('Delete account'));
}

beforeEach(() => jest.clearAllMocks());

it('money owed: shows the amount and a button to Payments', async () => {
  mockDelete.mockResolvedValue({ message: 'You owe €6.80. Pay it from Payments, then try again.', fix: 'payments' });
  await render(<SettingsScreen />);
  await deleteAndConfirm();
  expect(await screen.findByText('You owe €6.80. Pay it from Payments, then try again.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings-delete-fix'));
  expect(mockPush).toHaveBeenCalledWith('/account/payments/owed');
  expect(screen.getByText('Go to Payments')).toBeTruthy();
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('upcoming games: shows the message and a button to My bookings', async () => {
  mockDelete.mockResolvedValue({ message: 'You still have upcoming games.', fix: 'bookings' });
  await render(<SettingsScreen />);
  await deleteAndConfirm();
  expect(await screen.findByText('You still have upcoming games.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Go to My bookings'));
  expect(mockPush).toHaveBeenCalledWith('/my-bookings');
});

it('another error: the message only, no button', async () => {
  mockDelete.mockResolvedValue({ message: 'Could not reach Futty.', fix: null });
  await render(<SettingsScreen />);
  await deleteAndConfirm();
  expect(await screen.findByText('Could not reach Futty.')).toBeTruthy();
  expect(screen.queryByTestId('settings-delete-fix')).toBeNull();
});

it('deleted: signs out and goes to sign-in', async () => {
  mockDelete.mockResolvedValue(null);
  await render(<SettingsScreen />);
  await deleteAndConfirm();
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-in'));
  expect(mockSignOut).toHaveBeenCalled();
});
