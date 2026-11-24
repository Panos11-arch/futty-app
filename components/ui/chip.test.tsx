import { fireEvent, render, screen } from '@testing-library/react-native';

import { Chip } from '@/components/ui/chip';
import { flatStyle, withTheme } from '@/components/ui/test-utils';
import { darkPalette, lightPalette, radius } from '@/constants/futty-theme';

describe('Chip', () => {
  it('renders unselected as an outline', async () => {
    const onPress = jest.fn();
    await render(<Chip label="18:00" onPress={onPress} />);
    const chip = screen.getByRole('button', { name: '18:00' });
    expect(chip.props.accessibilityState).toMatchObject({ selected: false });
    expect(flatStyle(chip)).toMatchObject({
      backgroundColor: lightPalette.surface,
      borderColor: lightPalette.border,
      borderRadius: radius.pill,
    });
    expect(flatStyle(chip).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['light', lightPalette],
    ['dark', darkPalette],
  ] as const)('renders selected on soft green with a green border and ink text (%s)', async (appearance, palette) => {
    await render(withTheme(<Chip label="5 v 5" selected onPress={() => {}} />, { appearance }));
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ selected: true });
    expect(flatStyle(screen.getByRole('button'))).toMatchObject({
      backgroundColor: palette.greenSoft,
      borderColor: palette.green,
    });
    expect(flatStyle(screen.getByText('5 v 5')).color).toBe(palette.ink);
  });

  it('on a night header: light outline text, solid when selected', async () => {
    await render(<Chip label="6" onDark onPress={() => {}} />);
    expect(flatStyle(screen.getByText('6')).color).toBe(lightPalette.onNight);
    await render(<Chip label="7" onDark selected onPress={() => {}} />);
    expect(flatStyle(screen.getByRole('button', { name: '7' })).backgroundColor).toBe(lightPalette.onNight);
    expect(flatStyle(screen.getByText('7')).color).toBe(lightPalette.greenInk);
  });

  it('does not fire while disabled', async () => {
    const onPress = jest.fn();
    await render(<Chip label="20:00" disabled onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
