// Which Stripe mode a key is for (P4d): live keys start sk_live_, or
// rk_live_ for a restricted key. Payouts only go to Express accounts of the
// same mode, so test data never reaches a live account.
export function isLiveKey(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}
