// The Android Google Maps key (S17's maps) never sits in the repo: app.json
// keeps a marked placeholder, and app.config.js puts the key in from the EAS
// environment variable GOOGLE_MAPS_ANDROID_API_KEY at build time. An Android
// build on EAS without it stops, so a blank map never ships; the e2e-test
// build (Maestro, staging) and iOS (Apple Maps) don't need it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const staticConfig = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require('../../app.config.js') as (ctx: { config: typeof staticConfig }) => typeof staticConfig;

const PLACEHOLDER = 'REPLACE_WITH_GOOGLE_MAPS_ANDROID_API_KEY';
const KEYS = ['GOOGLE_MAPS_ANDROID_API_KEY', 'EAS_BUILD', 'EAS_BUILD_PLATFORM', 'EAS_BUILD_PROFILE'] as const;

type Plugin = string | [string, Record<string, unknown>];
const mapsOf = (config: { plugins: Plugin[] }) =>
  (config.plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-maps') as [string, Record<string, unknown>])[1];

function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, run: () => void) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    run();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const fresh = () => JSON.parse(JSON.stringify(staticConfig));

describe('app.config.js: the Android Maps key', () => {
  it('app.json itself only ever has the placeholder', () => {
    expect(mapsOf(staticConfig).androidGoogleMapsApiKey).toBe(PLACEHOLDER);
  });

  it('puts the key from the environment into react-native-maps, and changes nothing else', () => {
    withEnv({ GOOGLE_MAPS_ANDROID_API_KEY: 'AIza-test-key' }, () => {
      const config = appConfig({ config: fresh() });
      expect(mapsOf(config)).toEqual({ androidGoogleMapsApiKey: 'AIza-test-key' });
      const { plugins: _a, ...rest } = config;
      const { plugins: _b, ...staticRest } = staticConfig;
      expect(rest).toEqual(staticRest);
      expect(config.plugins.filter((p: Plugin) => !(Array.isArray(p) && p[0] === 'react-native-maps'))).toEqual(
        staticConfig.plugins.filter((p: Plugin) => !(Array.isArray(p) && p[0] === 'react-native-maps')),
      );
    });
  });

  it('never changes the config it was given', () => {
    withEnv({ GOOGLE_MAPS_ANDROID_API_KEY: 'AIza-test-key' }, () => {
      const given = fresh();
      appConfig({ config: given });
      expect(mapsOf(given).androidGoogleMapsApiKey).toBe(PLACEHOLDER);
    });
  });

  it('keeps the placeholder without a key outside an EAS build (expo start, eas update, Jest)', () => {
    withEnv({}, () => {
      expect(mapsOf(appConfig({ config: fresh() })).androidGoogleMapsApiKey).toBe(PLACEHOLDER);
    });
  });

  it.each(['development', 'preview', 'production'])('stops an EAS Android %s build without the key', (profile) => {
    withEnv({ EAS_BUILD: 'true', EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: profile }, () => {
      expect(() => appConfig({ config: fresh() })).toThrow(/GOOGLE_MAPS_ANDROID_API_KEY/);
    });
  });

  it('lets the e2e-test build and iOS builds go ahead without it', () => {
    withEnv({ EAS_BUILD: 'true', EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'e2e-test' }, () => {
      expect(() => appConfig({ config: fresh() })).not.toThrow();
    });
    withEnv({ EAS_BUILD: 'true', EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'production' }, () => {
      expect(() => appConfig({ config: fresh() })).not.toThrow();
    });
  });

  it('a blank key counts as missing', () => {
    withEnv({ GOOGLE_MAPS_ANDROID_API_KEY: '  ', EAS_BUILD: 'true', EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'production' }, () => {
      expect(() => appConfig({ config: fresh() })).toThrow(/GOOGLE_MAPS_ANDROID_API_KEY/);
    });
  });
});
