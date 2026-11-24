import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { Button, type ButtonVariant } from '@/components/ui/button';
import { flatStyle, withTheme } from '@/components/ui/test-utils';
import { darkPalette, lightPalette, type Palette } from '@/constants/futty-theme';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

const mockSettings = { haptics: true };
jest.mock('@/lib/theme/settings', () => ({
  ...jest.requireActual('@/lib/theme/settings'),
  getDisplaySettings: () => mockSettings,
}));

/** Text colour and fill for each variant, from a palette. */
const looks: [ButtonVariant, (p: Palette) => string, (p: Palette) => string | undefined][] = [
  ['primary', (p) => p.greenInk, (p) => p.green],
  ['dark', (p) => p.onNight, (p) => p.night],
  ['secondary', (p) => p.ink, (p) => p.surface],
  ['destructive', (p) => p.danger, (p) => p.surface],
  ['plain', (p) => p.positive, () => 'transparent'],
];

describe.each([
  ['light', lightPalette],
  ['dark', darkPalette],
] as const)('Button in %s mode', (appearance, palette) => {
  it.each(looks)('renders the %s variant in its tokens', async (variant, text, fill) => {
    await render(withTheme(<Button label="Pay €6.80" variant={variant} onPress={() => {}} />, { appearance }));
    expect(flatStyle(screen.getByText('Pay €6.80')).color).toBe(text(palette));
    expect(flatStyle(screen.getByRole('button', { name: 'Pay €6.80' })).backgroundColor).toBe(fill(palette));
  });
});

describe('Button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.haptics = true;
  });

  it('primary is green with dark text: never green text on light', async () => {
    await render(<Button label="Book" onPress={() => {}} />);
    expect(flatStyle(screen.getByRole('button')).backgroundColor).toBe(lightPalette.green);
    expect(flatStyle(screen.getByText('Book')).color).toBe(lightPalette.greenInk);
  });

  it('outlines secondary and destructive', async () => {
    await render(<Button label="Back" variant="secondary" onPress={() => {}} />);
    expect(flatStyle(screen.getByRole('button'))).toMatchObject({ borderColor: lightPalette.border });
  });

  it('is at least 44 tall, also when compact', async () => {
    await render(<Button label="Book" onPress={() => {}} />);
    expect(flatStyle(screen.getByRole('button')).minHeight).toBeGreaterThanOrEqual(44);
    await render(<Button label="Log" size="compact" onPress={() => {}} />);
    expect(flatStyle(screen.getByRole('button', { name: 'Log' })).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('compact uses the smaller label', async () => {
    await render(<Button label="Play" size="compact" onPress={() => {}} />);
    expect(flatStyle(screen.getByText('Play')).fontSize).toBe(14);
  });

  it('calls onPress and gives a light haptic tap on primary', async () => {
    const onPress = jest.fn();
    await render(<Button label="Book" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('gives no haptic when the player switched haptics off, but still acts', async () => {
    mockSettings.haptics = false;
    const onPress = jest.fn();
    await render(<Button label="Book" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
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

  it('follows the text size setting', async () => {
    await render(withTheme(<Button label="Book" onPress={() => {}} />, { textScale: 1.5 }));
    expect(flatStyle(screen.getByText('Book')).fontSize).toBe(17 * 1.5);
  });
});
