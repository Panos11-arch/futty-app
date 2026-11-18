// The Premium app icon (decided 18 November): Premium players' home-screen
// icon is the Premium logo (neon F on black). Both icons ship in the app
// (expo-alternate-app-icons, configured in app.json); nothing is downloaded.
//
//   - After a purchase the server has confirmed (verify-purchase), the app
//     reads profiles.is_premium from the server and switches to Premium.
//   - At each launch (PremiumIconSync), it follows the server's is_premium:
//     back to the standard icon once Premium has ended, and to the Premium
//     icon when the server says Premium but the standard icon shows (a new
//     phone, a reinstall), at most once per install, so iOS's "You have
//     changed the icon" alert can never come back on every launch.
//
// The app never decides Premium itself, and nothing here ever throws:
// an icon that can't be switched is left as it is.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

type AppIcons = typeof import('expo-alternate-app-icons');

/** The native module, or null where it isn't built in (an older development
 *  build, Expo Go, web, tests): loaded when used, so its absence never
 *  breaks the screen that imports this file. */
function appIcons(): AppIcons | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-alternate-app-icons') as AppIcons;
  } catch {
    return null;
  }
}

/** The alternate icon's name in app.json's expo-alternate-app-icons entry. */
export const PREMIUM_ICON = 'Premium';

/** Set once the launch check has switched an install to the Premium icon. */
export const LAUNCH_SWITCH_KEY = 'futty.premium_icon.launch_switch.v1';

export type IconMoment = 'purchase' | 'launch';

/** The icon to set (null = the standard icon), or null when nothing changes. */
export type IconChange = { to: typeof PREMIUM_ICON | null } | null;

export type PremiumIconResult = 'premium' | 'standard' | 'unchanged' | 'unsupported' | 'failed';

/** What to do, from the server's is_premium and the icon showing now. */
export function iconChange(moment: IconMoment, isPremium: boolean, current: string | null, launchSwitchUsed: boolean): IconChange {
  const showingPremium = current === PREMIUM_ICON;
  if (isPremium && !showingPremium) {
    if (moment === 'purchase') return { to: PREMIUM_ICON };
    return launchSwitchUsed ? null : { to: PREMIUM_ICON };
  }
  // Back to standard only at launch: "the next app launch after Premium ends".
  if (!isPremium && showingPremium && moment === 'launch') return { to: null };
  return null;
}

/** Whether this install already had its launch switch. A failed read
 *  counts as yes: better no switch than an alert on every launch. */
async function launchSwitchUsed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LAUNCH_SWITCH_KEY)) !== null;
  } catch {
    return true;
  }
}

async function rememberLaunchSwitch(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAUNCH_SWITCH_KEY, '1');
  } catch {
    // Not remembered: at worst the next launch switches (and alerts) once more.
  }
}

/** Puts the right icon up for the server's is_premium. Never throws. */
export async function syncPremiumIcon(moment: IconMoment, isPremium: boolean): Promise<PremiumIconResult> {
  try {
    const icons = appIcons();
    if (!icons?.supportsAlternateIcons) return 'unsupported';
    // Sync on Android, a promise on iOS (patches/expo-alternate-app-icons+11.0.0.patch).
    const current = (await icons.getAppIconName()) ?? null;
    const used = moment === 'launch' && isPremium && current !== PREMIUM_ICON ? await launchSwitchUsed() : false;
    const change = iconChange(moment, isPremium, current, used);
    if (!change) return 'unchanged';
    // Remembered before switching: if switching ends the app (Android), it
    // still never switches again on a later launch.
    if (moment === 'launch' && change.to === PREMIUM_ICON) await rememberLaunchSwitch();
    await icons.setAlternateAppIcon(change.to);
    return change.to === PREMIUM_ICON ? 'premium' : 'standard';
  } catch {
    return 'failed';
  }
}

/** After verify-purchase confirmed a purchase: the server's is_premium decides. */
export async function syncPremiumIconAfterPurchase(): Promise<PremiumIconResult> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 'failed';
    const { data, error } = await supabase.from('profiles').select('is_premium').eq('id', user.id).maybeSingle();
    if (error || !data) return 'failed';
    return await syncPremiumIcon('purchase', data.is_premium === true);
  } catch {
    return 'failed';
  }
}
