// P10: spec 13's rules in the app. lib/rules.ts reads them, never invents
// them; every sentence with a rule's number follows public.app_rules with
// no code change; with no rules ever loaded, a sentence has no number.
import { readFileSync } from 'fs';
import { join } from 'path';

import { describeQuote } from '@/lib/booking-detail';
import { line, wholeTeamQuote } from '@/lib/booking-detail.fixtures';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { switchErrorMessage } from '@/lib/booking-switch';
import { choiceWords, gipedoModeSentence, gipedoStatusLine, pullOutWords } from '@/lib/booking-gipedo';
import type { GipedoDetail } from '@/lib/booking-search';
import { personalPremiumPerks, personalPremiumPriceLabel } from '@/lib/premium';
import {
  daysText,
  eurosText,
  getCachedRules,
  hoursText,
  minutesText,
  monthsText,
  onRulesChange,
  parseRules,
  RULE_COLUMNS,
  ruleText,
  setCachedRules,
} from '@/lib/rules';
import { CHANGED_RULES, primeRules, SPEC_RULES } from '@/lib/rules.fixtures';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
// lib/booking-detail.ts reaches lib/calendar (native storage); its sentences don't need it.
jest.mock('@/lib/calendar', () => ({}));

afterEach(() => {
  setCachedRules(null);
});

function gipedo(overrides: Partial<GipedoDetail> = {}): GipedoDetail {
  return {
    team: { id: 't1', name: 'Lions' },
    opponent: { state: 'none', team: null },
    my_side: 'a',
    pull_out: { kind: 'forfeit', cents: 6550, fee_per_player_cents: null },
    choice_due: true,
    choice: null,
    play_normal_cents: 6550,
    settlement: null,
    ...overrides,
  };
}

/** Every sentence in the app built from a rule, for one set of rules. */
function sentences() {
  return {
    window: describeBookingErrorMessage('beyond_booking_window'),
    gipedoFar: describeBookingErrorMessage('gipedo_too_far_ahead'),
    gipedoSoon: describeBookingErrorMessage('gipedo_too_soon'),
    choiceClosed: describeBookingErrorMessage('choice_closed'),
    nonRefundable: describeBookingErrorMessage('non_refundable_not_accepted'),
    paymentWindow: describeBookingErrorMessage('payment_window_closed'),
    tooLate: describeBookingErrorMessage('too_late_to_cancel'),
    switchClosed: switchErrorMessage('switch_closed'),
    gipedoMode: gipedoModeSentence(6550),
    gipedoStatus: gipedoStatusLine(gipedo()),
    forfeit: pullOutWords(gipedo())[0],
    choice: choiceWords(gipedo())?.message ?? '',
    refundChoice: describeQuote(
      wholeTeamQuote({
        lines: [
          line({ profile_id: 'p1', is_booker: true, action: 'keep_and_credit', value_cents: 680, kept_cents: 100, credit_cents: 580 }),
          line({ profile_id: 'p2', action: 'refund_choice', value_cents: 680, refund_cents: 680 }),
        ],
      }),
      'Nuevo Campo',
    ).join(' '),
  };
}

describe('parseRules', () => {
  it('keeps exactly the rules from a complete row', () => {
    expect(parseRules({ ...SPEC_RULES, id: true, updated_at: '2026-11-16T10:00:00Z' })).toEqual(SPEC_RULES);
  });

  it('refuses anything incomplete or broken: never half a set of rules', () => {
    expect(parseRules(null)).toBeNull();
    expect(parseRules('rules')).toBeNull();
    expect(parseRules({ ...SPEC_RULES, refund_cutoff_hours: undefined })).toBeNull();
    expect(parseRules({ ...SPEC_RULES, fee_each_pays_cents: 80.5 })).toBeNull();
    expect(parseRules({ ...SPEC_RULES, fee_each_pays_cents: '80' })).toBeNull();
    expect(parseRules({ ...SPEC_RULES, weather_thunderstorms: 'yes' })).toBeNull();
    expect(parseRules({ ...SPEC_RULES, premium_price_label: '' })).toBeNull();
  });

  it('reads only the rule columns', () => {
    expect(RULE_COLUMNS.split(', ').sort()).toEqual(Object.keys(SPEC_RULES).sort());
  });
});

describe('the copy in memory', () => {
  it('starts empty and tells listeners when rules arrive', () => {
    expect(getCachedRules()).toBeNull();
    const seen: number[] = [];
    const off = onRulesChange((r) => seen.push(r.fee_each_pays_cents));
    setCachedRules(SPEC_RULES);
    setCachedRules(CHANGED_RULES);
    off();
    setCachedRules(SPEC_RULES);
    expect(seen).toEqual([80, 90]);
    expect(getCachedRules()).toEqual(SPEC_RULES);
  });

  it('ruleText builds from the rules, or uses the wording without the number', () => {
    expect(ruleText((r) => `${r.refund_cutoff_hours} hours`, 'later')).toBe('later');
    primeRules();
    expect(ruleText((r) => `${r.refund_cutoff_hours} hours`, 'later')).toBe('6 hours');
  });
});

describe('words', () => {
  it.each([
    [hoursText(6), '6 hours'],
    [hoursText(1), '1 hour'],
    [minutesText(15), '15 minutes'],
    [minutesText(1), '1 minute'],
    [minutesText(60), '1 hour'],
    [minutesText(120), '2 hours'],
    [daysText(7), '7 days'],
    [daysText(1), '1 day'],
    [monthsText(12), '12 months'],
    [eurosText(80), '€0.80'],
  ])('%s', (got, want) => expect(got).toBe(want));
});

describe('every sentence with a rule follows app_rules', () => {
  it('spec 13 as it is today', () => {
    primeRules(SPEC_RULES);
    const s = sentences();
    expect(s.window).toBe('That day is too far ahead — standard accounts book up to 7 days ahead, Premium up to 14.');
    expect(s.gipedoFar).toBe('Gipedo Pano can only be booked up to 5 days ahead.');
    expect(s.gipedoSoon).toBe('Gipedo Pano needs at least 24 hours before kickoff, so there is time to find an opponent.');
    expect(s.choiceClosed).toBe('Kickoff is less than 6 hours away, so the game has been cancelled free.');
    expect(s.nonRefundable).toBe('This game starts in less than 6 hours, so it is non-refundable. Accept that to pay.');
    expect(s.paymentWindow).toBe('Payment had to be completed within 15 minutes of booking, so this booking was cancelled.');
    expect(s.tooLate).toBe('Less than 6 hours to kickoff, so this booking can no longer be refunded.');
    expect(s.switchClosed).toBe("Switching closes 6 hours before kickoff, so this booking can't be switched now.");
    expect(s.gipedoMode).toContain('Another team can take it on until 24 hours before kickoff.');
    expect(s.gipedoStatus).toBe('Waiting for an opponent. Teams can take it on until 24 hours before kickoff.');
    expect(s.forfeit).toMatch(/^Kickoff is less than 6 hours away, so your team counts as the losing team: €65\.50/);
    expect(s.choice).toContain('If you don’t choose by 6 hours before kickoff, it is cancelled free.');
    expect(s.refundChoice).toContain('chooses a card refund or credit within 48 hours.');
  });

  it('changed rules change the text, with no code change', () => {
    primeRules(CHANGED_RULES);
    const s = sentences();
    expect(s.window).toBe('That day is too far ahead — standard accounts book up to 3 days ahead, Premium up to 5.');
    expect(s.gipedoFar).toBe('Gipedo Pano can only be booked up to 3 days ahead.');
    expect(s.gipedoSoon).toContain('at least 12 hours before kickoff');
    expect(s.choiceClosed).toContain('less than 4 hours away');
    expect(s.nonRefundable).toContain('less than 4 hours');
    expect(s.paymentWindow).toContain('within 30 minutes of booking');
    expect(s.tooLate).toContain('Less than 4 hours to kickoff');
    expect(s.switchClosed).toContain('closes 4 hours before kickoff');
    expect(s.gipedoMode).toContain('until 12 hours before kickoff');
    expect(s.gipedoStatus).toContain('until 12 hours before kickoff');
    expect(s.forfeit).toContain('less than 4 hours away');
    expect(s.choice).toContain('by 4 hours before kickoff');
    expect(s.refundChoice).toContain('within 24 hours.');
  });

  it('with no rules ever loaded: the same sentences, with no number in them', () => {
    setCachedRules(null);
    const s = sentences();
    for (const [name, text] of Object.entries(s)) {
      // The server's amounts (€65.50) and player counts ("6 players"), and Gipedo
      // Pano's "50/50" split, may appear; a rule's number may not.
      const withoutAmounts = text
        .replace(/€\d+\.\d{2}/g, '')
        .replace(/\b\d+ (other )?players?\b/g, '')
        .replace('50/50', '');
      expect([name, withoutAmounts]).toEqual([name, expect.not.stringMatching(/\d/)]);
    }
    expect(s.window).toBe('That day is too far ahead for your account.');
  });
});

describe('Premium', () => {
  it('the price: the store’s live price first, then the rules, else a placeholder', () => {
    expect(personalPremiumPriceLabel(SPEC_RULES)).toBe('€4.99/mo');
    expect(personalPremiumPriceLabel(CHANGED_RULES)).toBe('€4.49/mo');
    expect(personalPremiumPriceLabel(SPEC_RULES, '£3.49')).toBe('£3.49/mo');
    expect(personalPremiumPriceLabel(null)).toBe('');
  });

  it('the perks: only the two in spec 13, the window and the service fee, from the rules', () => {
    expect(personalPremiumPerks(SPEC_RULES)).toEqual([
      'Book up to 14 days ahead, not just 7',
      'No service fee on your own spot',
    ]);
    expect(personalPremiumPerks(CHANGED_RULES)).toEqual([
      'Book up to 5 days ahead, not just 3',
      'A €0.10 service fee on your own spot, not €0.90',
    ]);
    expect(personalPremiumPerks(null)).toEqual([]);
    expect(personalPremiumPerks(SPEC_RULES).join(' ')).not.toMatch(/coming soon|badge/i);
  });

  it('no screen promises a verified badge: the app shows none anywhere', () => {
    for (const screen of ['app/(tabs)/index.tsx', 'app/account/how-it-works.tsx', 'app/premium-plan.tsx']) {
      expect(readFileSync(join(__dirname, '..', screen), 'utf8')).not.toMatch(/verified badge/i);
    }
  });
});
