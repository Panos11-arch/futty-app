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

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Appearance, Dimensions, Pressable, Text } from 'react-native';

import { darkPalette, lightPalette } from '@/constants/futty-theme';
import { authStorage } from '@/lib/auth-storage';
import { combinedTextScale } from '@/lib/theme/build-theme';
import { makeStyles } from '@/lib/theme/make-styles';
import { DISPLAY_SETTINGS_KEY, resetDisplaySettingsCache } from '@/lib/theme/settings';
import { ThemeProvider, useDisplaySettings, useTheme } from '@/lib/theme/theme-provider';

const store = (authStorage as unknown as { map: Map<string, string> }).map;

const useStyles = makeStyles(({ colors, type }) => ({
  label: { ...type.body, color: colors.ink },
}));

let builds = 0;
const useCountedStyles = makeStyles(({ colors }) => {
  builds += 1;
  return { box: { backgroundColor: colors.canvas } };
});

function Probe() {
  const styles = useStyles();
  useCountedStyles();
  const theme = useTheme();
  const { settings, updateSettings } = useDisplaySettings();
  return (
    <>
      <Text testID="label" style={styles.label}>
        {theme.scheme}
      </Text>
      <Text testID="haptics">{String(settings.haptics)}</Text>
      <Pressable testID="dark" onPress={() => updateSettings({ appearance: 'dark' })} />
      <Pressable testID="big" onPress={() => updateSettings({ textScale: 2 })} />
    </>
  );
}

beforeEach(() => {
  store.clear();
  resetDisplaySettingsCache();
  builds = 0;
});

describe('ThemeProvider', () => {
  it('starts light at 100% by default', async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('label')).toHaveTextContent('light');
    expect(screen.getByTestId('label')).toHaveStyle({ color: lightPalette.ink });
  });

  it('reads the stored settings on the first frame (no flash of the wrong theme)', async () => {
    store.set(DISPLAY_SETTINGS_KEY, JSON.stringify({ appearance: 'dark', haptics: false }));
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('label')).toHaveTextContent('dark');
    expect(screen.getByTestId('haptics')).toHaveTextContent('false');
  });

  it('switching Appearance restyles at once, saves it and tells the phone', async () => {
    const setColorScheme = jest.spyOn(Appearance, 'setColorScheme');
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(setColorScheme).toHaveBeenLastCalledWith('unspecified');
    await fireEvent.press(screen.getByTestId('dark'));
    expect(screen.getByTestId('label')).toHaveStyle({ color: darkPalette.ink });
    expect(JSON.parse(store.get(DISPLAY_SETTINGS_KEY)!).appearance).toBe('dark');
    expect(setColorScheme).toHaveBeenLastCalledWith('dark');
  });

  it('text size scales the type everywhere, within the 2.0x cap with the phone', async () => {
    const phoneScale = Dimensions.get('window').fontScale;
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await fireEvent.press(screen.getByTestId('big'));
    expect(screen.getByTestId('label')).toHaveStyle({ fontSize: 16 * combinedTextScale(phoneScale, 2).inApp });
  });

  it('builds each style sheet once per theme, not on every render', async () => {
    const view = await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await view.rerender(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(builds).toBe(1);
  });
});
