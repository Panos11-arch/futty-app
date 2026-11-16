// The venue dashboard's Payouts screen (P4d; docs/specs/05-product.md
// section 12 item 10, 13 "Payouts"): Stripe Connect onboarding and its
// status, the list of payouts, and what each booking paid. Everything comes
// from the server (venue_payouts_overview, venue_payout_bookings) and the
// connect-onboarding Edge Function; this file only puts it into words. It
// never adds or works out an amount.
import * as WebBrowser from 'expo-web-browser';

import type { Status } from '@/components/ui/status-pill';
import { describeFunctionError } from '@/lib/edge-functions';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';

export type AccountStatus = 'not_started' | 'in_progress' | 'needs_information' | 'ready' | 'disconnected';
export type PayoutStatus = 'pending' | 'sent' | 'reversed';

export type PayoutRow = {
  id: string;
  booking_id: string;
  label: string;
  amount_cents: number;
  status: PayoutStatus;
  created_at: string;
  sent_at: string | null;
  bookings: number;
  /** Waiting for card payments to clear in Stripe (Futty's available balance). */
  waiting?: boolean;
};

/** A booking from before Futty payouts started at the venue: never sent. */
export type BeforePayoutsRow = { booking_id: string; label: string; venue_cents: number };

export type PayoutsOverview = {
  account: { status: AccountStatus; venue_live: boolean; requirements_due: number };
  /** When Futty payouts started at the venue; null while they haven't. */
  payouts_from: string | null;
  can_receive: boolean;
  ready_cents: number;
  owed_to_futty_cents: number;
  /** Payouts made but not yet sent; waiting_for_balance_cents of them wait
   *  for card payments to clear in Stripe. */
  sending_cents: number;
  waiting_for_balance_cents: number;
  payouts: PayoutRow[];
  before_payouts: BeforePayoutsRow[];
};

export type BookingMoney = {
  booking_id: string;
  label: string;
  status: string;
  ready: boolean;
  /** Created before Futty payouts started at the venue: never sent. */
  before_payouts?: boolean;
  taken_cents: number;
  refunded_cents: number;
  futty_cents: number;
  stripe_fee_cents: number;
  owed_to_futty_cents: number;
  paid_at_venue_cents: number;
  venue_cents: number;
  transferred_cents: number;
  credit_held_cents: number;
  /** Only in a payout's detail: what that payout sent for the booking. */
  this_payout_cents?: number;
};

export type PayoutDetail = {
  id: string;
  amount_cents: number;
  status: PayoutStatus;
  created_at: string;
  sent_at: string | null;
  bookings: BookingMoney[];
};

// ---- Loading ------------------------------------------------------------

export function fetchPayoutsOverview(venueId: string) {
  return supabase.rpc('venue_payouts_overview', { p_venue_id: venueId });
}

export function fetchPayoutDetail(venueId: string, payoutId: string) {
  return supabase.rpc('venue_payout_bookings', { p_venue_id: venueId, p_payout_id: payoutId });
}

/** Where Stripe sends the browser back: connect-return opens this. */
export const STRIPE_RETURN_URL = 'futtyapp://venue-payouts';

export type StripeAction = 'onboard' | 'dashboard';
export type StripeDeps = {
  invoke: (body: { venueId: string; action: StripeAction }) => Promise<{ data: unknown; error: unknown }>;
  openAuthSession: (url: string, returnUrl: string) => Promise<unknown>;
  errorCode: (error: unknown) => Promise<string>;
};

const defaultStripeDeps: StripeDeps = {
  invoke: (body) => supabase.functions.invoke('connect-onboarding', { body }),
  openAuthSession: (url, returnUrl) => WebBrowser.openAuthSessionAsync(url, returnUrl),
  errorCode: describeFunctionError,
};

/** Opens Stripe's onboarding, or the venue's Express dashboard. Resolves to
 *  null once the browser closes (the screen then reloads the server's
 *  state), or the message to show. */
export async function openStripe(
  venueId: string,
  action: StripeAction,
  deps: StripeDeps = defaultStripeDeps,
): Promise<string | null> {
  const { data, error } = await deps.invoke({ venueId, action });
  const url = (data as { url?: unknown } | null)?.url;
  if (error || typeof url !== 'string') {
    return describePayoutError(error ? await deps.errorCode(error) : '');
  }
  await deps.openAuthSession(url, STRIPE_RETURN_URL);
  return null;
}

export function describePayoutError(code: string): string {
  switch (code) {
    case 'not_venue_staff':
      return "Only the venue's owner can see its payouts.";
    case 'venue_not_found':
      return 'This venue could not be found.';
    case 'not_onboarded':
      return 'Set up payouts first.';
    case 'payout_not_found':
      return 'That payout could not be found.';
    case 'stripe_unavailable':
      return "Stripe didn't answer. Try again in a minute.";
    default:
      return "Payouts couldn't be loaded. Try again.";
  }
}

// ---- The account --------------------------------------------------------

export type AccountWords = {
  title: string;
  body: string;
  /** The button, and what it opens; null for none. */
  action: { label: string; kind: StripeAction } | null;
  tone: 'info' | 'warning' | 'danger';
};

/** The Stripe account's state in plain words, with the one thing to do.
 *  payoutsFrom: when Futty payouts started at the venue (null: not yet). */
export function accountWords(account: PayoutsOverview['account'], payoutsFrom: string | null): AccountWords {
  switch (account.status) {
    case 'not_started':
      return {
        title: 'Set up payouts',
        body: 'Futty sends your pitch money to your bank through Stripe. Setting up takes a few minutes: your business details and your bank account.',
        action: { label: 'Set up payouts', kind: 'onboard' },
        tone: 'info',
      };
    case 'in_progress':
      return {
        title: 'Finish setting up payouts',
        body: "Stripe still needs a few details before it can send you money. Your money waits here until then; nothing is lost.",
        action: { label: 'Finish setup', kind: 'onboard' },
        tone: 'warning',
      };
    case 'needs_information':
      return {
        title: 'Stripe needs more information',
        body:
          account.requirements_due === 1
            ? 'Stripe needs one more detail before it can send you money.'
            : `Stripe needs ${account.requirements_due} more details before it can send you money.`,
        action: { label: 'Update details', kind: 'onboard' },
        tone: 'warning',
      };
    case 'disconnected':
      return {
        title: 'Payouts are disconnected',
        body: 'Your Stripe account was disconnected from Futty, so no money can be sent. Contact Futty to connect it again.',
        action: null,
        tone: 'danger',
      };
    default:
      return account.venue_live && payoutsFrom
        ? {
            title: 'Payouts are on',
            body: "Each booking's money is sent to your Stripe account once it's final, after the match's collection, and once the players' card payments have cleared in Stripe. Stripe then pays it into your bank.",
            action: { label: 'Open Stripe dashboard', kind: 'dashboard' },
            tone: 'info',
          }
        : {
            title: 'Payouts start when your venue is live',
            body: 'Your Stripe account is ready. Futty starts sending money once your venue is live with real payments.',
            action: { label: 'Open Stripe dashboard', kind: 'dashboard' },
            tone: 'info',
          };
  }
}

/** The money not yet sent, in words: on its way (or waiting for card
 *  payments to clear in Stripe), waiting for setup, or owed to Futty (taken
 *  off the next payout, never charged). */
export function balanceWords(overview: PayoutsOverview): string[] {
  const words: string[] = [];
  if (overview.sending_cents > 0) words.push(`${formatEuros(overview.sending_cents)} is on its way to your Stripe account.`);
  if (overview.waiting_for_balance_cents > 0) {
    words.push(
      `${formatEuros(overview.waiting_for_balance_cents)} of it is waiting for players' card payments to clear in Stripe. It's sent as soon as they have.`,
    );
  }
  if (overview.ready_cents > 0) {
    words.push(
      overview.can_receive
        ? `${formatEuros(overview.ready_cents)} goes in your next payout, once players' card payments have cleared in Stripe.`
        : `${formatEuros(overview.ready_cents)} is waiting for payouts to start at your venue.`,
    );
  }
  if (overview.owed_to_futty_cents > 0) {
    words.push(
      `You owe Futty ${formatEuros(overview.owed_to_futty_cents)} (for example Stripe's fee on a booking you cancelled). It comes off your next payout.`,
    );
  }
  return words;
}

// ---- Payouts and bookings -----------------------------------------------

const PAYOUT_PILL: Record<PayoutStatus, { pill: Status; words: string }> = {
  pending: { pill: 'pending', words: 'Being sent' },
  sent: { pill: 'paid', words: 'Sent to Stripe' },
  reversed: { pill: 'refunded', words: 'Reversed' },
};

/** A payout's state; a pending one may be waiting for card payments to
 *  clear in Stripe. */
export function payoutStatus(status: PayoutStatus, waiting = false) {
  if (status === 'pending' && waiting) return { pill: 'pending' as Status, words: 'Waiting for card payments to clear' };
  return PAYOUT_PILL[status];
}

/** A booking from before Futty payouts started: its money was never sent
 *  through Futty. */
export function beforePayoutsWords(row: BeforePayoutsRow): { title: string; subtitle: string; amount: string } {
  return { title: row.label, subtitle: 'Before Futty payouts: not sent through Futty', amount: formatEuros(row.venue_cents) };
}

/** "Mon 16 Nov, 12:00", in Cyprus. */
export function cyprusWhen(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Nicosia' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Nicosia' });
  return `${day}, ${time}`;
}

export function payoutRowWords(row: PayoutRow): { title: string; subtitle: string; amount: string } {
  const others = row.bookings - 1;
  return {
    title: row.label,
    subtitle: [
      cyprusWhen(row.sent_at ?? row.created_at),
      others > 0 ? `and ${others} earlier ${others === 1 ? 'booking' : 'bookings'}` : null,
    ].filter(Boolean).join(' · '),
    amount: formatEuros(row.amount_cents),
  };
}

export type MoneyLine = { label: string; amount: string };

/** What one booking paid, line by line, from the server's amounts as they
 *  are. Each part is a plain fact (left out when there's nothing in it);
 *  only the venue's own money, and what has been sent of it, carry a sign
 *  (below zero: the venue owes it, and it comes off the next payout). */
export function bookingMoneyLines(money: BookingMoney): MoneyLine[] {
  const facts: [string, number][] = [
    ['Paid by players in the app', money.taken_cents],
    ['Given back to players', money.refunded_cents],
    ["Futty's service fee, after Stripe's fee", money.futty_cents],
    ["Stripe's fee", money.stripe_fee_cents],
    ['You owe Futty for this booking', money.owed_to_futty_cents],
    ['Paid to you at the venue (never sent)', money.paid_at_venue_cents],
    // Credit given on this booking is money you hold for those players;
    // credit spent on it was paid to you when it was given.
    ['Credit given to players (you hold it)', money.credit_held_cents],
    ['Paid with credit players held', -money.credit_held_cents],
  ];
  return [
    ...facts.filter(([, cents]) => cents > 0).map(([label, cents]) => ({ label, amount: formatEuros(cents) })),
    { label: 'Your money from the app', amount: formatEuros(money.venue_cents) },
    { label: 'Sent to you so far', amount: formatEuros(money.transferred_cents) },
  ];
}
