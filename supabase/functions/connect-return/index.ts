// Where Stripe's onboarding sends the venue's browser back (P4d): straight
// into the app's Payouts screen, which loads the account's state from the
// server. No data is read or written here. Deploy with --no-verify-jwt:
// Stripe's redirect carries no Supabase session.

import { returnToApp } from '../connect-onboarding/handler.ts';

Deno.serve((req) => returnToApp(new URL(req.url), 'futtyapp'));
