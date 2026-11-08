@AGENTS.md

## Ownership

| Area | Panos | Anghelo |
| :---- | :---- | :---- |
| Screens | `book.tsx`, `booking-payment.tsx`, `my-bookings.tsx`, `venue-dashboard.tsx`, `squads.tsx`, `join-squad-post.tsx`, `app/account/payments/`, `app/account/settings/`, `premium*`, venue pages | `app/(tabs)/*.tsx` except `_layout` (Home, team, leagues, profile, community), `fixture-*.tsx`, `previous-games.tsx`, `upcoming-fixtures.tsx`, `team-profile.tsx`, `player-profile.tsx`, `matchmaking.tsx`, `notifications.tsx`, match and stats screens |
| `lib/` | `booking*`, `payments.ts`, `service-fee.ts`, `wallet-pay.ts`, `account.ts`, `squads.ts`, `use-venues.ts`, `use-day-bookings.ts`, `use-my-bookings.ts`, `use-squad-posts.ts`, `premium.ts`, `rules.ts`, `lib/money/` | `fixtures.ts`, `leagues.ts`, `teams.ts`, `use-recent-results.ts`, `xp-tier.ts`, `notifications.ts`, `push-notifications.ts`, `community.ts`, `use-follows.ts`, `lib/match/`, `lib/stats/`, `lib/calendar/` |
| Components | `components/booking/`, `components/venue/` | `components/match/`, `components/stats/` |
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
