# Futty – Coding

As of 7 November 2026 (repo at commit 8c93516) · Two developers, both in Claude Code: Panos (money, bookings, venues, release) and Anghelo (matches, stats, social, notifications)

**Build order: do the steps in section 5 top to bottom.** Nothing in a later step starts before the step it depends on is merged. Core app by Fri 20 Nov, Gipedo Pano by Tue 24 Nov, venue dashboard by Wed 2 Dec (before the December venue visits).

## 1\. Already done (don't redo)

- 4 Nov: profile lock-down and other security hardening; idempotent payments; webhook deduplication; expired holds handled; old full-charge path retired; Futty AI rate limit; in-app account deletion; Apple Pay and Google Pay; CI (lint, TypeScript, Edge Function checks); Dependabot  
- 5 Nov: EAS Update; CI on Node 22; Expo project moved to the futty-app organisation; My Bookings reachable  
- 6 Nov: flat €0.80 service fee per player shown as its own line; pitch price split across everyone on the pitch (10 for a 5-a-side); Futty AI keyboard and error fixes; leave the payment screen after paying (PR \#19)  
- 7 Nov: Cyprus time for every "has this started?" check (database time zone Asia/Nicosia, book_slot, delete-account, Futty AI); SQL tests and Deno tests run in CI on every PR (PR \#20). The payment and booking rules were finalised in 13 Payments & Bookings Spec; the UI direction in 15 Design Brief.

Not done yet: the rest of the test harness (T0: SQL tests run against the migrated schema, but there is no Jest yet); remaining security fixes (P2); everything in 14.

**Warning:** since 6 November a 5-a-side needs 10 app payments, and the 3-hour auto-cancel still runs until P4a removes it. Any real group that doesn't all pay in the app gets cancelled. P4a fixes it; until then, test only with your own accounts.

## 2\. How you avoid getting in each other's way

1. **Separate copies.** Your own clone, your own branch per step: `panos/p4-payments`, `anghelo/a2-match-record`.  
2. **Merge small and daily.** A pull request into master at least once a day; the other person reviews it the same day; no branch older than 3 days.  
3. **Tests or no merge.** A pull request without tests for what it changes isn't merged, and CI must be green (set up in T0).  
4. **Pull before every Claude Code session:** `git pull origin master`.  
5. **Your own local database:** `supabase start`. Nobody pastes SQL into the production dashboard; production changes only through `supabase db push`, run by Panos after a merge.  
6. **Migrations: new files only,** via `supabase migration new <name>`, prefixed `pay_` (Panos) or `match_` (Anghelo). Never edit a merged migration.  
7. **Shared files in their own tiny pull request,** announced first: `package.json`, `app.json`, `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `lib/supabase.ts`, `constants/`, `components/ui/`. Panos owns `package.json` and `app.json`; ask him for new libraries. Any change to either means a new iOS development build.  
8. **Daily 10-minute call:** what I merged, what's next, anything touching your side.

## 3\. Who owns what

| Area | Panos | Anghelo |
| :---- | :---- | :---- |
| Screens | `book.tsx`, `booking-payment.tsx`, `my-bookings.tsx`, `venue-dashboard.tsx`, `squads.tsx`, `join-squad-post.tsx`, `app/account/payments/`, `app/account/settings/`, `premium*`, venue pages | `app/(tabs)/*.tsx` except `_layout` (Home, team, leagues, profile, community), `fixture-*.tsx`, `previous-games.tsx`, `upcoming-fixtures.tsx`, `team-profile.tsx`, `player-profile.tsx`, `matchmaking.tsx`, `notifications.tsx`, match and stats screens |
| `lib/` | `booking*`, `payments.ts`, `service-fee.ts`, `wallet-pay.ts`, `account.ts`, `squads.ts`, `use-venues.ts`, `use-day-bookings.ts`, `use-my-bookings.ts`, `use-squad-posts.ts`, `premium.ts`, `rules.ts`, `lib/money/` | `fixtures.ts`, `leagues.ts`, `teams.ts`, `use-recent-results.ts`, `xp-tier.ts`, `notifications.ts`, `push-notifications.ts`, `community.ts`, `use-follows.ts`, `lib/match/`, `lib/stats/`, `lib/calendar/` |
| Components | `components/booking/`, `components/venue/` | `components/match/`, `components/stats/` |
| Edge Functions | payment, Stripe, Apple, cancellation, account, venue functions, `futty-ai-chat` | `notify-*`, reminder, WhatsApp and team-of-the-week jobs |
| Database | venues, pitches, bookings, payments, squad posts, profiles security, app rules, menu items | matches, match players, attendance, goals, votes, ratings, levels, stats, notifications, calendar |
| Release and CI | `app.json`, `eas.json`, `.github/`, builds, App Store | — |

## 4\. The five contracts between the two tracks

Agree them in your next call before either of you writes database code. Until one exists, the caller uses a stub with the agreed signature.

| \# | Contract | Built by | Used by | What it does |
| :---- | :---- | :---- | :---- | :---- |
| 1 | `create_match_for_booking(booking_id)` | Anghelo | Panos, when a booking is confirmed | Creates the match and its players from the booking |
| 2 | `booking_participants` table | Panos | Anghelo | Who's on the booking: profile or guest name, venue-provided player, payment choice (app or cash), paid state (13) |
| 3 | `match_result_confirmed` view | Anghelo | Panos, for the after-match charge and Gipedo Pano | Matches whose score is confirmed, with result and kickoff |
| 4 | `send_notification(profile_id, type, data)` | Anghelo | Panos | One place that writes notifications and sends push (and later WhatsApp) |
| 5 | `<NextBookingCard />` | Panos | Anghelo, on Home | Next booking: who's in, who hasn't paid |

## 5\. Build order

The build order, owners, dependencies, hours and every prompt are in **14 Claude Code Prompts** (docs/specs/14-claude-code-prompts.md). Each step: `/clear`, plan mode (Shift+Tab), paste the prompt, approve the plan, then open a pull request when tests pass. The specs are in `docs/specs/`: 13-payments-bookings.md and 15-design.md win over 03, 05 and 12 where they disagree.

**Not coding but blocking:** Anghelo fills the Futty Venue Data sheets for English School and Nuevo Campo by Wed 11 Nov (P9 imports them).

## 6\. The 14 November checkpoint

On Saturday 14 November: are P4a and P4b passing every payment test against the fake Stripe and in Stripe test mode, and is A4 merged? If not, move these to after submission, in this order: P11 Weather, P12 6 v 6 switching, A7, A6, U2, A5. Never move: S0, U0, P1–P3, P4a–P4c, P5, P9, P10, T0, A1–A4, A8, P8 (Gipedo Pano is in for launch) and P6 (needed for the December venue visits).

## 7\. Prompts

Every current prompt is in 14 Claude Code Prompts. These three are unchanged and kept here for reference:

### A6 (Anghelo)

```
Build shareable cards generated on the phone: result card (score, teams, scorers, man of the match, venue, date, Futty logo, "Book on Futty" QR) at 1080x1920 and 1080x1080, plus hat-trick, man-of-the-match and team-of-the-week variants, shared through the native share sheet. Ask Panos before adding libraries. Tests for the card data. Plan first.
```

### A7 (Anghelo)

```
Build team of the week (every Monday morning Cyprus time, per venue with at least 4 confirmed matches that week, otherwise city-wide, plus per league; best average rating per position with at least 3 ratings; ties by man-of-the-match awards then goals; notify selected players with a card), season stats for players and teams (calendar year for casual games, league season for leagues), and leaderboards per venue and city with a minimum number of appearances. Update on every confirmed match. Tests for selection and ties. Plan first.
```

### A9 (Anghelo)

```
Add WhatsApp as a reminder channel alongside push, per docs/specs/05-product.md section 13: players opt in and choose WhatsApp, push or both per reminder type; send through the WhatsApp Business Platform (Meta Cloud API) from an Edge Function using approved templates for the 24h and 2h reminders, the unpaid-spot alert and "score your game"; extend send_notification to route by preference; log every message and its cost. Keep the API token as a Supabase secret. Tests with the API mocked. Plan first.
```
