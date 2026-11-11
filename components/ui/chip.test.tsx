import { fireEvent, render, screen } from '@testing-library/react-native';

import { Chip } from '@/components/ui/chip';
import { flatStyle } from '@/components/ui/test-utils';
import { colors, radius } from '@/constants/futty-theme';

describe('Chip', () => {
  it('renders unselected', async () => {
    const onPress = jest.fn();
    await render(<Chip label="18:00" onPress={onPress} />);
    const chip = screen.getByRole('button', { name: '18:00' });
    expect(chip.props.accessibilityState).toMatchObject({ selected: false });
    expect(flatStyle(chip)).toMatchObject({ backgroundColor: colors.surface, borderRadius: radius.pill });
    expect(flatStyle(chip).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders selected in brandSoft with brand text', async () => {
    await render(<Chip label="5 v 5" selected onPress={() => {}} />);
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ selected: true });
    expect(flatStyle(screen.getByRole('button')).backgroundColor).toBe(colors.brandSoft);
    expect(flatStyle(screen.getByText('5 v 5')).color).toBe(colors.brand);
  });

  it('does not fire while disabled', async () => {
    const onPress = jest.fn();
    await render(<Chip label="20:00" disabled onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
