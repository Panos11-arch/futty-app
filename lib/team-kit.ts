// S20A: a team's kit colour (the same eight tokens as player avatars,
// constants/futty-theme.ts kitColours). No server calls, so the team badge
// can use it without loading Supabase.
import { KIT_COLOUR_NAMES, kitColours, type KitColourName } from '@/constants/futty-theme';

/** The kit colours a team can pick, in picker order. */
export const KIT_COLOURS: readonly KitColourName[] = KIT_COLOUR_NAMES;

/** The team's kit token, or null when it has none (or an unknown one). */
export function teamKit(team: { kit_colour?: string | null }): KitColourName | null {
  const kit = team.kit_colour;
  return kit && kit in kitColours ? (kit as KitColourName) : null;
}
