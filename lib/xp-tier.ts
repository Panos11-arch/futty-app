// Bronze/Silver/Gold/Platinum XP tiers — same thresholds as the Profile tab's
// LEVEL_TIERS (app/(tabs)/profile.tsx), used here for squad post filters
// (item 5): a player's or team's level, derived from profiles.xp / teams.xp.
export const XP_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum'] as const;
export type XpTier = (typeof XP_TIERS)[number];

const TIER_THRESHOLDS: { name: XpTier; min: number }[] = [
  { name: 'Bronze', min: 0 },
  { name: 'Silver', min: 100 },
  { name: 'Gold', min: 250 },
  { name: 'Platinum', min: 500 },
];

export function xpTier(xp: number): XpTier {
  return [...TIER_THRESHOLDS].reverse().find((t) => xp >= t.min)?.name ?? 'Bronze';
}
