import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Card } from '@/components/ui/card';
import { flatStyle, withTheme } from '@/components/ui/test-utils';
import { darkPalette, lightPalette, radius } from '@/constants/futty-theme';

describe('Card', () => {
  it.each([
    ['light', lightPalette],
    ['dark', darkPalette],
  ] as const)('renders content on surface with a border and no shadow (%s)', async (appearance, palette) => {
    await render(
      withTheme(
        <Card testID="card">
          <Text>Inside</Text>
        </Card>,
        { appearance },
      ),
    );
    expect(screen.getByText('Inside')).toBeTruthy();
    const style = flatStyle(screen.getByTestId('card'));
    expect(style).toMatchObject({
      backgroundColor: palette.surface,
      borderRadius: radius.card,
      borderColor: palette.border,
    });
    expect(style.borderWidth).toBeGreaterThan(0);
    expect(style.boxShadow).toBeUndefined();
  });

  it('shows a chosen card with a green border on a soft green fill', async () => {
    await render(
      <Card testID="card" selected>
        <Text>Pay for everyone</Text>
      </Card>,
    );
    expect(flatStyle(screen.getByTestId('card'))).toMatchObject({
      borderColor: lightPalette.green,
      backgroundColor: lightPalette.greenSoft,
    });
  });

  it('draws a night panel', async () => {
    await render(
      <Card testID="card" tone="night">
        <Text>Featured event</Text>
      </Card>,
    );
    expect(flatStyle(screen.getByTestId('card')).backgroundColor).toBe(lightPalette.night);
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
