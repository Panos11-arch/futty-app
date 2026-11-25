// S16: every new native piece in one development build (app.json and
// package.json). The exact permission texts, entitlements and plugin options
// are checked here so a later change can't quietly drop one.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

type Plugin = string | [string, Record<string, unknown>];
const plugins: Plugin[] = app.plugins;

function plugin(name: string): Record<string, unknown> {
  const entry = plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  if (!entry) throw new Error(`${name} is not in app.json's plugins`);
  return Array.isArray(entry) ? entry[1] : {};
}

const PHOTOS = 'Futty uses your photos so you can attach them in chats, and so venue staff can add pitch and menu pictures.';
const CAMERA = 'Futty uses the camera to scan check-in and player codes, and to take photos you attach in chats.';
const LOCATION = 'Futty uses your location only to show the weather and venues near you.';

describe('S16 native modules', () => {
  it('are installed at Expo SDK 55 versions (AdMob pinned to the last release for React Native 0.83)', () => {
    expect(pkg.dependencies['expo-location']).toMatch(/^~55\./);
    expect(pkg.dependencies['expo-widgets']).toMatch(/^~55\./);
    expect(pkg.dependencies['react-native-maps']).toBe('1.27.2');
    expect(pkg.dependencies['react-native-view-shot']).toBe('4.0.3');
    expect(pkg.dependencies['react-native-google-mobile-ads']).toBe('17.0.0');
  });

  it('photo library and camera texts cover every use', () => {
    expect(plugin('expo-image-picker')).toMatchObject({ photosPermission: PHOTOS, cameraPermission: CAMERA });
    expect(plugin('expo-camera')).toMatchObject({ cameraPermission: CAMERA, microphonePermission: false });
  });

  it('location: when in use only, with the agreed text on every iOS key, no background location', () => {
    const location = plugin('expo-location');
    expect(location).toMatchObject({
      locationWhenInUsePermission: LOCATION,
      locationAlwaysAndWhenInUsePermission: LOCATION,
      locationAlwaysPermission: LOCATION,
    });
    expect(location.isIosBackgroundLocationEnabled).toBeFalsy();
    expect(location.isAndroidBackgroundLocationEnabled).toBeFalsy();
    expect(location.isAndroidForegroundServiceEnabled).toBeFalsy();
  });

  it('maps: Apple Maps on iOS (no key); Android has only a marked placeholder, never a real key', () => {
    const maps = plugin('react-native-maps');
    expect(maps.iosGoogleMapsApiKey).toBeUndefined();
    expect(maps.androidGoogleMapsApiKey).toBe('REPLACE_WITH_GOOGLE_MAPS_ANDROID_API_KEY');
  });

  it('widgets: the Live Activity extension with push (aps-environment), its own bundle id and app group', () => {
    expect(plugin('expo-widgets')).toEqual({
      bundleIdentifier: 'com.panosalepis.futtyapp.ExpoWidgetsTarget',
      groupIdentifier: 'group.com.panosalepis.futtyapp',
      enablePushNotifications: true,
      widgets: [],
    });
  });

  it('AdMob: Google’s public TEST app IDs until Panos has real ones; measurement waits for consent; no tracking prompt', () => {
    expect(plugin('react-native-google-mobile-ads')).toEqual({
      androidAppId: 'ca-app-pub-3940256099942544~3347511713',
      iosAppId: 'ca-app-pub-3940256099942544~1458002511',
      delayAppMeasurementInit: true,
    });
    expect(app.ios.infoPlist.NSUserTrackingUsageDescription).toBeUndefined();
  });

  it('universal links: futty.app/p/<username> opens the app on iOS and Android', () => {
    expect(app.ios.associatedDomains).toEqual(['applinks:futty.app']);
    expect(app.android.intentFilters).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'futty.app', pathPrefix: '/p/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
  });

  it('keeps every plugin that was there before', () => {
    for (const name of [
      'expo-router',
      'expo-local-authentication',
      'expo-splash-screen',
      'expo-sqlite',
      'expo-notifications',
      'expo-iap',
      'expo-apple-authentication',
      'expo-contacts',
      'expo-calendar',
      '@stripe/stripe-react-native',
      'expo-image-picker',
      'expo-camera',
      '@react-native-community/datetimepicker',
      '@sentry/react-native',
      'expo-alternate-app-icons',
    ]) {
      expect(() => plugin(name)).not.toThrow();
    }
  });
});
