// The Android Google Maps key never sits in the repo: app.json keeps a marked
// placeholder and this puts the key in at build time from the EAS environment
// variable GOOGLE_MAPS_ANDROID_API_KEY (Panos sets it with `eas env:create`
// for development, preview and production). The key is restricted in Google
// Cloud to the Android package and its signing certificates.
//
// An Android build on EAS without the key stops here, so a blank map never
// ships. The e2e-test build (Maestro against staging) and iOS (Apple Maps)
// don't need it, and nor do `expo start`, `eas update` or Jest.
const MAPS_PLUGIN = 'react-native-maps';
const KEY_VARIABLE = 'GOOGLE_MAPS_ANDROID_API_KEY';

module.exports = ({ config }) => {
  const key = (process.env[KEY_VARIABLE] ?? '').trim();
  const androidEasBuild = process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PLATFORM === 'android';

  if (!key) {
    if (androidEasBuild && process.env.EAS_BUILD_PROFILE !== 'e2e-test') {
      throw new Error(
        `${KEY_VARIABLE} is not set for this EAS build ("${process.env.EAS_BUILD_PROFILE}"). ` +
          `Add it with: eas env:create --name ${KEY_VARIABLE} --environment ${process.env.EAS_BUILD_PROFILE} --visibility sensitive`,
      );
    }
    return config;
  }

  return {
    ...config,
    plugins: config.plugins.map((plugin) =>
      Array.isArray(plugin) && plugin[0] === MAPS_PLUGIN
        ? [MAPS_PLUGIN, { ...plugin[1], androidGoogleMapsApiKey: key }]
        : plugin,
    ),
  };
};
