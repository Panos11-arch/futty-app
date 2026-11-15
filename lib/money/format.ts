// Display helpers for amounts the server returns. The app never computes a
// price, fee or total (docs/specs/13-payments-bookings.md, "Server-side
// checks"): every amount here comes from Futty's server, in integer cents,
// and is only formatted for the screen. The money maths itself is in
// supabase/migrations/*_pay_modes_money.sql and
// supabase/functions/_shared/money.ts.

// Sign and digits, worked out on whole cents (no floating point).
function euroParts(cents: number) {
  const abs = Math.abs(cents);
  return { sign: cents < 0 ? '-' : '', digits: `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}` };
}

/** 680 -> '€6.80'. Integer cents only. */
export function formatEuros(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('formatEuros takes integer cents');
  const { sign, digits } = euroParts(cents);
  return `${sign}€${digits}`;
}

/** 680 -> '6.80', -600 -> '-6.00': euros with two decimals and no symbol,
 *  for a CSV a spreadsheet reads as numbers. Integer cents only. */
export function formatEurosPlain(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('formatEurosPlain takes integer cents');
  const { sign, digits } = euroParts(cents);
  return `${sign}${digits}`;
}

// Up to 5 euro digits, then optionally a point or comma and 1-2 cent digits.
const EURO_INPUT = /^€?\s*(\d{1,5})(?:[.,](\d{1,2}))?$/;

/** '6,50' -> 650: what staff type as a walk-in or phone booking's price
 *  (spec 13, "Venue dashboard": staff may change the venue's price; that
 *  money never goes through Futty). Read from the digits as whole cents,
 *  never through a floating-point number. Null when it isn't an amount. */
export function parseEurosInput(text: string): number | null {
  const match = EURO_INPUT.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** How a share is paid, from create-share-payment's response: what goes on
 *  the card now and what's paid in cash at the venue (null when nothing). */
export function describeSharePayment({ amountCents, cashCents }: { amountCents: number; cashCents: number }) {
  return {
    byCard: amountCents > 0 ? formatEuros(amountCents) : null,
    inCash: cashCents > 0 ? formatEuros(cashCents) : null,
  };
}
