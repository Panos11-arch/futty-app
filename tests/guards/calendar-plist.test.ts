// iOS launch crash guard. expo-calendar's CalendarModule checks the Reminders
// permission as soon as it is created, and calls RCTFatal when
// NSRemindersFullAccessUsageDescription is missing from Info.plist
// (ExpoCalendar.MissingCalendarPListValueException, RemindersPermissionsRequester.swift).
// Setting the plugin's "remindersPermission" to false removes that key, and
// release/preview builds then die about a second after launch. We never use
// Reminders, but the key must still carry a usage string.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');

type PluginEntry = string | [string, Record<string, unknown>?];

it('the expo-calendar plugin keeps a Reminders usage string', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const plugins: PluginEntry[] = appJson.expo.plugins ?? [];
  const entry = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-calendar');
  expect(entry).toBeDefined();

  const reminders = (entry as [string, Record<string, unknown>?])[1]?.remindersPermission;
  expect(typeof reminders).toBe('string');
  expect((reminders as string).trim().length).toBeGreaterThan(0);
});
