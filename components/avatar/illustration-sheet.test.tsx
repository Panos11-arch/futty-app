import { fireEvent, render, screen } from '@testing-library/react-native';

import { cellSize, IllustrationSheet } from '@/components/avatar/illustration-sheet';
import { MIN_TOUCH } from '@/components/ui/foundation';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe('cellSize', () => {
  it.each([[320], [375], [430]])('four columns fit a %ipt wide phone, each at least 44pt', (width) => {
    const cell = cellSize(width);
    expect(cell).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(cell * 4).toBeLessThanOrEqual(width);
  });
});

describe('IllustrationSheet', () => {
  it('renders nothing while closed', async () => {
    await render(<IllustrationSheet visible={false} selected={null} onPick={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByText('Choose avatar')).toBeNull();
  });

  it('picks an avatar, or initials', async () => {
    const onPick = jest.fn();
    await render(<IllustrationSheet visible selected="avatar-02" onPick={onPick} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('avatar-sheet-item-avatar-06'));
    expect(onPick).toHaveBeenLastCalledWith('avatar-06');
    await fireEvent.press(screen.getByText('Use my initials'));
    expect(onPick).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('avatar-sheet-item-avatar-02')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true }),
    );
  });

  it('closes from its close button', async () => {
    const onClose = jest.fn();
    await render(<IllustrationSheet visible selected={null} onPick={jest.fn()} onClose={onClose} />);
    await fireEvent.press(screen.getAllByLabelText('Close').at(-1)!);
    expect(onClose).toHaveBeenCalled();
  });
});
