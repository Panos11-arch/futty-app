import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Card } from '@/components/ui/card';
import { flatStyle } from '@/components/ui/test-utils';
import { colors, radius, shadow } from '@/constants/futty-theme';

describe('Card', () => {
  it('renders content on surface with the one shadow and no border', async () => {
    await render(
      <Card testID="card">
        <Text>Inside</Text>
      </Card>,
    );
    expect(screen.getByText('Inside')).toBeTruthy();
    const style = flatStyle(screen.getByTestId('card'));
    expect(style).toMatchObject({ backgroundColor: colors.surface, borderRadius: radius.card, ...shadow });
    expect(style.borderWidth).toBeUndefined();
  });

  it('is a button when pressable', async () => {
    const onPress = jest.fn();
    await render(
      <Card accessibilityLabel="Next game" onPress={onPress}>
        <Text>Thursday 20:00</Text>
      </Card>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Next game' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
