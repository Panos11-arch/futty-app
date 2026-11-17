# Release checklist (P7)

What has to happen before the first App Store submission, in order. Only Panos changes production; every step that touches production is his. The code part of P7 is in this repo: `supabase/migrations/20261116194830_pay_release.sql`, `scripts/release/`, the Team Premium flag (`lib/premium.ts`) and the terms (`lib/terms.ts`).

Decided 16 November: there is no hidden test venue and no pre-made booking for Apple's reviewer. The reviewer signs in with a demo account and books at a real, signed venue as far as the payment screen. `release_check` proves that works before each submission.

## 1. Back up production first

- [ ] In the Supabase dashboard (Database → Backups), check that the latest daily backup is there and recent.
- [ ] Take your own copy as well, outside the repo:
  ```
  supabase db dump --linked -f ../futty-backups/<date>-schema.sql
  supabase db dump --linked --data-only -f ../futty-backups/<date>-data.sql
  ```
- [ ] Nothing below starts until both are there.

## 2. Production steps from PRs #77 to #81, in order

Apply each migration with `supabase db push` (it applies the ones production hasn't got, in file order), or one at a time in the SQL editor in this order.

**#77, P10 server (`app_rules`)**
- [ ] Migration `20261115190000_pay_app_rules.sql`.
- [ ] Check: `select * from public.app_rules;` gives spec 13's numbers (80 / 55 / 0 / 55, 7 / 14 days, 60 min, 100, 6 h, 48 h, 15 min, 72 h / 6 h, 2 h, 12 months, 5 days / 24 h, €3.99).

**#78, P10 app (Futty AI reads `app_rules`)**
- [ ] `supabase functions deploy futty-ai-chat`. It needs #77's migration first: with no rules it refuses to answer. (#80 and this PR change the same function; one deploy after section 3 covers all three, but deploying now does no harm.)

**#79, P12 server (switching 5 v 5 / 6 v 6)**
- [ ] Migration `20261116124400_pay_switching.sql`.
- [ ] Migration `20261116134544_pay_cash_top_ups.sql`.

**#80, P12 app**
- [ ] No server step apart from `futty-ai-chat` (above).

**#81, P4d payouts (Stripe Connect)**
- [ ] Migrations `20261116144007_pay_payouts_tables.sql`, `20261116144010_pay_payouts_functions.sql` and `20261116151505_pay_payouts_live.sql` (three, not the two in the PR description: the review fixes added the third).
- [ ] Stripe, in test mode first and then again in live mode (the full list is in PR #81):
  1. Connect → Get started: platform (marketplace), country Cyprus, platform profile completed.
  2. Connect settings → Account types: Express on.
  3. Connect settings → Branding: name, icon, colour.
  4. Connect settings: the platform is responsible for fees and negative balances; Express payout schedule on Stripe's default.
  5. Express dashboard left on.
  6. Webhooks, the existing `stripe-webhook` endpoint: add `transfer.created` and `transfer.reversed`.
  7. Webhooks → Add endpoint, same URL, "Listen to events on Connected accounts": `account.updated`, `account.application.deauthorized`. Then `supabase secrets set STRIPE_CONNECT_WEBHOOK_SECRET=whsec_…`.
- [ ] Deploy:
  ```
  supabase functions deploy run-payouts --no-verify-jwt
  supabase functions deploy reconcile-money --no-verify-jwt
  supabase functions deploy connect-onboarding
  supabase functions deploy connect-return --no-verify-jwt
  supabase functions deploy stripe-webhook --no-verify-jwt
  ```
- [ ] Cron: `run-payouts` every 5 minutes and `reconcile-money` daily at 04:00. The exact `cron.schedule` SQL is at the top of each function's `index.ts`.

## 3. This PR (P7)

- [ ] Migration `20261116194830_pay_release.sql` (`venues.signed_at`, `release_unlive_unsigned()`, `release_check()`).
- [ ] `supabase functions deploy futty-ai-chat` (Team Premium is no longer offered in its answers).

## 4. Each venue: `signed_at` and `payouts_from`

Both are set only as `service_role` or in the SQL editor; a signed-in session is refused.

- [ ] For every venue that has signed with Futty, its signing date:
  ```sql
  update public.venues set signed_at = '<date signed>' where id = '<venue id>';
  ```
- [ ] Switch off every venue that hasn't signed (spec 05 section 12):
  ```
  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… node scripts/release/run.mjs unlive-unsigned --allow-remote
  ```
- [ ] `payouts_from` stays empty until the venue has onboarded again **on live keys** (spec 13, "Payouts"). Then:
  ```sql
  update public.venues set payouts_from = now() where id = '<venue id>';
  ```
  Bookings made before it never transfer.

## 5. Sign in with Apple and Google (P13)

- [ ] Every step in `docs/p13-provider-setup.md`, sections 1 to 9, in the production project: the Apple key and App ID, the Supabase Apple and Google providers, the Google consent screen (with the privacy policy and terms links), the redirect URLs, the `delete-account` secrets for revoking Apple tokens, and identity linking.
- [ ] Calendar reminder for the Apple client secret (it expires after at most 6 months), if a Services ID was made.

## 6. The demo account

- [ ] Choose a password (12 characters or more), keep it in the password manager and never in the repo:
  ```
  FUTTY_DEMO_PASSWORD=… SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
    node scripts/release/run.mjs demo-account --allow-remote
  ```
  It creates `review@futty.app` (confirmed, username `futty_review`), or resets its password if it exists.
- [ ] Before every submission:
  ```
  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… node scripts/release/run.mjs check --allow-remote
  ```
  It must print `Ready: …`. Otherwise it lists each problem: an unsigned venue that is live, no signed venue, no demo account, or no checkout quote for the demo account at a signed venue in the next 7 days.

## 7. App Store Connect: the Premium product

- [ ] Features → **Subscriptions** (not In-App Purchases): the auto-renewable subscription `premium_monthly_v2`, in a subscription group, at the €3.99 price (Cyprus and the euro storefronts), with its display name, description and review screenshot. `premium_monthly` is a stuck non-consumable: don't use it.
- [ ] The first subscription is submitted together with the app version: add it under the version's "In-App Purchases and Subscriptions".
- [ ] `app_rules.premium_price_label` is `€3.99`. The app shows the store's own price and falls back to that label.
- [ ] Team Premium (`team_premium_9aside`, `team_premium_11aside`) is **not** submitted: it is off in this build (`TEAM_PREMIUM_ENABLED = false`); 9-a-side and 11-a-side leagues say "coming soon".

## 8. Build and TestFlight

- [ ] App display name: `app.json` `expo.name` is still `futty-app`, which is the name under the icon. Change it to `Futty` in its own small PR first (shared file). It needs a new build, which this is.
- [ ] `eas build --profile production --platform ios`, then `eas submit --platform ios`.
- [ ] On the TestFlight build:
  - [ ] **Account deletion, again on this build**, for an email account, a Sign in with Apple account (afterwards Futty is gone from Settings → Apple ID → Sign in with Apple, so the token was revoked) and a Google account. The account can't sign in afterwards.
  - [ ] Sign in with Apple and with Google.
  - [ ] Premium shows the store's price (sandbox) and the 7 / 14-day windows; buy and restore in the sandbox.
  - [ ] No Team Premium anywhere (Home, Premium, Team tab); 9-a-side and 11-a-side leagues say "coming soon".
  - [ ] Terms of Use show spec 13's amounts.
  - [ ] As `review@futty.app`: book at a signed venue as far as the payment screen.

## 9. Privacy

- [ ] **Privacy policy URL:** host `docs/privacy-policy.html` at a public URL and enter it in App Store Connect (App Information). It must say what the app's own screen (`app/account/privacy-policy.tsx`) says. Check it covers Stripe (payments), Sentry (crash reports), contact matching (phone numbers are sent to find friends on Futty), calendar, push notifications and the Futty AI.
- [ ] **App Privacy answers** (draft to check against the code; "linked to the user" unless noted):
  - Contact info: name, email address, phone number.
  - Contacts: phone numbers from the address book, only when the user allows it, used to find friends on Futty.
  - User content: squad posts, chat messages, profile photo.
  - Identifiers: user ID.
  - Purchases: purchase history (bookings, Premium).
  - Financial info: payment cards are taken by Stripe and Futty stores only Stripe's references; check Apple's wording for "Payment info" collected by a payment processor.
  - Diagnostics: crash data (Sentry), not linked to the user if Sentry has no user id attached; check.
  - No tracking; no location (the app asks for no location permission).

## 10. Before live Stripe keys

- [ ] **Card disputes: decide first.** Spec 13 has no rule for a chargeback. With separate charges and transfers, every payment is on Futty's Stripe account, so a disputed payment and Stripe's dispute fee come out of Futty's balance unless decided otherwise. To decide and write into spec 13: who bears the disputed amount and the fee (Futty, or the venue through its next transfer), who answers the dispute with evidence, and what happens to the player (a debt?). No live keys until it is decided.
- [ ] The switch to live keys is its own production step (spec 13, "Payouts"); venues onboard again on live keys before their `payouts_from` is set.

## 11. Terms of Use

- [ ] **Founders: read the new wording** in `lib/terms.ts` (shown in the app under Account → Terms of Use) before release. It is written from spec 13 and spells out the debt block across all venues and the credit rules, as spec 13's legal check asks. Legal advice on venue credit (decisions doc #16) is still open.

## 12. App Review risks

- **Payments (3.1.1 and 3.1.5(a)):** pitch bookings are a real-world service used outside the app, so they are paid by card through Stripe; Premium is a digital feature, sold only through in-app purchase. Nothing in the app may link to buying Premium outside the App Store.
- **Gipedo Pano (5.3):** "the losing team pays for the pitch" could be read as wagering. It's a way of splitting the pitch fee: no prize, nobody receives money from another team. Say so in the notes if asked.
- **Premium's perks (3.1.2, 2.3.1):** the Premium screen lists "Priority evening slots (coming soon)". Selling a subscription with a feature that doesn't exist yet is a rejection risk: consider removing that line before submitting.
- **Account deletion (5.1.1(v)):** in the app, for every sign-in method, with the Apple token revoked (section 8).
- **Sign in with Apple (4.8):** required because Google sign-in is offered; it must be as prominent as Google's button.
- **Location wording:** the app asks for no location permission, so the App Store description and screenshots mustn't promise "pitches near you" or anything that sounds like location tracking. Directions opens Maps.
- **Permissions (5.1.1):** contacts, calendar and Face ID each have a purpose string and are asked only when used; the app works when they are refused.
- **User content (1.2):** squad posts and chat have reporting and blocking (Community tab; report in fixture chat).
- **A demo account that can't book (2.1):** `release_check` (section 6) before every submission.
- **Unfinished features (2.1, 2.3):** Team Premium is hidden; check no other "coming soon" sells something.

## 13. App Review notes

Paste into App Store Connect → App Review Information → Notes, with the demo login in the sign-in fields:

> **Demo account:** review@futty.app, password: (from the password manager).
>
> Futty books five-a-side football pitches at real venues in Cyprus. Pitch bookings are a physical service used at the venue, outside the app, so they are paid by card through Stripe under guideline 3.1.5(a). Futty Premium, a digital feature, is sold only through in-app purchase.
>
> You can go as far as the payment screen: Book → choose a day and a venue → choose a slot → choose how to pay. Completing payment books a real pitch at a real venue, so please stop at the payment screen. The attached screen recording shows the rest: paying, the booking, inviting players, cancelling, and deleting the account.
>
> If you do pay, we refund the payment in full straight away; just email us at the contact address.

- [ ] Record the screen recording on the TestFlight build (booking through payment, the booking detail, cancelling, account deletion, Premium in the sandbox) and attach it under App Review Information.
- [ ] `node scripts/release/run.mjs check --allow-remote` prints `Ready` on the day of submission.
