// P7: Team Premium is off for the first release. Nothing offers it, and the
// leagues that need it say they're coming soon.
import {
  defaultPlan,
  isPremiumPlayer,
  leagueFormatOpen,
  openablePlan,
  PERSONAL_PREMIUM_SKU,
  PERSONAL_PREMIUM_SKUS,
  personalPremiumPerks,
  planAction,
  PREMIUM_PLUS_SKU,
  premiumPlans,
  premiumTier,
  TEAM_PREMIUM_ENABLED,
} from '@/lib/premium';
import { SPEC_RULES } from '@/lib/rules.fixtures';

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

// ---- P1: two paid plans ------------------------------------------------------

describe('P1: Premium and Premium Plus', () => {
  const rules = { ...SPEC_RULES };

  it('the two store products, in one subscription group', () => {
    expect(PERSONAL_PREMIUM_SKU).toBe('premium_monthly_v2');
    expect(PREMIUM_PLUS_SKU).toBe('premium_plus_monthly');
    expect(PERSONAL_PREMIUM_SKUS).toEqual(['premium_monthly_v2', 'premium_plus_monthly']);
  });

  it('the tier from the server: loading, Basic, Premium, Premium Plus', () => {
    expect(premiumTier({ status: 'loading' })).toBeNull();
    expect(premiumTier({ status: 'ready', profile: { is_premium: false, premium_tier: 'basic' } })).toBe('basic');
    expect(premiumTier({ status: 'ready', profile: { is_premium: true, premium_tier: 'premium' } })).toBe('premium');
    expect(premiumTier({ status: 'ready', profile: { is_premium: true, premium_tier: 'premium_plus' } })).toBe('premium_plus');
    // A server without the column yet: is_premium decides.
    expect(premiumTier({ status: 'ready', profile: { is_premium: true } })).toBe('premium');
    expect(premiumTier({ status: 'ready', profile: { is_premium: false } })).toBe('basic');
  });

  it('is_premium is Premium for both paid tiers (the Card button, the logo, every Premium rule)', () => {
    expect(isPremiumPlayer({ status: 'ready', profile: { is_premium: true, premium_tier: 'premium_plus' } })).toBe(true);
    expect(isPremiumPlayer({ status: 'ready', profile: { is_premium: true, premium_tier: 'premium' } })).toBe(true);
    expect(isPremiumPlayer({ status: 'ready', profile: { is_premium: false, premium_tier: 'basic' } })).toBe(false);
  });

  it('Basic, Premium and Premium Plus with the store’s live prices, labels only; the current plan marked', () => {
    const plans = premiumPlans({
      rules,
      prices: { premium_monthly_v2: '£4.49', premium_plus_monthly: '£7.19' },
      tier: 'premium',
    });
    expect(plans.map((p) => [p.id, p.title, p.price, p.current])).toEqual([
      ['basic', 'Basic', 'Free', false],
      ['premium', 'Premium', '£4.49/mo', true],
      ['premium_plus', 'Premium Plus', '£7.19/mo', false],
    ]);
    expect(plans[2].perks).toEqual(['Everything in Premium', 'No ads']);
    expect(plans[1].perks).toEqual(personalPremiumPerks(rules));
    expect(plans[0].sku).toBeNull();
    expect(plans[2].sku).toBe('premium_plus_monthly');
  });

  it('no Premium Plus product from the store (not on sale yet): no Plus card at all', () => {
    const plans = premiumPlans({ rules, prices: { premium_monthly_v2: '€4.99' }, tier: 'basic' });
    expect(plans.map((p) => p.id)).toEqual(['basic', 'premium']);
    expect(plans[0].current).toBe(true);
  });

  it('before the store answers, Premium shows the rules’ label; Plus waits for the store', () => {
    const plans = premiumPlans({ rules, prices: {}, tier: 'basic' });
    expect(plans.map((p) => [p.id, p.price])).toEqual([
      ['basic', 'Free'],
      ['premium', '€4.99/mo'],
    ]);
  });

  it('what the button does: upgrade to a higher plan, manage the current or a lower one, nothing for Basic', () => {
    expect(planAction('premium', 'basic')).toBe('upgrade');
    expect(planAction('premium_plus', 'basic')).toBe('upgrade');
    expect(planAction('premium_plus', 'premium')).toBe('upgrade');
    expect(planAction('premium', 'premium')).toBe('manage');
    expect(planAction('premium_plus', 'premium_plus')).toBe('manage');
    expect(planAction('premium', 'premium_plus')).toBe('manage');
    expect(planAction('basic', 'premium')).toBe('manage');
    expect(planAction('basic', 'basic')).toBeNull();
  });

  it('opens on the best plan above the current one, else the current one', () => {
    const all = premiumPlans({ rules, prices: { premium_monthly_v2: '€4.99', premium_plus_monthly: '€7.99' }, tier: 'basic' });
    expect(defaultPlan(all, 'basic')).toBe('premium_plus');
    expect(defaultPlan(all, 'premium')).toBe('premium_plus');
    expect(defaultPlan(all, 'premium_plus')).toBe('premium_plus');
    const noPlus = all.filter((p) => p.id !== 'premium_plus');
    expect(defaultPlan(noPlus, 'basic')).toBe('premium');
    expect(defaultPlan(noPlus, 'premium')).toBe('premium');
  });
});
