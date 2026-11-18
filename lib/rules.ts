// Spec 13's rules in the app (P10): every fee, booking window and time limit,
// from public.app_rules, the one source the database, the Edge Functions and
// the Futty AI read too. Nothing here has a default: the app never writes a
// rule's number itself.
//
// This file is pure (no network, no storage), so text helpers anywhere can
// use it. lib/use-rules.ts loads the rules, keeps the last good copy on the
// phone for offline use, and fills the copy here.
//
// When no rules have ever been loaded on this phone, a screen that shows a
// number shows a placeholder (spec 13, "Rules in one place"), and a sentence
// built with ruleText() uses its wording without the number. Never a guess.
import { formatEuros } from '@/lib/money/format';

/** One row of public.app_rules (supabase/migrations/*_pay_app_rules.sql). */
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
  weather_rain_chance_pct: number;
  weather_heavy_rain: boolean;
  weather_wind_kmh: number;
  weather_thunderstorms: boolean;
  weather_heat_c: number;
  /** Saved searches a player can keep (decided 18 November). */
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

/** The columns to read: exactly the rules, nothing else. */
export const RULE_COLUMNS = [...INTEGER_RULES, ...BOOLEAN_RULES, 'premium_price_label'].join(', ');

/** A complete, valid set of rules, or null. A broken row is never half-used. */
export function parseRules(row: unknown): AppRules | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  for (const key of INTEGER_RULES) if (!Number.isInteger(r[key])) return null;
  for (const key of BOOLEAN_RULES) if (typeof r[key] !== 'boolean') return null;
  if (typeof r.premium_price_label !== 'string' || r.premium_price_label === '') return null;
  const rules = {} as Record<string, unknown>;
  for (const key of [...INTEGER_RULES, ...BOOLEAN_RULES, 'premium_price_label'] as const) rules[key] = r[key];
  return rules as AppRules;
}

// ---- The copy in memory ----------------------------------------------------

let current: AppRules | null = null;
const listeners = new Set<(rules: AppRules) => void>();

/** The rules loaded on this phone, or null when none ever were. */
export function getCachedRules(): AppRules | null {
  return current;
}

/** Called by lib/use-rules.ts with rules it has checked; tests prime it too. */
export function setCachedRules(rules: AppRules | null): void {
  current = rules;
  if (rules) for (const listener of listeners) listener(rules);
}

/** Told whenever new rules arrive. Returns the unsubscribe function. */
export function onRulesChange(listener: (rules: AppRules) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A sentence with a rule's number in it: built from the rules when they're
 * loaded, otherwise the same sentence without the number. The fallback
 * must never contain a number of its own.
 */
export function ruleText(build: (rules: AppRules) => string, withoutNumber: string): string {
  return current ? build(current) : withoutNumber;
}

// ---- Words -----------------------------------------------------------------

const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** 6 -> "6 hours", 1 -> "1 hour". */
export function hoursText(n: number): string {
  return unit(n, 'hour', 'hours');
}

/** 15 -> "15 minutes"; whole hours read as hours: 60 -> "1 hour". */
export function minutesText(n: number): string {
  return n > 0 && n % 60 === 0 ? hoursText(n / 60) : unit(n, 'minute', 'minutes');
}

/** 7 -> "7 days", 1 -> "1 day". */
export function daysText(n: number): string {
  return unit(n, 'day', 'days');
}

/** 12 -> "12 months", 1 -> "1 month". */
export function monthsText(n: number): string {
  return unit(n, 'month', 'months');
}

/** Integer cents as players read them: 80 -> "€0.80". */
export function eurosText(cents: number): string {
  return formatEuros(cents);
}
