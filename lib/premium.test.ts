// P7: Team Premium is off for the first release. Nothing offers it, and the
// leagues that need it say they're coming soon.
import { leagueFormatOpen, openablePlan, TEAM_PREMIUM_ENABLED } from '@/lib/premium';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('Team Premium flag', () => {
  it('is off for the release', () => {
    expect(TEAM_PREMIUM_ENABLED).toBe(false);
  });

  it('closes only the leagues that need Team Premium while it is off', () => {
    expect(leagueFormatOpen('5-a-side')).toBe(true);
    expect(leagueFormatOpen('7-a-side')).toBe(true);
    expect(leagueFormatOpen('9-a-side')).toBe(false);
    expect(leagueFormatOpen('11-a-side')).toBe(false);
  });

  it('opens them again when it is on', () => {
    expect(leagueFormatOpen('9-a-side', true)).toBe(true);
    expect(leagueFormatOpen('11-a-side', true)).toBe(true);
  });

  it('turns a Team Premium link into Personal Premium while it is off', () => {
    expect(openablePlan('team-9-a-side')).toBe('personal');
    expect(openablePlan('team-11-a-side')).toBe('personal');
    expect(openablePlan('personal')).toBe('personal');
    expect(openablePlan('team-9-a-side', true)).toBe('team-9-a-side');
  });
});


describe('premiumPriceMismatch / warnIfPremiumPriceDiffers (F6)', () => {
  const { premiumPriceMismatch, warnIfPremiumPriceDiffers } = jest.requireActual<typeof import('@/lib/premium')>('@/lib/premium');

  it('compares the amounts, whatever the store\'s format', () => {
    expect(premiumPriceMismatch('4,99 €', '€4.99')).toBe(false);
    expect(premiumPriceMismatch('€4.99', '€4.99')).toBe(false);
    expect(premiumPriceMismatch('5,99 €', '€3.99')).toBe(true);
    expect(premiumPriceMismatch('£2.79', '€3.99')).toBe(true);
  });

  it('nothing to compare yet: no mismatch', () => {
    expect(premiumPriceMismatch(null, '€3.99')).toBe(false);
    expect(premiumPriceMismatch('5,99 €', undefined)).toBe(false);
  });

  it('warns in development builds only, and only when they differ', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfPremiumPriceDiffers('5,99 €', '€3.99', true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('5,99 €');
    warnIfPremiumPriceDiffers('5,99 €', '€3.99', false);
    warnIfPremiumPriceDiffers('4,99 €', '€4.99', true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
