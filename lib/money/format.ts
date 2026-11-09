// Display helpers for amounts the server returns. The app never computes a
// price, fee or total (docs/specs/13-payments-bookings.md, "Server-side
// checks"): every amount here comes from Futty's server, in integer cents,
// and is only formatted for the screen. The money maths itself is in
// supabase/migrations/*_pay_modes_money.sql and
// supabase/functions/_shared/money.ts.

/** 680 -> '€6.80'. Integer cents only. */
export function formatEuros(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('formatEuros takes integer cents');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}€${euros}.${rest}`;
}

/** How a share is paid, from create-share-payment's response: what goes on
 *  the card now and what's paid in cash at the venue (null when nothing). */
export function describeSharePayment({ amountCents, cashCents }: { amountCents: number; cashCents: number }) {
  return {
    byCard: amountCents > 0 ? formatEuros(amountCents) : null,
    inCash: cashCents > 0 ? formatEuros(cashCents) : null,
  };
}
