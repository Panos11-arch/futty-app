/**
 * Settings → Appearance and Settings → Accessibility, stored on the phone
 * only (docs/specs/15-design.md section 0.4). Read synchronously at launch,
 * so the first frame already has the right theme. Every read and write is in
 * try/catch: losing a display preference must never break the app.
 */
import type { authStorage as AuthStorage } from '@/lib/auth-storage';
import { clampSlider, DEFAULT_SETTINGS, type DisplaySettings } from '@/lib/theme/build-theme';

export const DISPLAY_SETTINGS_KEY = 'futty.display_settings';

const BOOLEANS = ['dyslexiaFont', 'boldText', 'highContrast', 'reduceMotion', 'colourBlind', 'haptics'] as const;

let cache: DisplaySettings | null = null;

/**
 * The phone's storage, loaded on first use rather than with this module:
 * every component reads the theme, and the SQLite-backed store must not load
 * with each of them (or at all where it can't, like component tests).
 */
function storage(): typeof AuthStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/auth-storage') as { authStorage: typeof AuthStorage }).authStorage ?? null;
  } catch {
    return null;
  }
}

/** Keeps each stored field that is valid; anything else gets its default. */
function sanitise(raw: unknown): DisplaySettings {
  const out: DisplaySettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.appearance === 'system' || r.appearance === 'light' || r.appearance === 'dark') out.appearance = r.appearance;
  if (typeof r.textScale === 'number') out.textScale = clampSlider(r.textScale);
  for (const key of BOOLEANS) if (typeof r[key] === 'boolean') out[key] = r[key] as boolean;
  return out;
}

export function loadDisplaySettings(): DisplaySettings {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(DISPLAY_SETTINGS_KEY) ?? null;
  } catch {
    raw = null;
  }
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  cache = sanitise(parsed);
  return cache;
}

export function saveDisplaySettings(settings: DisplaySettings) {
  cache = sanitise(settings);
  try {
    storage()?.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(cache));
  } catch {
    // Storage is absent while Expo prerenders the web output, or full: the
    // setting still applies until the app restarts.
  }
}

/** The latest settings, for code outside React (lib/haptics.ts). */
export function getDisplaySettings(): DisplaySettings {
  return cache ?? loadDisplaySettings();
}

/** Tests only. */
export function resetDisplaySettingsCache() {
  cache = null;
}
