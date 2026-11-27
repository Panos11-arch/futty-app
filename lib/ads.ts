// Google AdMob banners (S16 set up the SDK; G4a shows them).
//
// Who sees a banner comes from the server, never the app: my_ad_settings()
// says ads_allowed (false on Premium Plus, P1) and under_age (under 18 on
// today's Cyprus date, A3, or no date of birth yet). A player who may not
// see ads never starts the SDK.
//
// Before any ad: AdMob's under-age setting (tagForUnderAgeOfConsent) for a
// minor, then Google's consent form (UMP), which shows only where the law
// needs it (the EU) and only when the player hasn't answered yet. Every
// request is non-personalised, for every age, so App Tracking Transparency
// isn't asked for and app.json has no tracking text; if Futty ever shows
// personalised ads to adults, that changes (with Panos's decision).
//
// Development, preview and e2e builds show Google's TEST banner, so nobody
// clicks Futty's own ads; only a release build on the production channel
// requests the real one. The e2e build shows none, so Maestro journeys don't
// depend on an ad loading.
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import mobileAds, { AdsConsent, TestIds } from 'react-native-google-mobile-ads';

import { supabase } from '@/lib/supabase';

/** Every ad request is non-personalised. */
export const AD_REQUEST_OPTIONS = { requestNonPersonalizedAdsOnly: true } as const;

/** Futty's real AdMob banner units (production builds only). */
export const BANNER_IDS = {
  ios: 'ca-app-pub-2436288039660225/6579627774',
  android: 'ca-app-pub-2436288039660225/3376034886',
} as const;

/** How long one player's settings are reused by every banner. */
export const AD_SETTINGS_TTL_MS = 60_000;

export type AdSettings = { adsAllowed: boolean; underAge: boolean };

/** Only a release build on the production channel shows real ads. */
export function isLiveAdsBuild(build: { dev: boolean; channel: string | null } = { dev: __DEV__, channel: Updates.channel }) {
  return !build.dev && build.channel === 'production';
}

export function bannerUnitId(os: string, live: boolean): string {
  if (!live) return TestIds.ADAPTIVE_BANNER;
  return os === 'android' ? BANNER_IDS.android : BANNER_IDS.ios;
}

/** Phones only, and never in the e2e build. */
export function adsSupported(
  env: { os: string; e2e: string | undefined } = { os: Platform.OS, e2e: process.env.EXPO_PUBLIC_E2E },
) {
  return (env.os === 'ios' || env.os === 'android') && env.e2e !== '1';
}

let settingsCache: { userId: string; at: number; settings: Promise<AdSettings | null> } | null = null;

async function readSettings(): Promise<AdSettings | null> {
  try {
    const { data, error } = await supabase.rpc('my_ad_settings');
    if (error || !data) return null;
    const row = data as { ads_allowed?: unknown; under_age?: unknown };
    return { adsAllowed: row.ads_allowed === true, underAge: row.under_age !== false };
  } catch {
    return null;
  }
}

/** The signed-in player's ad settings from the server; null when signed out or unknown (no ads). */
export async function getAdSettings(now: number = Date.now()): Promise<AdSettings | null> {
  let userId: string | undefined;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data.session?.user.id;
  } catch {
    return null;
  }
  if (!userId) return null;
  if (settingsCache && settingsCache.userId === userId && now - settingsCache.at < AD_SETTINGS_TTL_MS) {
    return settingsCache.settings;
  }
  const settings = readSettings();
  const entry = { userId, at: now, settings };
  settingsCache = entry;
  const result = await settings;
  // A failed read is asked again next time.
  if (result === null && settingsCache === entry) settingsCache = null;
  return result;
}

/**
 * Sets the under-age setting, gathers consent, then starts the SDK when ads
 * may be requested. Never throws.
 */
export async function prepareAds({ underAge }: { underAge: boolean }): Promise<{ canRequestAds: boolean }> {
  try {
    await mobileAds().setRequestConfiguration({ tagForUnderAgeOfConsent: underAge });
  } catch {
    // Never request an ad without the right age setting.
    return { canRequestAds: false };
  }
  try {
    await AdsConsent.gatherConsent({ tagForUnderAgeOfConsent: underAge });
  } catch {
    // Offline or the form failed: Google advises using any consent already given.
  }
  try {
    const { canRequestAds } = await AdsConsent.getConsentInfo();
    if (!canRequestAds) return { canRequestAds: false };
    await mobileAds().initialize();
    return { canRequestAds: true };
  } catch {
    return { canRequestAds: false };
  }
}

// Once per app run for each age setting, shared by every banner.
let prepared: { underAge: boolean; result: Promise<{ canRequestAds: boolean }> } | null = null;

function prepareOnce(underAge: boolean) {
  if (!prepared || prepared.underAge !== underAge) prepared = { underAge, result: prepareAds({ underAge }) };
  return prepared.result;
}

async function adsReady(): Promise<boolean> {
  const settings = await getAdSettings();
  if (!settings?.adsAllowed) return false;
  return (await prepareOnce(settings.underAge)).canRequestAds;
}

/** True once a banner may be requested for the signed-in player. */
export function useAdsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!adsSupported()) return;
    let active = true;
    adsReady().then((ok) => {
      if (active) setReady(ok);
    });
    return () => {
      active = false;
    };
  }, []);
  return ready;
}

/** Tests only: forget the cached settings and SDK start. */
export function resetAdsForTesting() {
  settingsCache = null;
  prepared = null;
}
