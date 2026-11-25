// Test-only: spec 13's rules as the migration's defaults
// (supabase/migrations/*_pay_app_rules.sql). Tests prime lib/rules.ts with
// these, or with a changed copy to check the text follows the rules.
import { setCachedRules, type AppRules } from '@/lib/rules';

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
  premium_price_label: '€4.99',
  premium_plus_price_label: '€7.99',
  weather_rain_chance_pct: 60,
  weather_heavy_rain: true,
  weather_wind_kmh: 40,
  weather_thunderstorms: true,
  weather_heat_c: 38,
  saved_searches_max: 5,
};

/** Every rule changed, to check text follows the rules with no code change. */
export const CHANGED_RULES: AppRules = {
  ...SPEC_RULES,
  fee_each_pays_cents: 90,
  fee_pay_all_cents: 60,
  fee_premium_cents: 10,
  gipedo_fee_cents: 70,
  window_standard_days: 3,
  window_premium_days: 5,
  free_cancel_minutes: 30,
  capture_delay_minutes: 30,
  cancel_fee_cents: 150,
  refund_cutoff_hours: 4,
  refund_choice_hours: 24,
  payment_window_minutes: 30,
  collection_delay_hours: 3,
  credit_expiry_months: 6,
  gipedo_max_days: 3,
  gipedo_opponent_hours: 12,
  premium_price_label: '€4.49',
  premium_plus_price_label: '€7.49',
  saved_searches_max: 3,
};

/** Prime the rules for a test; returns the rules primed. */
export function primeRules(rules: AppRules | null = SPEC_RULES): AppRules | null {
  setCachedRules(rules);
  return rules;
}
