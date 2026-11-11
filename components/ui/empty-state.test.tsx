import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyState } from '@/components/ui/empty-state';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

describe('EmptyState', () => {
  it('shows an icon, one line and one action', async () => {
    const onPress = jest.fn();
    await render(
      <EmptyState icon="calendar" message="No games booked yet" action={{ label: 'Book a pitch', onPress }} />,
    );
    expect(screen.getByTestId('empty-state-icon')).toBeTruthy();
    expect(screen.getByText('No games booked yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Book a pitch' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('can have no action', async () => {
    await render(<EmptyState icon="bell.fill" message="No notifications" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
