// S1: Settings → Appearance and Settings → Accessibility (docs/specs/15-design.md
// sections 0.2 and 0.4). Each choice changes the live theme at once and is
// stored on the phone.
import './mocks';

jest.mock('@/lib/auth-storage', () => {
  const map = new Map<string, string>();
  return {
    authStorage: {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' }, signOut: jest.fn() }) }));
jest.mock('@/lib/account', () => ({ deleteMyAccount: jest.fn() }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { StyleSheet, Text as RNText } from 'react-native';

import AccessibilityScreen from '@/app/account/settings/accessibility';
import AppearanceScreen from '@/app/account/settings/appearance';
import SettingsScreen from '@/app/account/settings/index';
import { Text } from '@/components/ui/text';
import { darkPalette, highContrast, lightPalette } from '@/constants/futty-theme';
import { authStorage } from '@/lib/auth-storage';
import { DISPLAY_SETTINGS_KEY, resetDisplaySettingsCache } from '@/lib/theme/settings';
import { ThemeProvider, useTheme } from '@/lib/theme/theme-provider';

const store = (authStorage as unknown as { map: Map<string, string> }).map;
const saved = () => JSON.parse(store.get(DISPLAY_SETTINGS_KEY) ?? '{}');

/** Shows what the live theme is, next to the screen under test. */
function Probe() {
  const t = useTheme();
  return (
    <>
      <RNText testID="probe-scheme">{t.scheme}</RNText>
      <RNText testID="probe-border">{t.colors.border}</RNText>
      <RNText testID="probe-font">{t.type.body.fontFamily}</RNText>
      <RNText testID="probe-motion">{String(t.reduceMotion)}</RNText>
      <RNText testID="probe-colour-blind">{String(t.colourBlind)}</RNText>
      <Text testID="probe-text">Sample</Text>
    </>
  );
}

async function show(screenEl: React.ReactElement) {
  return render(
    <ThemeProvider>
      {screenEl}
      <Probe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  store.clear();
  resetDisplaySettingsCache();
  jest.clearAllMocks();
});

describe('Settings', () => {
  it.each([
    ['settings-appearance', 'Appearance', '/account/settings/appearance'],
    ['settings-accessibility', 'Accessibility', '/account/settings/accessibility'],
  ])('%s opens %s', async (testID, label, route) => {
    await render(<SettingsScreen />);
    expect(screen.getByText(label)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(testID));
    expect(router.push).toHaveBeenCalledWith(route);
  });
});

describe('Appearance', () => {
  it('offers System, Light and Dark, with System chosen by default', async () => {
    await show(<AppearanceScreen />);
    for (const label of ['System', 'Light', 'Dark']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByTestId('appearance-system').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('appearance-dark').props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId('appearance-dark').props.accessibilityRole).toBe('radio');
  });

  it('Dark switches the whole app at once and is stored on the phone', async () => {
    await show(<AppearanceScreen />);
    await fireEvent.press(screen.getByTestId('appearance-dark'));
    expect(screen.getByTestId('probe-scheme')).toHaveTextContent('dark');
    expect(StyleSheet.flatten(screen.getByTestId('probe-text').props.style).color).toBe(darkPalette.ink);
    expect(screen.getByTestId('appearance-dark').props.accessibilityState).toMatchObject({ checked: true });
    expect(saved().appearance).toBe('dark');
  });

  it('Light overrides a dark phone', async () => {
    store.set(DISPLAY_SETTINGS_KEY, JSON.stringify({ appearance: 'dark' }));
    await show(<AppearanceScreen />);
    await fireEvent.press(screen.getByTestId('appearance-light'));
    expect(screen.getByTestId('probe-scheme')).toHaveTextContent('light');
    expect(StyleSheet.flatten(screen.getByTestId('probe-text').props.style).color).toBe(lightPalette.ink);
    expect(saved().appearance).toBe('light');
  });
});

describe('Accessibility', () => {
  it('lists text size and every switch, labels only', async () => {
    await show(<AccessibilityScreen />);
    for (const label of [
      'Text size',
      'Dyslexia-friendly font',
      'Bold text',
      'High contrast',
      'Reduce motion',
      'Colour-blind friendly',
      'Haptics',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId('accessibility-text-size-value')).toHaveTextContent('100%');
  });

  it('text size goes up in steps to 200%, never further, and is stored', async () => {
    await show(<AccessibilityScreen />);
    const slider = screen.getByTestId('accessibility-text-size');
    for (let i = 0; i < 12; i++) {
      await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    }
    expect(screen.getByTestId('accessibility-text-size-value')).toHaveTextContent('200%');
    expect(saved().textScale).toBe(2);
  });

  it.each([
    ['accessibility-dyslexia-switch', 'dyslexiaFont', 'probe-font', 'Lexend_400Regular'],
    ['accessibility-bold-switch', 'boldText', 'probe-font', 'Inter_500Medium'],
    ['accessibility-contrast-switch', 'highContrast', 'probe-border', highContrast.light.border!],
    ['accessibility-motion-switch', 'reduceMotion', 'probe-motion', 'true'],
    ['accessibility-colour-blind-switch', 'colourBlind', 'probe-colour-blind', 'true'],
  ])('%s turns on %s app-wide and stores it', async (switchID, key, probe, expected) => {
    await show(<AccessibilityScreen />);
    await fireEvent(screen.getByTestId(switchID), 'valueChange', true);
    expect(screen.getByTestId(probe)).toHaveTextContent(expected);
    expect(saved()[key]).toBe(true);
  });

  it('haptics are on by default; off is stored and stops them', async () => {
    await show(<AccessibilityScreen />);
    expect(screen.getByTestId('accessibility-haptics-switch').props.value).toBe(true);
    await fireEvent(screen.getByTestId('accessibility-haptics-switch'), 'valueChange', false);
    expect(saved().haptics).toBe(false);
    const { haptic } = jest.requireActual<typeof import('@/lib/haptics')>('@/lib/haptics');
    haptic.tap();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('turning haptics back on gives one tap, so the player feels it', async () => {
    store.set(DISPLAY_SETTINGS_KEY, JSON.stringify({ haptics: false }));
    await show(<AccessibilityScreen />);
    await fireEvent(screen.getByTestId('accessibility-haptics-switch'), 'valueChange', true);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it('every switch has an accessibility label', async () => {
    await show(<AccessibilityScreen />);
    for (const id of ['dyslexia', 'bold', 'contrast', 'motion', 'colour-blind', 'haptics']) {
      expect(screen.getByTestId(`accessibility-${id}-switch`).props.accessibilityLabel).toBeTruthy();
    }
  });
});
