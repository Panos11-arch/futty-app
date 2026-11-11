import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { Button, type ButtonVariant } from '@/components/ui/button';
import { flatStyle } from '@/components/ui/test-utils';
import { colors } from '@/constants/futty-theme';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

const variants: [ButtonVariant, string][] = [
  ['primary', colors.onBrand],
  ['secondary', colors.ink],
  ['destructive', colors.danger],
  ['plain', colors.brand],
];

describe('Button', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(variants)('renders the %s variant', async (variant, textColor) => {
    await render(<Button label="Pay €6.80" variant={variant} onPress={() => {}} />);
    expect(flatStyle(screen.getByText('Pay €6.80')).color).toBe(textColor);
    expect(screen.getByRole('button', { name: 'Pay €6.80' })).toBeTruthy();
  });

  it('primary fills with brand', async () => {
    await render(<Button label="Book" onPress={() => {}} />);
    expect(flatStyle(screen.getByRole('button'))).toMatchObject({ backgroundColor: colors.brand });
  });

  it('is at least 44 tall', async () => {
    await render(<Button label="Book" onPress={() => {}} />);
    expect(flatStyle(screen.getByRole('button')).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('calls onPress and gives a light haptic tap on primary', async () => {
    const onPress = jest.fn();
    await render(<Button label="Book" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('gives no haptic on secondary actions', async () => {
    await render(<Button label="Not now" variant="secondary" onPress={() => {}} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('does not fire while loading, and keeps its label for screen readers', async () => {
    const onPress = jest.fn();
    await render(<Button label="Pay €6.80" loading onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Pay €6.80' });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId('button-spinner')).toBeTruthy();
  });

  it('does not fire while disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Book" disabled onPress={onPress} />);
    const button = screen.getByRole('button');
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('stretches when fullWidth', async () => {
    await render(<Button label="Book" fullWidth onPress={() => {}} />);
    expect(flatStyle(screen.getByRole('button'))).toMatchObject({ alignSelf: 'stretch' });
  });
});
