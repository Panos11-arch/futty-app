import { fireEvent, render, screen } from '@testing-library/react-native';

import { IconButton } from '@/components/ui/icon-button';
import { flatStyle } from '@/components/ui/test-utils';

describe('IconButton', () => {
  it('renders with its label and a 44 x 44 target', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="bell.fill" accessibilityLabel="Notifications" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Notifications' });
    expect(flatStyle(button)).toMatchObject({ minWidth: 44, minHeight: 44 });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire while disabled', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="xmark" accessibilityLabel="Close" disabled onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('requires an accessibilityLabel', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      // @ts-expect-error accessibilityLabel is required by the type
      render(<IconButton icon="xmark" onPress={() => {}} />),
    ).rejects.toThrow('IconButton needs an accessibilityLabel');
    await expect(render(<IconButton icon="xmark" accessibilityLabel="  " onPress={() => {}} />)).rejects.toThrow(
      'IconButton needs an accessibilityLabel',
    );
    jest.restoreAllMocks();
  });
});
