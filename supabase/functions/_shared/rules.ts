// Spec 13's rules for Edge Functions (P10): every fee, booking window and
// time limit, read from public.app_rules, the one source. The payment
// functions don't need it (the database applies the rules itself); the
// Futty AI builds its system prompt from it, and P11 reads the weather
// thresholds. Nothing here has a default: if the rules can't be read, the
// caller fails rather than guessing a number.
import { type Db, rpc } from './db.ts';

/** One row of public.app_rules (see supabase/migrations/*_pay_app_rules.sql). */
export type AppRules = {
  fee_each_pays_cents: number;
  fee_pay_all_cents: number;
  fee_premium_cents: number;
  gipedo_fee_cents: number;
  window_standard_days: number;
  window_premium_days: number;
  free_cancel_minutes: number;
  cancel_fee_cents: number;
  refund_cutoff_hours: number;
  refund_choice_hours: number;
  capture_delay_minutes: number;
  payment_window_minutes: number;
  guarantee_hold_lead_hours: number;
  guarantee_retry_hours: number;
  collection_delay_hours: number;
  credit_expiry_months: number;
  gipedo_max_days: number;
  gipedo_opponent_hours: number;
  premium_price_label: string;
  /** P1: Premium Plus's price label (€7.99). */
  premium_plus_price_label: string;
  weather_rain_chance_pct: number;
  weather_heavy_rain: boolean;
  weather_wind_kmh: number;
  weather_thunderstorms: boolean;
  weather_heat_c: number;
  saved_searches_max: number;
};

const INTEGER_RULES = [
  'fee_each_pays_cents', 'fee_pay_all_cents', 'fee_premium_cents', 'gipedo_fee_cents',
  'window_standard_days', 'window_premium_days',
  'free_cancel_minutes', 'cancel_fee_cents', 'refund_cutoff_hours', 'refund_choice_hours',
  'capture_delay_minutes', 'payment_window_minutes', 'guarantee_hold_lead_hours', 'guarantee_retry_hours',
  'collection_delay_hours', 'credit_expiry_months', 'gipedo_max_days', 'gipedo_opponent_hours',
  'weather_rain_chance_pct', 'weather_wind_kmh', 'weather_heat_c', 'saved_searches_max',
] as const satisfies readonly (keyof AppRules)[];

const BOOLEAN_RULES = ['weather_heavy_rain', 'weather_thunderstorms'] as const satisfies readonly (keyof AppRules)[];

/** Checks a row from the database is a complete set of rules. */
/** The price labels (P1: Premium and Premium Plus). */
const LABEL_RULES = ['premium_price_label', 'premium_plus_price_label'] as const satisfies readonly (keyof AppRules)[];

export function parseRules(row: unknown): AppRules {
  if (!row || typeof row !== 'object') throw new Error('app_rules_missing');
  const r = row as Record<string, unknown>;
  for (const key of INTEGER_RULES) {
    if (!Number.isInteger(r[key])) throw new Error(`app_rules_invalid: ${key}`);
  }
  for (const key of BOOLEAN_RULES) {
    if (typeof r[key] !== 'boolean') throw new Error(`app_rules_invalid: ${key}`);
  }
  for (const key of LABEL_RULES) {
    if (typeof r[key] !== 'string' || r[key] === '') throw new Error(`app_rules_invalid: ${key}`);
  }
  const rules = {} as Record<string, unknown>;
  for (const key of [...INTEGER_RULES, ...BOOLEAN_RULES, ...LABEL_RULES] as const) rules[key] = r[key];
  return rules as AppRules;
}

/** The rules now, from the database (service role: public.app_rules_now()). */
export async function loadRules(db: Db): Promise<AppRules> {
  return parseRules(await rpc<unknown>(db, 'app_rules_now'));
}

/** "€0.80": integer cents, as players read them. */
export function euros(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('euros takes integer cents');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}€${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 6 -> "6 hours", 1 -> "1 hour". */
export function hours(n: number): string {
  return n === 1 ? '1 hour' : `${n} hours`;
}

/** 15 -> "15 minutes", 60 -> "1 hour", 120 -> "2 hours". */
export function minutes(n: number): string {
  if (n > 0 && n % 60 === 0) return hours(n / 60);
  return n === 1 ? '1 minute' : `${n} minutes`;
}

/** 7 -> "7 days", 1 -> "1 day". */
export function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

/** 12 -> "12 months", 1 -> "1 month". */
export function months(n: number): string {
  return n === 1 ? '1 month' : `${n} months`;
}
