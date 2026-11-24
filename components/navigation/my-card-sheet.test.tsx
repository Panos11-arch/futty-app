// S2: until S19 builds the player card, the Card button opens this sheet.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { MyCardSheet } from '@/components/navigation/my-card-sheet';
import { loadWithFile } from '@/components/ui/test-utils';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

loadWithFile(Modal);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));

describe('My card sheet (placeholder)', () => {
  it('shows nothing while closed', async () => {
    await render(<MyCardSheet visible={false} onClose={jest.fn()} onOpenProfile={jest.fn()} />);
    expect(screen.queryByText('My card')).toBeNull();
  });

  it('shows the title, one line and one button', async () => {
    await render(<MyCardSheet visible onClose={jest.fn()} onOpenProfile={jest.fn()} />);
    expect(screen.getByRole('header', { name: 'My card' })).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getByTestId('my-card-open-profile')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open profile' })).toBeTruthy();
  });

  it('Open profile closes the sheet and opens the profile', async () => {
    const onClose = jest.fn();
    const onOpenProfile = jest.fn();
    await render(<MyCardSheet visible onClose={onClose} onOpenProfile={onOpenProfile} />);
    await fireEvent.press(screen.getByTestId('my-card-open-profile'));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from its close button', async () => {
    const onClose = jest.fn();
    await render(<MyCardSheet visible onClose={onClose} onOpenProfile={jest.fn()} />);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
  });
});
