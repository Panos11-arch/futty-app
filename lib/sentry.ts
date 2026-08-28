import * as Sentry from '@sentry/react-native';

// Initialized here (imported first thing in app/_layout.tsx) rather than
// inline there, so it runs before anything else in the app — including,
// critically, native module init that's been the site of the iOS 26 launch
// crash this is meant to catch. Sentry's native layer installs its own
// crash handler (KSCrash-based on iOS), which is what's needed here: our
// own NSSetUncaughtExceptionHandler attempt caught nothing, since this
// crash unwinds through std::terminate/abort rather than Foundation's
// top-level Objective-C exception handler.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  // Sends events immediately in dev too — flip off once this is no longer
  // the primary tool for chasing the launch crash.
  debug: true,
});

// DIAGNOSTIC: unconditional test event on every launch, to check whether
// the basic Sentry pipeline (JS-level capture + network + project/DSN)
// works at all, independent of whether native crash capture specifically
// can hook this app's launch crash. Remove once that's confirmed either way.
Sentry.captureMessage('diag: sentry pipeline test at launch');

export { Sentry };
