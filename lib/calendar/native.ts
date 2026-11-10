import { Platform } from 'react-native';

import type { CalendarEventDetails } from './event';

/**
 * The part of expo-calendar (SDK 55, classic API) lib/calendar uses. Typed here
 * so this code compiles and its tests run before expo-calendar is installed
 * (it arrives in its own PR, anghelo/a3a-calendar-deps, with a new build).
 */
export type DeviceCalendar = {
  id: string;
  allowsModifications: boolean;
  /** Android only. */
  isPrimary?: boolean;
};

export type CalendarModule = {
  getCalendarPermissionsAsync(): Promise<{ granted: boolean }>;
  requestCalendarPermissionsAsync(): Promise<{ granted: boolean }>;
  /** iOS only. */
  getDefaultCalendarAsync(): Promise<DeviceCalendar>;
  getCalendarsAsync(entityType?: string): Promise<DeviceCalendar[]>;
  createEventAsync(calendarId: string, eventData: CalendarEventDetails): Promise<string>;
  updateEventAsync(id: string, details: Partial<CalendarEventDetails>): Promise<string>;
  deleteEventAsync(id: string): Promise<void>;
  EntityTypes: { EVENT: string };
};

/**
 * expo-calendar, or null where it can't run: on web, before the package is
 * installed, or on a development build made before it was added (the native
 * module is missing and the import throws). The require sits in try/catch,
 * which Metro treats as an optional dependency.
 */
export function loadCalendarModule(): CalendarModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-calendar') as CalendarModule;
  } catch {
    return null;
  }
}
