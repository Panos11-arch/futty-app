// The S13B match rating's colour bands (SofaScore style), mapped to the
// existing theme tokens in this one place (no ratingBand tokens yet: a
// design-system PR can swap them in). The number is always shown, so colour
// is never the only signal.
import type { ColorName } from '@/constants/futty-theme';

export type RatingBand = 'top' | 'great' | 'good' | 'fair' | 'low' | 'poor';

/** Fill and text colour for each band; every pair is at least 4.5:1 in light and dark. */
export const RATING_BAND_COLOURS: Record<RatingBand, { fill: ColorName; ink: ColorName }> = {
  top: { fill: 'ratingTop', ink: 'onRatingTop' }, // 9.0+
  great: { fill: 'green', ink: 'greenInk' }, // 8.0–8.9
  good: { fill: 'greenSoft', ink: 'ink' }, // 7.0–7.9
  fair: { fill: 'formDraw', ink: 'onFormDraw' }, // 6.5–6.9
  low: { fill: 'warningLight', ink: 'warning' }, // 6.0–6.4
  poor: { fill: 'formLoss', ink: 'onFormLoss' }, // below 6.0
};

/** The band of a rating as shown (one decimal). */
export function ratingBand(rating: number): RatingBand {
  const shown = Math.round(Number(rating) * 10) / 10;
  if (shown >= 9) return 'top';
  if (shown >= 8) return 'great';
  if (shown >= 7) return 'good';
  if (shown >= 6.5) return 'fair';
  if (shown >= 6) return 'low';
  return 'poor';
}

/** "8.4": one decimal. */
export function formatMatchRating(rating: number): string {
  return (Math.round(Number(rating) * 10) / 10).toFixed(1);
}
