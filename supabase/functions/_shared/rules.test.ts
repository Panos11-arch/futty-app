// _shared/rules.ts: spec 13's rules read from public.app_rules, never a default.
import { deepStrictEqual, rejects, strictEqual, throws } from 'node:assert/strict';
import { createDbFake } from './db-fake.ts';
import { type AppRules, days, euros, hours, loadRules, minutes, months, parseRules } from './rules.ts';

/** The defaults in the migration, which are spec 13's numbers. */
export const SPEC_RULES: AppRules = {
  fee_each_pays_cents: 80,
  fee_pay_all_cents: 55,
  fee_premium_cents: 0,
  gipedo_fee_cents: 55,
  window_standard_days: 7,
  window_premium_days: 14,
  free_cancel_minutes: 60,
  cancel_fee_cents: 100,
  refund_cutoff_hours: 6,
  refund_choice_hours: 48,
  capture_delay_minutes: 60,
  payment_window_minutes: 15,
  guarantee_hold_lead_hours: 72,
  guarantee_retry_hours: 6,
  collection_delay_hours: 2,
  credit_expiry_months: 12,
  gipedo_max_days: 5,
  gipedo_opponent_hours: 24,
  premium_price_label: '€3.99',
  weather_rain_chance_pct: 60,
  weather_heavy_rain: true,
  weather_wind_kmh: 40,
  weather_thunderstorms: true,
  weather_heat_c: 38,
};

Deno.test('loads the rules from the database, as they are', async () => {
  const fake = createDbFake();
  fake.respond('app_rules_now', { ...SPEC_RULES, id: true, updated_at: '2026-11-15T10:00:00Z' });
  deepStrictEqual(await loadRules(fake.db), SPEC_RULES, 'only the rules, nothing extra');
  strictEqual(fake.callsTo('app_rules_now').length, 1);
});

Deno.test('a changed rule comes through unchanged', async () => {
  const fake = createDbFake();
  fake.respond('app_rules_now', { ...SPEC_RULES, fee_each_pays_cents: 90, refund_cutoff_hours: 4 });
  const rules = await loadRules(fake.db);
  strictEqual(rules.fee_each_pays_cents, 90);
  strictEqual(rules.refund_cutoff_hours, 4);
});

Deno.test('no guessing: missing or broken rules fail', async () => {
  const fake = createDbFake();
  fake.fail('app_rules_now', 'permission denied for function app_rules_now');
  await rejects(() => loadRules(fake.db), /permission denied/);
  throws(() => parseRules(null), /app_rules_missing/);
  throws(() => parseRules({ ...SPEC_RULES, fee_each_pays_cents: undefined }), /fee_each_pays_cents/);
  throws(() => parseRules({ ...SPEC_RULES, refund_cutoff_hours: 6.5 }), /refund_cutoff_hours/);
  throws(() => parseRules({ ...SPEC_RULES, weather_thunderstorms: 'yes' }), /weather_thunderstorms/);
  throws(() => parseRules({ ...SPEC_RULES, premium_price_label: '' }), /premium_price_label/);
});

Deno.test('words for the rules', () => {
  strictEqual(euros(80), '€0.80');
  strictEqual(euros(100), '€1.00');
  strictEqual(euros(-550), '-€5.50');
  throws(() => euros(0.5), /integer cents/);
  strictEqual(hours(6), '6 hours');
  strictEqual(hours(1), '1 hour');
  strictEqual(minutes(15), '15 minutes');
  strictEqual(minutes(1), '1 minute');
  strictEqual(minutes(60), '1 hour');
  strictEqual(minutes(120), '2 hours');
  strictEqual(days(7), '7 days');
  strictEqual(days(1), '1 day');
  strictEqual(months(12), '12 months');
  strictEqual(months(1), '1 month');
});
