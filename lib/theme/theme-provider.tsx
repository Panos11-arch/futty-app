/**
 * The live theme for the whole app (docs/specs/15-design.md sections 0.2 to
 * 0.4). Screens read it with useTheme() or a makeStyles() hook, never from
 * constants/futty-theme.ts directly, so Appearance and every Accessibility
 * setting apply everywhere at once.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Appearance, Platform, useColorScheme, useWindowDimensions } from 'react-native';

import {
  buildTheme,
  DEFAULT_SETTINGS,
  type DisplaySettings,
  type SystemSignals,
  type Theme,
} from '@/lib/theme/build-theme';
import { loadDisplaySettings, saveDisplaySettings } from '@/lib/theme/settings';

type ThemeContextValue = {
  theme: Theme;
  settings: DisplaySettings;
  updateSettings: (patch: Partial<DisplaySettings>) => void;
};

const FALLBACK_SYSTEM: SystemSignals = { colorScheme: 'light', fontScale: 1, reduceMotion: false, boldText: false };

/** Outside a ThemeProvider (component tests): the default light theme. */
const ThemeContext = createContext<ThemeContextValue>({
  theme: buildTheme(DEFAULT_SETTINGS, FALLBACK_SYSTEM),
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
});

/** A phone accessibility switch, kept live. */
function usePhoneFlag(
  read: () => Promise<boolean>,
  event: 'reduceMotionChanged' | 'boldTextChanged',
): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let mounted = true;
    Promise.resolve()
      .then(read)
      .then((value) => mounted && setOn(!!value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(event, (value: boolean) => setOn(!!value));
    return () => {
      mounted = false;
      sub?.remove();
    };
  }, [read, event]);
  return on;
}

const readReduceMotion = () => AccessibilityInfo.isReduceMotionEnabled();
const readBoldText = () =>
  Platform.OS === 'ios' ? AccessibilityInfo.isBoldTextEnabled() : Promise.resolve(false);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DisplaySettings>(loadDisplaySettings);
  const colorScheme = useColorScheme();
  const { fontScale } = useWindowDimensions();
  const reduceMotion = usePhoneFlag(readReduceMotion, 'reduceMotionChanged');
  const boldText = usePhoneFlag(readBoldText, 'boldTextChanged');

  // Light or Dark in the app also switches native pieces (keyboard, alerts,
  // the date picker). System hands control back to the phone.
  useEffect(() => {
    try {
      Appearance.setColorScheme(settings.appearance === 'system' ? 'unspecified' : settings.appearance);
    } catch {
      // Not available (older OS, web): our own colours still switch.
    }
  }, [settings.appearance]);

  const theme = useMemo(
    () => buildTheme(settings, { colorScheme, fontScale, reduceMotion, boldText }),
    [settings, colorScheme, fontScale, reduceMotion, boldText],
  );

  const updateSettings = useCallback((patch: Partial<DisplaySettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveDisplaySettings(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, settings, updateSettings }), [theme, settings, updateSettings]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The live theme: colours, type scale, fonts and accessibility flags. */
export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

/** The stored settings and a way to change them (Settings → Appearance / Accessibility). */
export function useDisplaySettings() {
  const { settings, updateSettings } = useContext(ThemeContext);
  return { settings, updateSettings };
}

/** For tests: renders children with a theme built from these settings. */
export function TestThemeProvider({
  children,
  settings = {},
  system = {},
}: {
  children: ReactNode;
  settings?: Partial<DisplaySettings>;
  system?: Partial<SystemSignals>;
}) {
  const [current, setCurrent] = useState<DisplaySettings>({ ...DEFAULT_SETTINGS, ...settings });
  const theme = useMemo(() => buildTheme(current, { ...FALLBACK_SYSTEM, ...system }), [current, system]);
  const updateSettings = useCallback((patch: Partial<DisplaySettings>) => setCurrent((p) => ({ ...p, ...patch })), []);
  const value = useMemo(() => ({ theme, settings: current, updateSettings }), [theme, current, updateSettings]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
