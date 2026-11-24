// Shared helper for calling Apple's App Store Server API directly — used by
// both verify-purchase (initial purchase) and
// apple-server-notifications (renewal/cancellation/refund webhook). Neither
// function trusts client- or webhook-supplied purchase data on its own; both
// end up here to ask Apple's own server what a transaction's real, current
// state is.
//
// Uses `jose` (WebCrypto-native) rather than Apple's own
// @apple/app-store-server-library — that library depends on Node's
// crypto.createPrivateKey, which Deno's Node-compat shim reports as curve
// "p256" instead of "prime256v1", breaking its ES256 signing/verification in
// Supabase Edge Functions (github.com/denoland/deno/issues/22879, unresolved
// as of writing). jose talks to WebCrypto directly and doesn't go through
// that codepath.

import { decodeJwt, importPKCS8, SignJWT } from 'npm:jose@5';

import { type SubscriptionState, subscriptionStateFrom } from './premium.ts';

const ASC_KEY_ID = Deno.env.get('ASC_KEY_ID')!;
const ASC_ISSUER_ID = Deno.env.get('ASC_ISSUER_ID')!;
const ASC_PRIVATE_KEY_PEM = Deno.env.get('ASC_PRIVATE_KEY')!;
export const APPLE_BUNDLE_ID = 'com.panosalepis.futtyapp';

// Production first, then sandbox — Apple's documented pattern. A sandbox
// transaction id fails against the production host (404, or 401 for an app
// with no real production transaction history yet — observed directly while
// testing), so falling back on any failure is what makes both sandbox
// testing and real purchases work through the same code path.
const APPLE_HOSTS = ['api.storekit.itunes.apple.com', 'api.storekit-sandbox.itunes.apple.com'];

async function signAppStoreConnectJwt() {
  const key = await importPKCS8(ASC_PRIVATE_KEY_PEM, 'ES256');
  return new SignJWT({ bid: APPLE_BUNDLE_ID })
    .setProtectedHeader({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })
    .setIssuer(ASC_ISSUER_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setAudience('appstoreconnect-v1')
    .sign(key);
}

export type AppleTransaction = {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
};

/** Confirms a raw transaction id (as handed to the app by expo-iap right
 *  after a purchase) is real and belongs to this app, and reads off its
 *  originalTransactionId — the stable id used everywhere else in this
 *  system. Deliberately does not treat this call's own expiresDate as the
 *  final word on "is this active"; for subscriptions use
 *  fetchAppleSubscriptionState, which is the endpoint Apple actually
 *  designed for that question. */
export async function fetchAppleTransaction(transactionId: string): Promise<AppleTransaction | null> {
  const jwt = await signAppStoreConnectJwt();

  for (const host of APPLE_HOSTS) {
    const res = await fetch(`https://${host}/inApps/v1/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    // Try the next host on ANY failure, not just 404 — production returns
    // 401 rather than 404 for an app with no real production transaction
    // history yet (e.g. still in sandbox-only testing), so bailing out
    // early on a non-404 would mean sandbox purchases could never verify.
    if (!res.ok) continue;

    const { signedTransactionInfo } = (await res.json()) as { signedTransactionInfo: string };
    // This call is already authenticated (our own signed JWT) over TLS to
    // Apple's real host, so the transport already gives the integrity
    // guarantee that matters here — decodeJwt reads the payload without
    // re-verifying Apple's own inner signature on top of that.
    return decodeJwt(signedTransactionInfo) as unknown as AppleTransaction;
  }

  return null;
}

/** The authoritative "what is this subscription now" check: Apple's Get
 *  All Subscription Statuses endpoint, keyed by originalTransactionId. It
 *  returns the product the subscription is on now (P1: after an upgrade or
 *  a downgrade within the "Futty Premium Monthly" group it is on another
 *  product with the same original transaction) and whether it's active (see
 *  subscriptionStateFrom in _shared/premium.ts).
 *
 *  Right after a purchase, this endpoint can briefly return an empty `data`
 *  array before Apple's backend finishes indexing the new transaction
 *  (observed directly: a real sandbox purchase came back with `{"data":[]}`
 *  a couple of seconds after completing). That is null here, and callers
 *  write nothing. Deliberately does NOT sleep-and-retry: Supabase's Edge
 *  Runtime kills a function that sits idle too long (observed directly: a
 *  4-attempt/2s-delay retry loop got killed mid-request with shutdown
 *  reason "EarlyDrop"). The app leaves the purchase transaction unfinished
 *  on an inactive result, so pressing buy again retries. */
export async function fetchAppleSubscriptionState(originalTransactionId: string): Promise<SubscriptionState | null> {
  const jwt = await signAppStoreConnectJwt();

  for (const host of APPLE_HOSTS) {
    const res = await fetch(`https://${host}/inApps/v1/subscriptions/${originalTransactionId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    // See the matching comment in fetchAppleTransaction above: try every
    // host before giving up, since production can 401 rather than 404.
    if (!res.ok) continue;

    const body = (await res.json()) as {
      data?: {
        lastTransactions?: { originalTransactionId: string; status: number; signedTransactionInfo: string }[];
      }[];
    };
    if (!body.data || body.data.length === 0) continue; // try the other host

    // This call is authenticated (our own signed JWT) over TLS to Apple's
    // real host, so decodeJwt reads the payload without re-verifying it.
    const groups = body.data.map((group) => ({
      lastTransactions: (group.lastTransactions ?? []).map((last) => ({
        originalTransactionId: last.originalTransactionId,
        status: last.status,
        info: decodeJwt(last.signedTransactionInfo) as { productId?: string; expiresDate?: number },
      })),
    }));
    return subscriptionStateFrom(groups, originalTransactionId);
  }

  // Neither host had any data at all: most likely still propagating.
  return null;
}

/** Decodes (WITHOUT cryptographic verification) an incoming App Store Server
 *  Notification's outer JWS just far enough to pull out an original
 *  transaction id — used only as an untrusted lookup key to know what to
 *  re-check. Never treat anything else in this payload (status, dates,
 *  notificationType, etc.) as trustworthy; the caller must re-confirm via
 *  fetchAppleSubscriptionState before changing anything. */
export function extractOriginalTransactionId(signedPayload: string): string | null {
  try {
    const outer = decodeJwt(signedPayload) as { data?: { signedTransactionInfo?: string } };
    const signedTransactionInfo = outer.data?.signedTransactionInfo;
    if (!signedTransactionInfo) return null;
    const inner = decodeJwt(signedTransactionInfo) as { originalTransactionId?: string };
    return inner.originalTransactionId ?? null;
  } catch {
    return null;
  }
}
