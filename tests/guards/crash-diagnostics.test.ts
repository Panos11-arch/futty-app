// The temporary iOS launch-crash diagnostics are gone (F7, after #142 fixed
// the crash): Sentry isn't in debug mode, nothing is sent on every launch,
// and the crash-reason-file config plugin is no longer in the build.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const sentry = fs.readFileSync(path.join(ROOT, 'lib', 'sentry.ts'), 'utf8');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

it('lib/sentry.ts never sets debug: true', () => {
  expect(sentry).not.toMatch(/debug\s*:\s*true/);
});

it('lib/sentry.ts sends no message or event at launch', () => {
  expect(sentry).not.toMatch(/captureMessage|captureException|captureEvent/);
});

it('app.json no longer lists withCrashReasonFile, and the plugin file is gone', () => {
  const plugins: (string | [string, unknown])[] = appJson.expo.plugins ?? [];
  const names = plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  expect(names.some((n) => n.includes('withCrashReasonFile'))).toBe(false);
  expect(fs.existsSync(path.join(ROOT, 'plugins', 'withCrashReasonFile.js'))).toBe(false);
});

it('the Reminders usage text says what Futty does with the calendar', () => {
  const calendar = appJson.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-calendar');
  expect(calendar[1].remindersPermission).toBe(
    'Futty only adds your games to your calendar. It never reads or changes your reminders.'
  );
});
