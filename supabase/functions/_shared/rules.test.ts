// _shared/rules.ts: spec 13's rules read from public.app_rules, never a default.
import { deepStrictEqual, rejects, strictEqual, throws } from 'node:assert/strict';
import { createDbFake } from './db-fake.ts';
import { days, euros, hours, loadRules, minutes, months, parseRules } from './rules.ts';
import { SPEC_RULES } from './rules.fixtures.ts';


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
