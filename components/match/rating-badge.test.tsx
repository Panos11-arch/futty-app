import { render, screen } from '@testing-library/react-native';

import { RatingBadge } from '@/components/match/rating-badge';
import { darkPalette, lightPalette, type ColorName, type Palette } from '@/constants/futty-theme';
import { formatMatchRating, RATING_BAND_COLOURS, ratingBand, type RatingBand } from '@/lib/match/rating';

/** Parses #RRGGBB or rgba(r, g, b, a) into [r, g, b, a]. */
function rgba(colour: string): [number, number, number, number] {
  if (colour.startsWith('#')) {
    const n = parseInt(colour.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const [r, g, b, a] = colour.replace(/[^\d.,]/g, '').split(',').map(Number);
  return [r, g, b, a ?? 1];
}

/** A translucent fill as it shows on the card (surface) behind it. */
function over(fill: string, base: string): [number, number, number] {
  const [r, g, b, a] = rgba(fill);
  const [br, bg, bb] = rgba(base);
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(palette: Palette, fill: ColorName, ink: ColorName): number {
  const bg = luminance(over(palette[fill], palette.surface));
  const fg = luminance(over(palette[ink], palette.surface));
  const [hi, lo] = bg > fg ? [bg, fg] : [fg, bg];
  return (hi + 0.05) / (lo + 0.05);
}

describe('ratingBand', () => {
  it.each<[number, RatingBand]>([
    [10, 'top'],
    [9.0, 'top'],
    [8.9, 'great'],
    [8.0, 'great'],
    [7.9, 'good'],
    [7.0, 'good'],
    [6.9, 'fair'],
    [6.5, 'fair'],
    [6.4, 'low'],
    [6.0, 'low'],
    [5.9, 'poor'],
    [3.0, 'poor'],
  ])('%s is %s', (rating, band) => {
    expect(ratingBand(rating)).toBe(band);
  });

  it('bands follow the number as shown (one decimal)', () => {
    expect(ratingBand(8.96)).toBe('top');
    expect(ratingBand(8.94)).toBe('great');
    expect(formatMatchRating(7)).toBe('7.0');
    expect(formatMatchRating(8.96)).toBe('9.0');
  });

  it.each(Object.keys(RATING_BAND_COLOURS) as RatingBand[])('%s reads at 4.5:1 or more, light and dark', (band) => {
    const { fill, ink } = RATING_BAND_COLOURS[band];
    expect(contrast(lightPalette, fill, ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkPalette, fill, ink)).toBeGreaterThanOrEqual(4.5);
  });

  it('green is only ever a fill, never the text', () => {
    for (const { ink } of Object.values(RATING_BAND_COLOURS)) {
      expect(ink).not.toBe('green');
      expect(ink).not.toBe('greenSoft');
    }
  });
});

describe('RatingBadge', () => {
  it('always shows the number, and says it', async () => {
    await render(<RatingBadge rating={9} testID="badge" />);
    expect(screen.getByText('9.0')).toBeTruthy();
    expect(screen.getByLabelText('Rating 9.0')).toBeTruthy();
  });
});
