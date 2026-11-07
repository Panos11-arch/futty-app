# Futty – Coding

As of 6 November 2026 (repo at commit 43a5231) · Two developers, both in Claude Code: Panos (money, bookings, venues, release) and Anghelo (matches, stats, social, notifications)

**Build order: do the steps in section 5 top to bottom.** Nothing in a later step starts before the step it depends on is merged. Core app by Fri 20 Nov, Gipedo Pano by Tue 24 Nov, venue dashboard by Wed 2 Dec (before the December venue visits).

## 1\. Already done (don't redo)

- 4 Nov: profile lock-down and other security hardening; idempotent payments; webhook deduplication; expired holds handled; old full-charge path retired; Futty AI rate limit; in-app account deletion; Apple Pay and Google Pay; CI (lint, TypeScript, Edge Function checks); Dependabot  
- 5 Nov: EAS Update; CI on Node 22; Expo project moved to the futty-app organisation; My Bookings reachable  
- 6 Nov: flat €0.80 service fee per player shown as its own line; pitch price split across everyone on the pitch (10 for a 5-a-side); Futty AI keyboard and error fixes; leave the payment screen after paying (PR \#19)

Not done yet: migrations (P1), tests in CI (T0), remaining security fixes (P2), everything below.

**Warning:** since 6 November a 5-a-side needs 10 app payments, and the 3-hour auto-cancel still runs. Any real group that doesn't all pay in the app gets cancelled. P4 fixes it; until then, test only with your own accounts.

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
| `lib/` | `booking*`, `payments.ts`, `service-fee.ts`, `wallet-pay.ts`, `account.ts`, `squads.ts`, `use-venues.ts`, `use-day-bookings.ts`, `use-my-bookings.ts`, `use-squad-posts.ts`, `premium.ts`, `rules.ts` | `fixtures.ts`, `leagues.ts`, `teams.ts`, `use-recent-results.ts`, `xp-tier.ts`, `notifications.ts`, `push-notifications.ts`, `community.ts`, `use-follows.ts`, `lib/match/`, `lib/stats/`, `lib/calendar/` |
| Components | `components/booking/`, `components/venue/` | `components/match/`, `components/stats/` |
| Edge Functions | payment, Stripe, Apple, cancellation, account, venue functions, `futty-ai-chat` | `notify-*`, reminder, WhatsApp and team-of-the-week jobs |
| Database | venues, pitches, bookings, payments, squad posts, profiles security, app rules, menu items | matches, match players, attendance, goals, votes, ratings, levels, stats, notifications, calendar |
| Release and CI | `app.json`, `eas.json`, `.github/`, builds, App Store | — |

## 4\. The five contracts between the two tracks

Agree them in your next call before either of you writes database code. Until one exists, the caller uses a stub with the agreed signature.

| \# | Contract | Built by | Used by | What it does |
| :---- | :---- | :---- | :---- | :---- |
| 1 | `create_match_for_booking(booking_id)` | Anghelo | Panos, when a booking is confirmed | Creates the match and its players from the booking |
| 2 | `booking_participants` table | Panos | Anghelo | Who's on the booking: profile or guest name, paid or unpaid |
| 3 | `match_result_confirmed` view | Anghelo | Panos, for the after-match charge and Gipedo Pano | Matches whose score is confirmed, with result and kickoff |
| 4 | `send_notification(profile_id, type, data)` | Anghelo | Panos | One place that writes notifications and sends push (and later WhatsApp) |
| 5 | `<NextBookingCard />` | Panos | Anghelo, on Home | Next booking: who's in, who hasn't paid |

## 5\. Build order

Each step: `/clear`, plan mode (Shift+Tab), paste the prompt, approve the plan, then open a pull request when tests pass. The specs are in `docs/specs/` (03-payments.md, 05-product.md, 06-coding.md, 12-playtomic.md).

| \# | Step | Owner | Needs first | Hours | Done by |
| :---- | :---- | :---- | :---- | :---- | :---- |
| 1 | P1 Migrations and local database | Panos | — | 4 | Sat 7 Nov |
| 2 | A1 Match spec and mock components | Anghelo | — | 4 | Sat 7 Nov |
| 3 | T0 Tests in CI | Panos | P1 | 4 | Sun 8 Nov |
| 4 | A2 Match record | Anghelo | P1, T0 | 12 | Wed 11 Nov |
| 5 | P2 Remaining security fixes | Panos | T0 | 6 | Tue 10 Nov |
| 6 | P3 Venue model | Panos | P2 | 8 | Thu 12 Nov |
| 7 | A3 Form, recent matches, head-to-head, reminders, add to calendar | Anghelo | A2 | 12 | Fri 13 Nov |
| 8 | P4 Payments: both options, after-match charge, cancellation rules | Panos | P3 | 26 | Mon 16 Nov |
| 9 | A4 Match page, man of the match, lineups | Anghelo | A2 | 10 | Sun 15 Nov |
| 10 | P9 Venue pages and data import | Panos | P3, venue data sheets | 8 | Tue 17 Nov |
| 11 | A8 Post-match food and drink offers | Anghelo | A2, P9 | 4 | Wed 18 Nov |
| 12 | A5 Ratings and skill level | Anghelo | A4 | 10 | Thu 19 Nov |
| 13 | P5 Booking flow screens | Panos | P4 | 10 | Thu 19 Nov |
| 14 | P10 Shared rules source and Futty AI | Panos | P4 | 6 | Fri 20 Nov |
| 15 | A6 Shareable cards | Anghelo | A4 | 5 | Fri 20 Nov |
| 16 | P7 Release build | Panos | P5, P10 | 3 | Sat 21 Nov |
| 17 | P8 Gipedo Pano | Panos | P4 | 10 | Tue 24 Nov |
| 18 | A7 Team of the week, season stats, leaderboards | Anghelo | A5 | 6 | Tue 24 Nov |
| 19 | A9 WhatsApp reminders | Anghelo | A3, Meta account | 6 | Wed 2 Dec |
| 20 | P6 Venue dashboard | Panos | P4, P9 | 20 | Wed 2 Dec |

**Honest load to 20 November:** Panos about 72 hours, Anghelo about 57 hours plus about 6 hours of venue data. That's 30+ hours a week each, on top of university. The 14 November checkpoint (section 6\) decides what moves.

**Not coding but blocking:** Anghelo fills the Futty Venue Data sheets for English School and Nuevo Campo by Wed 11 Nov (P9 imports them).

## 6\. The 14 November checkpoint

On Saturday 14 November: is P4 passing every payment test in Stripe test mode, and is A4 merged? If not, move these to December, in this order: A7, A6, A9, A5. Never move: P1–P5, P9, P10, T0, A1–A4, A8.

## 7\. Prompts

### P1 (Panos)

```
Check prod has run supabase/security-hardening.sql, settle-gipedo-pano-cron.sql and flat-service-fee.sql (look for tables stripe_webhook_events, ai_chat_usage and column venue_bookings.service_fee_cents_per_player). Then pull the prod schema into supabase/migrations as a baseline, including venues, venue_bookings, squad_posts, squad_post_joiners. Move loose supabase/*.sql to supabase/legacy/. Make `supabase start` plus seed data work locally. Append the ownership block from docs/specs/06-coding.md section 3 to CLAUDE.md. Plan first.
```

### A1 (Anghelo)

```
Read docs/specs/05-product.md sections 2-8 and docs/specs/06-coding.md section 4. Write docs/specs/match-record.md: tables, columns, RLS, every security-definer function with its signature, and the exact signatures of contracts 1, 3 and 4. No database code. Then build presentational components in components/match/ (FormChips, MatchRow, ScoreLine) against typed mock data in lib/match/mock.ts, with Jest tests. Only touch components/match/, lib/match/ and docs/specs/. Plan first.
```

### T0 (Panos)

```
Add to CLAUDE.md under "Testing": every pull request must include tests for the behaviour it changes (SQL tests for database functions and policies, Deno tests for Edge Functions, Jest tests for lib/ and components); a PR without tests is not merged; CI must be green. Make CI run them: supabase start, apply migrations, run every SQL test (move supabase/legacy/gipedo-pano-payments.test.sql into the test folder), `deno test` for supabase/functions, and Jest with jest-expo for the app. Add one real test of each kind so the pipeline is proven. Plan first.
```

### A2 (Anghelo)

```
Implement docs/specs/match-record.md as new migrations (supabase migration new match_record) with SQL tests. Result confirmation: one captain submits, the other side accepts or rejects, no response confirms it after 24h; this replaces the 3-attempt logic for new matches only. Internal functions service_role only, as in supabase/legacy/security-hardening.sql. Build create_match_for_booking, the match_result_confirmed view and send_notification. QR check-in: a per-match code the venue shows, scanned in the app. Only touch files I own per CLAUDE.md. Plan first.
```

### P2 (Panos)

```
Fix as new migrations, each with a SQL test: (1) book_slot: reject pitches < 1, end <= start, slots outside opening hours or off the 30-minute grid, and format/capacity/pitches combinations that don't match; enforce the booking window server-side (7 days free, 14 days Premium); use Asia/Nicosia time for "in the past". (2) create_squad_post: a linked booking must be the caller's and match venue, time and format. (3) team_members: an invite the invited user accepts, not a direct insert by the captain. (4) add_booking_player: an invite the player accepts. (5) venue_bookings: other users see availability only (venue_day_availability), not who booked, team or amounts. (6) owner-block updates re-check venue ownership and capacity. Plan first.
```

### P3 (Panos)

```
Replace the pooled base_pitches model: add pitches (name, size, surface, indoor, formats, combinable_with, is_open), opening_hours per weekday, closures, price_rules (peak/off-peak/weekend by format), and venue fields for cancellation rules, address, lat/lng and a live boolean (true by default). Rewrite book_slot and availability on real pitches with automatic pitch assignment (staff can move it). Keep the flat fee from flat-service-fee.sql. Tests for overlapping bookings, combined pitches and closures. Plan first.
```

### A3 (Anghelo)

```
Using the match record: form guide (last 5 confirmed matches, W/D/L chips, forfeit shown as "L (forfeit)") for players and named teams; recent matches on player and team profiles; head-to-head between two named teams on opposition posts, fixtures and match pages; a job every 15 minutes sending push reminders 24h and 2h before a player's games and after them (confirm score, vote, rate, rebook); followed-team notifications; notification settings per type with quiet hours; profile preferences (position, foot, preferred days and times) and "players you play with most". Add an "Add to calendar" button on every booking and fixture (docs/specs/05-product.md section 13) that adds the event to the phone's calendar and updates or removes it when the booking changes; ask Panos before adding a library. Tests for each. Plan first.
```

### P4 (Panos)

```
Implement docs/specs/03-payments.md. Option 1: the booker pays pitch price + €0.55 per player in one PaymentIntent. Option 2: each player pays their share (price / capacity, as in flat-service-fee.sql) + €0.80; the booker pays their share at booking and their card is saved (SetupIntent, off-session); two hours after the match, unpaid spots are charged to the booker in one off-session payment at the booker rate; if that fails, notify the booker and block new bookings until paid. Remove the 3-hour auto-cancel (cancel-unpaid-bookings, bookings_needing_share_cancellation) for new bookings. Cancellation: free within 1 hour of booking; then until 6 hours before kickoff a €1 fee with a card refund (or reschedule, per decision E in 01, if decided); no refund within 6 hours; the booker can cancel their own spot (it reopens and players are notified) or the whole team. Stripe Connect destination charges so the venue receives exactly the pitch price and Futty pays Stripe's fees; fees read from one constant until P10. Keep the existing idempotency keys, webhook dedupe and wallet setup; attach the customer to every PaymentIntent; add Revolut Pay; require a verified phone number before paying or posting "Need opposition". Call create_match_for_booking and send_notification (stub if not merged). Tests for every refund row and the failed after-match charge. Plan first.
```

### A4 (Anghelo)

```
Build the match page (score, scorers, assists, lineups, man of the match, venue, date) that opens once the score is confirmed; captains add their own side's scorers for 24h and the count must match the score. Man-of-the-match voting: only checked-in players, one vote, not yourself, closes 24h after confirmation, ties shared. Lineups: formation presets per format, the captain drags players onto a drawn pitch, empty positions link to "Need players". Ask Panos before adding an SVG library. Tests for each rule. Plan first.
```

### P9 (Panos)

```
Add venue_photos, venue_amenities, venue_menu_items (name, category, description, price, available times and days, is_post_match_offer, offer text, photo, active) and pitch detail fields. Build the venue page: gallery, amenities and after-sales services, pitches, cancellation rules, prices and a Directions button (Apple or Google Maps). Write a script that imports the Venue Profiles and Venue Food & Drink CSVs (exported from Google Sheets) and the photos into these tables and storage. Tests for the import and the page queries. Plan first.
```

### A8 (Anghelo)

```
After a player submits or confirms a score, show that venue's active post-match offers from venue_menu_items available at the current time, with photo, price and offer text. Tapping one shows "Show this at the counter" with a short code; record views and redemptions. Tests for which offers show and when. Only touch my files. Plan first.
```

### A5 (Anghelo)

```
Replace XP with a skill level from 1.0 to 7.0 (docs/specs/05-product.md section 4 and docs/specs/12-playtomic.md section 5): five sign-up questions give a provisional level; after each confirmed competitive match an Elo-style update from both sides' average levels; a reliability % that rises with competitive matches and scales each change; each booking or post is "Competitive" or "Casual" and only competitive matches move levels. Match ratings 1-10: only checked-in players, within 24h, not yourself, hidden individually, shown with 3+ votes, drop highest and lowest with 6+, down-weight raters who give everyone the same score; ratings move the level by at most 0.1. Add "balance teams" for pickup games. Tests for each rule. Plan first.
```

### P5 (Panos)

```
Rebuild the booking flow: date -> time -> format -> venues free at that time with price, photo and area; 1h, 1.5h or 2h; total and cancellation rules before paying; "Pay for everyone: €x" or "Split: €y each" with both prices shown; when paying for everyone, the booker can add every player's name and send invites; guests by name; an invite link a guest can pay through without an account; a countdown to the cancellation deadline on the booking card; "Book the same slot next week" in one tap. Update My Bookings to show who's paid. Build <NextBookingCard /> in components/booking/. Tests for the price shown at each step. Plan first.
```

### P10 (Panos)

```
Create one source of truth for business rules: public.app_rules (fee per option, free and Premium booking windows, Premium price, cancellation thresholds and fee), readable by everyone, writable only by service_role. book_slot, cancellation, the app (lib/rules.ts, fetched and cached) and futty-ai-chat all read it; remove every hard-coded copy (SERVICE_FEE_CENTS, STANDARD_ADVANCE_DAYS, PERSONAL_PREMIUM_PRICE_LABEL and the numbers in the AI system prompt). Rewrite the Futty AI system prompt from these rules plus the current booking flow, both payment options, cancellation and Gipedo Pano. Add a test file of 20 real player questions with the facts each answer must contain, testing the prompt-building with a mocked model call. Plan first.
```

### A6 (Anghelo)

```
Build shareable cards generated on the phone: result card (score, teams, scorers, man of the match, venue, date, Futty logo, "Book on Futty" QR) at 1080x1920 and 1080x1080, plus hat-trick, man-of-the-match and team-of-the-week variants, shared through the native share sheet. Ask Panos before adding libraries. Tests for the card data. Plan first.
```

### P7 (Panos)

```
Hide Team Premium behind a flag if it isn't ready. App display name "Futty". Prepare an EAS production build and TestFlight upload, re-test account deletion on that build, check every venue's live switch, make a demo account and test venue for Apple's reviewer, and list anything App Review is likely to reject.
```

### P8 (Panos)

```
Rebuild Gipedo Pano per docs/specs/03-payments.md and decision F in 01: each team captain authorises a manual-capture hold for the full pitch price plus their team's fees; only for games within 6 days of kickoff; after the result is confirmed, capture the loser's hold in full and cancel the winner's; on a draw or a dispute capture half of each hold (amount_to_capture). Replace the old settlement path for new bookings; old bookings keep the old logic. Tests for win, loss, draw, dispute, no result after 24h and an expired hold. Plan first.
```

### A7 (Anghelo)

```
Build team of the week (every Monday morning Cyprus time, per venue with at least 4 confirmed matches that week, otherwise city-wide, plus per league; best average rating per position with at least 3 ratings; ties by man-of-the-match awards then goals; notify selected players with a card), season stats for players and teams (calendar year for casual games, league season for leagues), and leaderboards per venue and city with a minimum number of appearances. Update on every confirmed match. Tests for selection and ties. Plan first.
```

### A9 (Anghelo)

```
Add WhatsApp as a reminder channel alongside push, per docs/specs/05-product.md section 13: players opt in and choose WhatsApp, push or both per reminder type; send through the WhatsApp Business Platform (Meta Cloud API) from an Edge Function using approved templates for the 24h and 2h reminders, the unpaid-spot alert and "score your game"; extend send_notification to route by preference; log every message and its cost. Keep the API token as a Supabase secret. Tests with the API mocked. Plan first.
```

### P6 (Panos)

```
Build the venue dashboard launch version from docs/specs/05-product.md section 12, items 1-11: calendar per pitch with players, paid status and check-ins; pitches with open/close and closures; hours per weekday; prices per format; one-off and recurring blocks; walk-in and phone bookings marked cash or card; weather cancellation with automatic refunds and notifications; check-in QR and no-show marking; venue profile, photos and amenities; food and drink items and post-match offers; Stripe Connect onboarding and payouts; venue notifications and a daily summary. Every common action in two taps or fewer on a phone. Tests for every write path. Plan first.
```

