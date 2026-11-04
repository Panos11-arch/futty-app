/**
 * Apple Pay (iPhone) and Google Pay (Android, including Samsung phones)
 * shown at the top of every Stripe payment sheet, with the card form kept
 * underneath for anyone who hasn't set up either.
 *
 * Neither Apple nor Google charges the merchant anything for these — the
 * payment still goes through Stripe at the normal card rate.
 *
 * Apple Pay also needs (one-time, outside the code):
 *  1. A Merchant ID `merchant.com.panosalepis.futtyapp` in the Apple
 *     Developer portal (Certificates, Identifiers & Profiles > Identifiers).
 *  2. Stripe Dashboard > Settings > Payment methods > Apple Pay > add an iOS
 *     certificate for that Merchant ID (Stripe gives you the CSR to upload).
 *  3. A new EAS build — the Apple Pay entitlement comes from app.json.
 * Google Pay needs no setup beyond the `enableGooglePay` flag in app.json.
 */

export const APPLE_PAY_MERCHANT_ID = 'merchant.com.panosalepis.futtyapp';

export const walletPayOptions = {
  applePay: {
    merchantCountryCode: 'CY',
  },
  googlePay: {
    merchantCountryCode: 'CY',
    currencyCode: 'EUR',
    // Google Pay's test environment in dev builds, real one in store builds.
    testEnv: __DEV__,
  },
};
