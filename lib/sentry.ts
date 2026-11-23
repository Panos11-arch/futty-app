import * as Sentry from '@sentry/react-native';

// Initialized here (imported first thing in app/_layout.tsx) rather than
// inline there, so it runs before anything else in the app — including,
// critically, native module init. Sentry's native layer installs its own
// crash handler (KSCrash-based on iOS), so a crash during launch is still
// reported. The temporary launch-crash diagnostics (debug mode and a test
// event on every launch) were removed once #142 fixed that crash (F7).
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
});

export { Sentry };
