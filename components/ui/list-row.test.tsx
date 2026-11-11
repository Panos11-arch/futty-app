import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ListRow } from '@/components/ui/list-row';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

describe('ListRow', () => {
  it('renders title and subtitle as plain content', async () => {
    await render(<ListRow title="Payment methods" subtitle="Visa ending 4242" />);
    expect(screen.getByText('Payment methods')).toBeTruthy();
    expect(screen.getByText('Visa ending 4242')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is a button with a chevron when pressable', async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Settings" leading={{ icon: 'gearshape.fill' }} chevron onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('list-row-chevron')).toBeTruthy();
    expect(screen.getByTestId('list-row-leading-icon')).toBeTruthy();
  });

  it('shows an avatar and a trailing accessory', async () => {
    await render(
      <ListRow title="Andreas Georgiou" leading={{ avatar: { name: 'Andreas Georgiou' } }} trailing={<Text>Paid</Text>} />,
    );
    expect(screen.getByText('AG')).toBeTruthy();
    expect(screen.getByText('Paid')).toBeTruthy();
  });
});
