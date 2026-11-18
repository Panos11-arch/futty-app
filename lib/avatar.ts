// A12: a player's avatar as the server stores it (profiles.avatar_style,
// avatar_kit_colour, avatar_number) and as components/ui/avatar.tsx draws it.
import { kitColours, type KitColourName } from '@/constants/futty-theme';

export type AvatarStyle = 'initials' | 'kit';

/** The three avatar columns, as profiles and the public profile functions return them. */
export type AvatarFields = {
  avatar_style: AvatarStyle;
  avatar_kit_colour: KitColourName | null;
  avatar_number: number | null;
};

export type AvatarKit = { colour: KitColourName; number: number };

export const SHIRT_NUMBER_MIN = 1;
export const SHIRT_NUMBER_MAX = 99;

export function isKitColour(value: unknown): value is KitColourName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(kitColours, value);
}

export function isShirtNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= SHIRT_NUMBER_MIN && (value as number) <= SHIRT_NUMBER_MAX;
}

/** The kit to draw for a row, or null for initials (also when a field is missing or unknown). */
export function avatarKit(
  row: { avatar_style?: string | null; avatar_kit_colour?: string | null; avatar_number?: number | null } | null | undefined
): AvatarKit | null {
  if (!row || row.avatar_style !== 'kit') return null;
  if (!isKitColour(row.avatar_kit_colour) || !isShirtNumber(row.avatar_number)) return null;
  return { colour: row.avatar_kit_colour, number: row.avatar_number };
}

/** Keeps a picked shirt number within 1 to 99. */
export function clampShirtNumber(n: number): number {
  if (!Number.isFinite(n)) return SHIRT_NUMBER_MIN;
  return Math.min(SHIRT_NUMBER_MAX, Math.max(SHIRT_NUMBER_MIN, Math.round(n)));
}
