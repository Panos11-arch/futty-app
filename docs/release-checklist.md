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

## 1b. Production deploy: the migrations

Production last had migrations pushed before the P5b / P8 / P6 / P13 work, so one `supabase db push` now applies everything merged since. P13 (#64, #73) has no migrations.

**What production hasn't got, by PR (22 files, in file order within each PR):**

- **#60, P5a + P5b:** `20261112220000_pay_quote_guarantee_held`
- **#67, P6a:** `20261113220547_pay_dashboard_ledger`, `20261113220553_pay_dashboard_counter`, `20261113220558_pay_dashboard_conditions`, `20261113220603_pay_dashboard_reads`, `20261113223420_pay_dashboard_guards`
- **#72, P6b + P6c:** `20261113235757_pay_dashboard_debt_cash` (runs the backfill, below), `20261113235802_pay_dashboard_revenue`, `20261113235806_pay_dashboard_people`
- **#75, P5c + P8:** `20261113115749_pay_gipedo_mode`, `20261113115752_pay_gipedo_opposition`, `20261113115755_pay_gipedo_settle`, `20261113130016_pay_gipedo_review_fixes`, `20261113185144_pay_gipedo_followups`, `20261115170000_pay_gipedo_dashboard_merge`
- **#77, P10:** `20261115190000_pay_app_rules`
- **#79, P12:** `20261116124400_pay_switching`, `20261116134544_pay_cash_top_ups`
- **#81, P4d:** `20261116144007_pay_payouts_tables`, `20261116144010_pay_payouts_functions`, `20261116151505_pay_payouts_live`
- **#85, P7:** `20261116194830_pay_release`

Note: **P8's migrations are dated 13 November 11:57–18:51, before P6a's (13 November 22:05 onwards)**, although P8 was merged a day later. So in file order the first five P8 files run before P6a's. Not yet merged, so not in this list: P6d (#84), P11 (#83), A8 (#86). If any of them merges before the push, its migrations are added too.

**Before pushing: the P6b backfill.** `20261113235757_pay_dashboard_debt_cash` writes one `debt_cash_received` ledger row for every debt a venue has already marked settled. In the SQL editor, count them first:

```sql
select count(*) as debts, coalesce(sum(amount_cents), 0) as total_cents
from public.venue_debts
where owed_to = 'venue' and settled_by = 'venue' and settled_at is not null;
```

- [ ] Note the two numbers. After the push, this must give the same count:
  ```sql
  select count(*) from public.money_ledger
  where kind = 'debt_cash_received' and reason = 'debt_settled_at_venue';
  ```

**The push:**

- [ ] `supabase db push --dry-run`. It lists what it would apply, without applying anything. Check it is exactly the list above, and nothing else.
  - If instead it stops with "Found local migration files to be inserted before the last migration on remote database", that is the P8 dating above: production already has a migration dated later than P8's. Run `supabase db push --dry-run --include-all` and check that list instead.
- [ ] `supabase db push --include-all`. Without `--include-all` the CLI refuses any migration dated before the newest one production already has, which is P8's case. With it, every missing file is applied, in file order. If nothing is out of order it changes nothing.
- [ ] Run the backfill check above.

**After pushing: switch on the old `settle-gipedo-pano` schedule.** It settles Gipedo Pano bookings chosen on the squad post before P8 (spec 13). New bookings settle inside `run-payment-jobs` and don't need it. It has no schedule in production yet.

- [ ] `supabase functions list`: if `settle-gipedo-pano` isn't there, `supabase functions deploy settle-gipedo-pano --no-verify-jwt`. It uses the existing `CRON_SECRET` and `STRIPE_SECRET_KEY`.
- [ ] Open `supabase/legacy/settle-gipedo-pano-cron.sql`, paste it into the SQL editor, replace `<CRON_SECRET>` with production's `CRON_SECRET`, and run it. Never commit the filled-in copy. It schedules `settle-gipedo-pano-payments` every 10 minutes and is safe to run again.
- [ ] Check it is on:
  ```sql
  select jobname, schedule, active from cron.job where jobname = 'settle-gipedo-pano-payments';
  ```
- [ ] After 10 minutes, check it ran:
  ```sql
  select status, return_message, start_time from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'settle-gipedo-pano-payments')
  order by start_time desc limit 3;
  ```

## 2. Production steps from PRs #77 to #81, in order

Their migrations go out in section 1b's single push; the checks and the other steps stay here.

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
- [ ] Cron (P6e venue notifications): `select cron.schedule('venue-notifications', '*/5 * * * *', $$ select public.venue_notifications_tick() $$);` Plain SQL, no Edge Function and no secret. It sends new-booking, cancellation and short-game notices, and the 20:00 Cyprus daily summary; running it more often never sends twice.

## 3. This PR (P7)

- [ ] Migration `20261116194830_pay_release.sql` (`venues.signed_at`, `release_unlive_unsigned()`, `release_check()`).
- [ ] `supabase functions deploy futty-ai-chat` (Team Premium is no longer offered in its answers).

## 3a. Weather (P11, PR #83)

Nothing shows a forecast until every step here is done, including the venue coordinates.

- [ ] **Apple Developer → Certificates, Identifiers & Profiles**, create exactly two things:
  1. **Identifiers → + → Services IDs:** a Services ID for WeatherKit, e.g. `app.futty.weather`. Note the identifier. (Also check the app's App ID has WeatherKit ticked under Capabilities and App Services.)
  2. **Keys → +:** a new key with **WeatherKit** enabled. Download the `.p8` (Apple lets you download it once; keep it in the password manager, never in the repo) and note its **Key ID**.
- [ ] **The four Edge Function secrets**, on the production project:
  ```
  supabase secrets set \
    APPLE_TEAM_ID=<Team ID> \
    WEATHERKIT_KEY_ID=<Key ID of the WeatherKit key> \
    WEATHERKIT_SERVICE_ID=<the Services ID, e.g. app.futty.weather> \
    WEATHERKIT_PRIVATE_KEY="$(cat AuthKey_<KeyID>.p8)"
  ```
  `APPLE_TEAM_ID` is the same one `delete-account` uses (`docs/p13-provider-setup.md` section 6); if it's already set, `supabase secrets list` shows it and setting it again to the same value does no harm. `WEATHERKIT_PRIVATE_KEY` is the whole `.p8`, BEGIN and END lines included.
- [ ] Migration `20261117090000_pay_weather.sql` (`venues.latitude/longitude`, `app_rules.weather_nudge_hours`, `weather_cache`, `venue_weather_slots`).
- [ ] `supabase functions deploy venue-weather`, then `supabase functions deploy futty-ai-chat` (its weather lines).
- [ ] **Venue coordinates (Panos, by hand).** Every venue starts with `latitude` and `longitude` empty, and the app never sets them. For every signed venue (do this once section 4 has set `signed_at`): open its Google Maps link, right-click the venue's pin and click the numbers at the top of the menu to copy them (`34.6841, 33.0379`: latitude first, then longitude). Then in the SQL editor:
  ```sql
  update public.venues set latitude = <latitude>, longitude = <longitude> where id = '<venue id>';
  ```
  Both or neither (the database refuses one without the other). Check: `select name from public.venues where signed_at is not null and latitude is null;` returns no rows.
- [ ] **First live call** (also review item 4 on PR #83, on a dev build): open a signed venue's page from Book for a time in the next few days. Expect the forecast strip with Apple's Weather mark and the Data sources link. Nothing shown: check the `venue-weather` logs; a 401 from Apple means the Key ID, Services ID, Team ID or private key is wrong.

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

- [ ] Every step in `docs/p13-provider-setup.md`, sections 1 to 9, in the production project: the Apple key and App ID, the Supabase Apple and Google providers, the Google consent screen (with the privacy policy link https://futty.app/privacy and the terms link https://futty.app/terms), the redirect URLs, the `delete-account` secrets for revoking Apple tokens, and identity linking.
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

- [ ] **Website:** `site/` is the website, plain HTML and CSS with no build step. Host it at https://futty.app so that https://futty.app/privacy, https://futty.app/terms and https://futty.app/support work.
- [ ] **Privacy policy URL:** enter https://futty.app/privacy in App Store Connect (App Information). It must say what the app's own screen (`app/account/privacy-policy.tsx`) says; `tests/site/site-matches-app.test.tsx` fails if `site/privacy/index.html` drifts from it. Check it covers Stripe (payments), Sentry (crash reports), contact matching (phone numbers are sent to find friends on Futty), calendar, push notifications and the Futty AI.
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

- [ ] **Terms of Use URL:** https://futty.app/terms, in App Store Connect wherever the Premium subscription asks for the terms (the License Agreement or the app description). `site/terms/index.html` shows the terms with spec 13's default amounts; `tests/site/site-matches-app.test.tsx` fails if it drifts from the app's Terms of Use screen with those amounts. If production's `app_rules` ever differ from the defaults, the website has to be updated by hand: the test can't see production.
- [ ] **Support URL:** https://futty.app/support, in App Store Connect (the version's Support URL).
- [ ] **Founders: read the new wording** in `lib/terms.ts` (shown in the app under Account → Terms of Use) before release. It is written from spec 13 and spells out the debt block across all venues and the credit rules, as spec 13's legal check asks. Legal advice on venue credit (decisions doc #16) is still open.

## 12. App Review risks

- **Payments (3.1.1 and 3.1.5(a)):** pitch bookings are a real-world service used outside the app, so they are paid by card through Stripe; Premium is a digital feature, sold only through in-app purchase. Nothing in the app may link to buying Premium outside the App Store.
- **Gipedo Pano (5.3):** "the losing team pays for the pitch" could be read as wagering. It's a way of splitting the pitch fee: no prize, nobody receives money from another team. Say so in the notes if asked.
- **Premium's perks (3.1.2, 2.3.1):** the Premium screen lists only perks that exist ("Priority evening slots (coming soon)" was removed in P7). Keep it that way: no "coming soon" perk on a subscription.
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
