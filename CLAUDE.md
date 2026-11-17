@AGENTS.md

## Working rules

1. Specs. docs/specs/13-payments-bookings.md is the source of truth for money and bookings; docs/specs/15-design.md for UI. Where 03, 05 or 12 disagree with 13 or 15, 13 and 15 win. If a rule you need is missing or ambiguous, stop and ask. Never invent a business rule, an amount or a time limit.
2. Money. Integer cents only, never floating point. Every amount is computed on the server from venue data. The app only displays amounts the server returns, and never sends a price, fee, capacity or total that the server trusts.
3. Time. Every date and time rule uses Cyprus time (Asia/Nicosia). In SQL use (now() at time zone 'Asia/Nicosia'); in Edge Functions use supabase/functions/_shared/cyprus-time.ts. Never compare booking days or times against UTC.
4. Security. Every table has RLS. security definer functions set search_path = ''. Internal functions are revoked from public, anon and authenticated and granted to service_role only. Never trust ids, prices, capacities or statuses sent by the app; check the caller owns what they act on. No secrets in the app.
5. Stripe. Every Stripe call carries an idempotency key built from our row ids. Every money movement is written to the money ledger with its reason. Payment state changes come from verified webhooks, not from the app.
6. Tests. Every PR includes tests for the behaviour it changes: SQL tests in supabase/tests/*.test.sql, Deno tests next to Edge Functions (*.test.ts), Jest tests for lib/ and components/. Write the failing test first, then the code. Each worked example in spec 13 is a test with that exact amount. A PR without tests is not merged; CI must be green.
7. Scope. Only touch the files the prompt names. Shared files (package.json, app.json, app/_layout.tsx, app/(tabs)/_layout.tsx, lib/supabase.ts, constants/, components/ui/) change in their own small PR. A change to package.json or app.json that adds native code needs a new development build: say so in the PR.
8. Migrations. New files only (supabase migration new pay_<name> or match_<name>); never edit a merged migration.
9. Expo SDK 55. Read https://docs.expo.dev/versions/v55.0.0/ for any Expo API before using it.
10. UI. Screens use components/ui and the tokens in constants/futty-theme.ts only: no hard-coded colours, font sizes or emoji.

## Ownership

From 15 November the remaining prompts are split three ways (docs/specs/14-claude-code-prompts.md, "Split from 15 November"):

- **Panos**: P10, P12, P4d and P7, plus production (deploys, `supabase db push`, Edge Functions, schedules, Stripe webhook events, Apple and Google sign-in setup, development builds, App Store).
- **Dimitris**: the P5 screens, the P6 venue dashboard (including P6d and the payouts CSV), P8, P11, P13, A8, the P6 check-in QR, U4, U7 and U5.
- **Anghelo**: his A and U prompts (A4b, A5, A6, A7, U8) and the Home owed banner.

Only Panos changes production. Whoever runs a prompt works in the files that prompt names, even when the Ownership table below gives them to someone else, and asks that owner for a quick OK on the PR. Stacked PRs: never merge a PR into another branch; retarget it to master first.

| Area | Panos and Dimitris | Anghelo |
| :---- | :---- | :---- |
| Screens | `book.tsx`, `booking-payment.tsx`, `my-bookings.tsx`, `venue-dashboard.tsx`, `squads.tsx`, `join-squad-post.tsx`, `app/account/payments/`, `app/account/settings/`, `premium*`, venue pages | `app/(tabs)/*.tsx` except `_layout` (Home, team, leagues, profile, community), `fixture-*.tsx`, `previous-games.tsx`, `upcoming-fixtures.tsx`, `team-profile.tsx`, `player-profile.tsx`, `matchmaking.tsx`, `notifications.tsx`, match and stats screens |
| `lib/` | `booking*`, `payments.ts`, `service-fee.ts`, `wallet-pay.ts`, `account.ts`, `squads.ts`, `use-venues.ts`, `use-day-bookings.ts`, `use-my-bookings.ts`, `use-squad-posts.ts`, `premium.ts`, `rules.ts`, `use-owed.ts`, `lib/money/` | `fixtures.ts`, `leagues.ts`, `teams.ts`, `use-recent-results.ts`, `xp-tier.ts`, `notifications.ts`, `push-notifications.ts`, `community.ts`, `use-follows.ts`, `lib/match/`, `lib/stats/`, `lib/calendar/` |
| Components | `components/booking/` (U3 creates `next-game-card.tsx` as a placeholder; Dimitris owns it after that, as part of the P5 screens), `components/venue/` | `components/match/`, `components/stats/` |
| Edge Functions | payment, Stripe, Apple, cancellation, account, venue functions, `futty-ai-chat` | `notify-*`, reminder, WhatsApp and team-of-the-week jobs |
| Database | venues, pitches, bookings, payments, squad posts, profiles security, app rules, menu items | matches, match players, attendance, goals, votes, ratings, levels, stats, notifications, calendar |
| Release and CI | `app.json`, `eas.json`, `.github/`, builds, App Store | — |

## Testing

CI runs all three on every pull request.

| What | Command | Notes |
| :---- | :---- | :---- |
| App (Jest) | `npx jest` | Tests sit next to the code (`lib/service-fee.test.ts`). `lib/money/` must stay at 100% line coverage. |
| Edge Functions (Deno) | `deno test --node-modules-dir=none supabase/functions/` | Use `supabase/functions/_shared/stripe-fake.ts` instead of a real Stripe client. `_shared/money*` must stay at 100% line coverage (`_scripts/check-money-coverage.ts`). |
| Database (SQL) | `npx supabase db start`, then `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres supabase/tests/run.sh` | Runs every `supabase/tests/*.test.sql` against the migrated schema. Use `supabase/tests/helpers.sql` to create users and act as them; wrap each test in `begin; ... rollback;`. Needs `psql`. |
