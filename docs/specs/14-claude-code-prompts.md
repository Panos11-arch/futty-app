# 14 Futty – Claude Code Prompts

7 November 2026, split updated 9 November · Panos runs the P prompts, Anghelo the A and U prompts (and the venue data spreadsheets); Dimitris: pitch deck · Replaces section 7 of 06 Coding · The UI redesign prompts are in 17

**One prompt = one pull request.** Do them in the order below. A prompt starts only when everything in its "Needs" column is merged. Every prompt names the spec sections it implements and the tests that prove it.

## How to run a prompt

1. `git checkout master && git pull origin master`, then `git checkout -b panos/p4b-cancellations` (Anghelo: `anghelo/a2-match-record`).
2. In Claude Code: `/clear`, switch to plan mode (Shift+Tab), paste the prompt.
3. **Read the plan before approving it.** Reject it if it does any of these:
    - touches files you don't own;
    - skips a test listed in the prompt;
    - invents a rule that isn't in the spec.
4. Let it build. Run the tests locally: `supabase/tests/run.sh`, `deno test supabase/functions/`, `npx jest`.
5. Open the pull request. For any money or security PR, first ask Claude Code in a fresh session to review the diff against spec 13 and the working rules in CLAUDE.md. **Merge only when CI is green.**
6. If Claude Code says the spec is unclear, **stop and decide it together.** Write the decision into 13 (or 15) in the same PR.

## Who runs what (from 9 November)

**Panos runs the payments prompts (P), Anghelo runs the match and design prompts (A and U).** Each works in his own files (the Ownership table in CLAUDE.md), on his own branches (`panos/...`, `anghelo/...`), and merges his own pull requests once CI is green and a fresh Claude Code session has reviewed the diff. A pull request that changes a shared file (`package.json`, `app.json`, `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `lib/supabase.ts`, `constants/`, `components/ui/`) needs a quick OK from the other person before merging.

**Only Panos changes production:** he applies every merged migration (both tracks) with `supabase db push`, deploys Edge Functions and runs EAS builds. Anghelo works on his local database only.

### Panos, in this order

| Order | Prompt | Waits for Anghelo's | Hours |
| --- | --- | --- | --- |
| 1 | P4a review and merge (not deployed until P5) | — | 1 |
| 2 | P4b Cancellations and venue credit | — | 8 |
| 3 | P4c Collection, top-ups and debt | A1a (contract signatures); uses the `match_result_confirmed` stub until A2 merges | 10 |
| 4 | P9 Venue pages and data import | U1, and the ES and Nuevo venue data sheets | 8 |
| 5 | P5 Booking flow screens | U1, A3a | 10 |
| 6 | P10 Shared rules and Futty AI | — | 6 |
| 7 | P8 Gipedo Pano | A2 | 10 |
| 8 | P6 Venue dashboard | A2 (check-in) | 20 |
| 9 | P7 Release build | Anghelo's "Now" prompts merged | 3 |
| 10 | P4d Venue payouts | — | 8 |
| 11 | P11 Weather | — | 6 |
| 12 | P12 6 v 6 switching | — | 4 |

About 50 hours before 20 November and 45 after.

### Anghelo, in this order

| Order | Prompt | Waits for Panos's | Hours |
| --- | --- | --- | --- |
| 1 | A1a Match spec only (`docs/specs/match-record.md`) | — | 2 |
| 2 | U0 Design tokens and fonts (17) | — | 3 |
| 3 | U1 Component library (17) | — | 6 |
| 4 | A2 Match record and notifications | — | 12 |
| 5 | A3a Add to calendar (`lib/calendar`) | — | 3 |
| 6 | A1b Match components (FormChips, MatchRow, ScoreLine) | — | 2 |
| 7 | U2 Navigation (17) | — | 3 |
| 8 | U3 Home (17) | — | 3 |
| 9 | A3b Form, reminders, notification settings | — | 9 |
| 10 | A4 Match page, man of the match, lineups | — | 10 |
| 11 | A8 Post-match food and drink offers | P9 (venue_menu_items) | 4 |
| 12 | A5 Ratings and skill level | — | 10 |
| 13 | U4 Play section, U6 Sign-in (17) | — | 8 |
| 14 | U5 Profile, account and Premium (17) | P5 and P10 | 4 |
| 15 | U7 Squads, posts and pop-ups (17) | P5 | 3 |
| 16 | A6 Shareable cards, A7 Team of the week | — | 11 |
| 17 | U8 Final sweep and guards (17) | P5, P6, P9 | 3 |

About 67 hours before 20 November and 30 after. The venue data sheets for English School and Nuevo Campo come first (due Wed 11 November): P9 imports them.

### Where the two tracks meet

| What | Built by | Needed by | How to avoid waiting |
| --- | --- | --- | --- |
| Contract signatures 1, 3, 4 (`docs/specs/match-record.md`) | Anghelo, A1a | Panos, P4c | A1a is Anghelo's first prompt. |
| `send_notification` (contract 4) | Anghelo, A2 | Panos, every P prompt | A stub already exists (P3). A2 replaces it with `create or replace` and keeps every notification type already allowed. |
| `match_result_confirmed` (contract 3) | Anghelo, A2 | Panos, P4c and P8 | P4c uses a stub view with A1a's signature; A2 replaces it. P8 waits for A2. |
| `create_match_for_booking` (contract 1) | Anghelo, A2 | Panos, booking confirmation | Panos calls it only once A2 is merged. |
| `components/ui` and tokens | Anghelo, U0 and U1 | Panos, P9 and P5 | U0 and U1 are Anghelo's 2nd and 3rd prompts. |
| `lib/calendar` | Anghelo, A3a | Panos, P5 (Add to calendar) | A3a is split out of A3 and comes early. |
| `venue_menu_items` | Panos, P9 | Anghelo, A8 | A8 comes late in Anghelo's list. |
| `NextBookingCard` (contract 5) | Panos, P5 | Anghelo's Home (U3) | U3 builds `components/booking/next-game-card.tsx`; P5 rebuilds that same file with the same export and props, so Home needs no change. |
| `useOwed()` in `lib/use-owed.ts` (contract 6, debt and failed payments) | Panos, P5 | Anghelo's Home banner (U3) | U3 builds the banner slot empty; once P5 is merged, Anghelo connects `useOwed()` to it in a small follow-up. |
| Screens restyled by U5 and U7 (account payments, settings, Premium, squads) | Panos owns them | Anghelo restyles them | U5 and U7 start only after P5 (and P10 for U5) are merged; Panos doesn't change those screens afterwards. |
| Production database, Edge Functions, EAS builds | Panos | Both | Anghelo tells Panos when a `match_` migration is merged; Panos applies it with the next push. |

## Order and owners

**Now: by Friday 20 November (code-complete)**

| # | Prompt | Track | Needs | Hours |
| --- | --- | --- | --- | --- |
| 1 | S0 Standing rules in CLAUDE.md | Setup | — | 0.5 |
| 2 | U0 Design tokens and fonts (17) | Design | S0 | 3 |
| 3 | P1 Migrations baseline and local database | Setup | S0 | 4 |
| 4 | T0 Test harness (SQL, Deno, Jest) | Setup | P1 | 5 |
| 5 | U1 Component library, U2 Navigation, U3 Home (17) | Design | U0, T0 | 12 |
| 6 | A1 Match spec and mock components | Matches | U1 | 4 |
| 7 | P2 Server-side guards | Payments | T0 | 6 |
| 8 | A2 Match record and notifications | Matches | P1, T0 | 12 |
| 9 | P3 Venue model | Payments | P2 | 8 |
| 10 | P4a Booking modes, fees and payment timing | Payments | P3, A2 contract 4 | 10 |
| 11 | A3 Form, reminders, add to calendar | Matches | A2 | 12 |
| 12 | P4b Cancellations and venue credit | Payments | P4a | 8 |
| 13 | P4c Collection, top-ups and debt | Payments | P4b, A2 contract 3 | 10 |
| 14 | A4 Match page, man of the match, lineups | Matches | A2 | 10 |
| 15 | P9 Venue pages and data import | Payments | P3, venue data sheets | 8 |
| 16 | P5 Booking flow screens | Payments | P4c, U1 | 10 |
| 17 | A8 Post-match food and drink offers | Matches | A2, P9 | 4 |
| 18 | P10 Shared rules and Futty AI | Payments | P4c | 6 |
| 19 | A5 Ratings and skill level | Matches | A4 | 10 |

**Next: 21 November to 2 December (submission 25 Nov, venue visits from 2 Dec)**

| # | Prompt | Track | Needs | Hours |
| --- | --- | --- | --- | --- |
| 20 | P7 Release build | Payments | P5, P10 | 3 |
| 21 | P8 Gipedo Pano | Payments | P4c, A2 | 10 |
| 22 | P6 Venue dashboard | Payments | P4c, P9 | 20 |
| 23 | P4d Venue payouts (Stripe Connect, decided 7 Nov) | Payments | P6 | 8 |
| 24 | U4–U8 Restyle every remaining screen, final guards (17) | Design | U2 | 18 |
| 25 | P11 Weather | Payments | P9 | 6 |
| 26 | P12 6 v 6 switching | Payments | P5 | 4 |
| 27 | A6 Shareable cards | Matches | A4 | 5 |
| 28 | A7 Team of the week, season stats, leaderboards | Matches | A5 | 6 |

**Later: after launch**

A9 WhatsApp reminders. Then, in Playtomic order (12, section 6):
1. open games for every free slot;
2. "notify me if this slot opens";
3. weekly recurring bookings;
4. retention notifications;
5. league divisions;
6. venue tournaments;
7. games at other pitches.

**Load:** split between Panos and Anghelo (see "Who runs what"): about 50 and 67 hours of "Now" prompts before 20 November, then about 45 and 30 hours of "Next". The 14 November checkpoint (06, section 6) decides what moves. Cut in this order:
1. P11 Weather
2. P12 Switching
3. A7
4. A6
5. A5
6. U5–U7 (U4 and U8 stay: they cover the screens in the App Store screenshots)

**Never cut:** S0, T0, U0–U4, U8, P1–P5, P4a–c, P9, P10, A1–A4, A8, P8, P6.

---

## S0 Standing rules (Panos, once)

```
Add a section "Working rules" to CLAUDE.md, below the existing @AGENTS.md line, with exactly these rules, then open a PR:

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

Plan first.
```

## Now: payments, bookings and venues

### P1 Migrations baseline and local database

```
Goal: the whole production schema lives in supabase/migrations, so every developer and CI can build an exact copy locally.

1. I will run `npx supabase db dump --linked --schema public -f supabase/migrations/<timestamp>_baseline.sql` on my machine and commit the file (you can't reach production). Tell me the exact command and wait for the file.
2. Check the dump contains: tables stripe_webhook_events and ai_chat_usage; column venue_bookings.service_fee_cents_per_player; book_slot using Asia/Nicosia time (from supabase/cyprus-time.sql); the grants from supabase/security-hardening.sql. List anything missing and stop.
3. Move every loose supabase/*.sql file into supabase/legacy/ (keep supabase/tests/ and supabase/functions/ where they are). Update any comments that point at the old paths.
4. Make `npx supabase start` and `npx supabase db reset` work locally with supabase/seed.sql: two venues (P2 adds allows_6v6_on_5s; set it on one of them then), two pitches each, three test players, one venue staff user. No real people's data.
5. Change supabase/tests/run.sh so CI applies supabase/migrations instead of supabase/tests/stubs.sql; delete stubs.sql once cyprus-time.test.sql passes against the real schema.
6. Append the code-area table from docs/specs/06-coding.md section 3 to CLAUDE.md.

Tests: supabase/tests/cyprus-time.test.sql passes against the migrated schema; add supabase/tests/baseline.test.sql asserting RLS is enabled on every public table and no public function is executable by anon unless it is in an explicit allow-list.

Plan first.
```

### T0 Test harness

```
Goal: three kinds of tests run on every PR, each proven by one real test.

1. SQL: CI uses supabase/setup-cli to run `supabase start`, apply migrations and run supabase/tests/run.sh. Add supabase/tests/helpers.sql with helpers to create a test user and act as them (set request.jwt.claim.sub and role authenticated), and to act as service_role.
2. Edge Functions: `deno test --node-modules-dir=none supabase/functions/` (already in CI). Add supabase/functions/_shared/stripe-fake.ts: a fake Stripe client that records every call (method, params, idempotency key) and returns scripted results, so payment code can be tested without the network. One test proving it records an idempotency key.
3. App: add jest-expo and @testing-library/react-native (this PR is the package.json change). `npx jest` runs in CI. One test for lib/service-fee.ts formatEuros (680 -> "€6.80", 5 -> "€0.05", 0 -> "€0.00").
4. Coverage: fail CI if any file under lib/money/ or supabase/functions/_shared/money* drops below 100% line coverage (these folders will hold the money maths from P4a).
5. Document the three commands in CLAUDE.md under "Testing".

Plan first.
```

### P2 Server-side guards

```
Read docs/specs/13-payments-bookings.md, section "Server-side checks that make it airtight". Implement as new migrations (pay_guards), each rule with a SQL test that fails before the change:

1. book_slot rejects: pitches < 1 or more than the venue has; end <= start; slots not on the 30-minute grid; slots outside the venue's opening hours (if hours aren't modelled yet, add them in P3 and leave this check to P3); a format the venue doesn't offer.
2. Player numbers come from the server, not the app: 10 for 5-a-side, 14 for 7-a-side, 18 for 9-a-side, 22 for 11-a-side, and 12 only when the format is 5-a-side, the venue has allows_6v6_on_5s = true and the booker chose 6 v 6. Add venues.allows_6v6_on_5s boolean not null default false. Drop the trusted p_capacity: replace it with p_players_per_side (5 or 6) and derive capacity.
3. Booking window: a standard account can book up to 7 days ahead, Premium up to 14 (Cyprus dates, day 0 = today). Premium comes only from profiles.is_premium, which the app can't write.
4. venues.is_live boolean not null default true; book_slot and every join function refuse a venue that isn't live ("venue_not_live").
5. create_squad_post: a linked booking must be the caller's and match its venue, time and format.
6. team_members and add_booking_player become invites the invited user accepts, not direct inserts.
7. Other users see availability only (a venue_day_availability view), not who booked, their team or amounts.
8. Owner-block inserts and updates re-check venue ownership and capacity.

Tests to include: capacity 100 is impossible; 6 v 6 refused at a venue without the flag and accepted with it (€60 -> 12 players -> 500 + 80 = 580 cents each); day 7 allowed and day 8 refused for standard; day 14 allowed and 15 refused for Premium; a slot that started 1 minute ago refused; a non-live venue refused; another user's booking can't be linked to a squad post.

Plan first.
```

### P3 Venue model

```
Read docs/specs/13-payments-bookings.md (6 v 6, blocking pitches) and docs/specs/05-product.md section 12. Replace the pooled base_pitches model with real pitches, as new migrations (pay_venue_model):

- pitches: venue_id, name, size (5/6/7/9/11-a-side), surface, indoor, formats it hosts, combinable_with, is_open.
- opening_hours per weekday; closures (date ranges); price_rules per format with peak, off-peak and weekend prices in cents.
- venue_blocks: venue staff block pitches for a day or a time range on a day. A block stops NEW bookings only; existing bookings stay and their players are notified through send_notification (type venue_closed_new_bookings).
- A real 6-a-side pitch (English School Central Park) is its own pitch size with its own price; allows_6v6_on_5s (from P2) only applies to 5-a-side pitches.
- Rewrite book_slot and availability on real pitches with automatic pitch assignment (staff can move it later). Keep everything P2 enforces and the fee logic from P4a's spec.

Tests: overlapping bookings refused; combined pitches; closures and blocks hide slots but don't cancel existing bookings; a blocked slot can't be booked; price rules pick the right price at peak, off-peak and weekend.

Plan first.
```

### P4a Booking modes, fees and payment timing

```
Read docs/specs/13-payments-bookings.md sections "Prices and fees", "Booking modes" and "When money is held and taken". Build exactly that, as new migrations (pay_modes) and Edge Function changes.

1. Put all money maths in one SQL function file and one TypeScript module (lib/money/ in the app for display helpers only; supabase/functions/_shared/money.ts for server use). Integer cents. The pitch part per player = pitch price / players, leftover cents on the booker's share.
2. Fees: 80 cents per player when each pays; 55 cents per player when the booker pays for everyone; 0 for a Premium player's own spot. When a Premium booker pays for everyone, only the booker's spot is fee-free.
3. Three modes, chosen at booking and stored on the booking: pay_all, each_pays_responsible, each_pays_own_spot. Cash is allowed in the two each_pays modes; a cash player pays only the fee by card (0 if Premium).
4. Timing:
   - every share is held (manual capture) when paid and the card is saved with consent (setup_future_usage = off_session);
   - a scheduled job takes (captures) each share 60 minutes after it was held;
   - a booking made less than 6 hours before kickoff is captured immediately and requires the player to accept "This booking is non-refundable" first (store the acceptance time on the share).
5. Booker's guarantee (each_pays_responsible only): save the booker's card at booking; place an off-session hold for the full pitch price 72 hours before kickoff, or at booking if kickoff is less than 72 hours away; if it fails, notify the booker (send_notification type guarantee_hold_failed) and retry every 6 hours. A failed hold NEVER cancels the booking.
6. Remove the 3-hour auto-cancel (cancel-unpaid-bookings, bookings_needing_share_cancellation) for every new booking. Old bookings keep the old logic.
7. Every Stripe call has an idempotency key from our ids; every hold, capture and cancel is written to a money_ledger table (booking_id, share_id, kind, amount_cents, stripe_id, reason, created_at).

Tests with these exact amounts:
- €60 5 v 5, each pays: every share 680; Stripe call amounts match.
- €61.11 5 v 5: booker 612 + 80 = 692, the others 611 + 80 = 691.
- 6 v 6 at a venue that allows it: 580 each.
- Pay for everyone: 6550 (5 v 5) and 6660 (6 v 6); a Premium booker paying for everyone: 6495.
- Premium player, own share: 600.
- A cash player pays 80 by card.
- Capture happens at 60 minutes, not before; a booking made 5 hours before kickoff is captured at once and refused without the acknowledgement.
- Guarantee hold placed at kickoff minus 72 hours, or at booking when kickoff is closer; a failed hold leaves the booking active and sends one notification.
- The idempotency key is the same on retry, so no double charge.

Plan first. Stop and ask if anything in the spec seems to conflict.
```

### P4b Cancellations and venue credit

```
Read docs/specs/13-payments-bookings.md section "Cancellations and refunds" and "Venue credit". Implement as new migrations (pay_cancellations) and Edge Function changes.

1. One server function cancellation_quote(booking_id, scope) returns exactly what will happen to every player's money (scope: my_spot or whole_team). cancel_booking runs the SAME computation, so the screen can never promise something different from what happens. The app shows the quote before the player confirms.
2. A player cancels their own spot:
   - within 60 minutes of paying (only when booked more than 6 hours before kickoff): the hold is cancelled, nothing charged;
   - from 60 minutes after paying until 6 hours before kickoff: 100 cents kept by Futty, the rest becomes credit at that venue (680 -> 580 credit);
   - less than 6 hours before kickoff, or the booking was made less than 6 hours before kickoff: nothing back.
   Cancelling releases the spot and notifies the other players. If a late-cancelled spot is filled, the venue keeps both payments.
3. Booker cancels the whole team (each pays): every other player gets their full share back, card refund or credit, their choice; the booker is charged 100 cents for every player who had paid, as one extra charge; the booker's own share follows rule 2.
4. Booker paid for everyone and cancels in the middle window: 100 cents per player kept, the rest becomes credit at that venue (6550 -> 5550 credit).
5. Less than 6 hours before kickoff the whole team can still be cancelled, nobody gets money back, and the slot is released for others to book.
6. Venue cancels: every player gets their whole share back, card refund (5-10 working days) or credit, their choice; Stripe's real fee for each refunded payment (from the balance transaction) is recorded as owed by the venue (venue_payables), and Futty earns nothing on that booking.
7. venue_credits: profile_id, venue_id, amount_cents, source, issued_at, expires_at = issued_at + 12 months, remaining_cents. Credit can only be spent at the issuing venue, never cashed out. Spending credit covers the pitch part with no fee; a shortfall is paid by card plus the normal 80 cents. A daily job expires credit.
8. A cash player who cancels: only the 80-cent fee is at stake (released in the first hour, kept after).

Tests: one per row of the cancellation table with the exact amounts above; whole-team cancel with 9 paid players charges the booker 900 extra; pay-all middle window gives 5550 credit; within 6 hours gives nothing back and frees the slot; venue cancel records the venue's Stripe fee and gives full shares back; credit spent at another venue is refused; credit 500 against a 600 pitch part charges 100 + 80 by card; expired credit can't be spent; cancellation_quote and cancel_booking always agree (property test over random times).

Plan first.
```

### P4c Collection, top-ups and debt

```
Read docs/specs/13-payments-bookings.md sections "When money is held and taken" (steps 4-7), "Short games", "Cash, debt and venue credit". Implement as new migrations (pay_collection) and an Edge Function run by pg_cron.

1. 6 hours before kickoff: if fewer players hold a spot than the booking is for, notify everyone in the booking ("You're 8 of 10. If nobody else joins, each player pays €1.50 extra after the match.") with buttons to request a player from the venue or post a public request.
2. Collection runs 2 hours after the match ends (venue staff can run it earlier through a service function they're allowed to call):
   - "joined" = every player holding a spot, not who turned up; a venue-provided player counts as an empty spot;
   - short game: each joined player's pitch part = pitch price / joined players (leftover cents to the booker); the difference from what they paid is a top-up charged off-session to their saved card; Futty absorbs Stripe's fee on top-ups (no extra fee to the player);
   - each_pays_responsible: anything still unpaid (unticked cash, failed top-ups) is captured from the booker's guarantee hold; the rest of the hold is released;
   - each_pays_own_spot: anything still unpaid becomes that player's debt to the venue;
   - a booker whose guarantee hold never succeeded owes, as debt, everything the hold would have covered (responsible) or their own share (own spot).
3. After the match, an unticked cash player is asked: "Pay €6.00 by card now, or remain in debt to [venue]." (amount from the server).
4. venue_debts: profile_id, venue_id, booking_id, amount_cents, reason, created_at, settled_at, settled_by (payment or venue). A debt can also be owed to Futty (decided 10 November): the booker's unpaid whole-team cancellation charge (booking_cancellation_fees still unpaid at the original kickoff, from P4b). Debts to Futty block exactly like debts to a venue and are paid the same way ("Pay what I owe"). A player with any unsettled debt at ANY venue can't book, join a booking or choose cash anywhere ("player_in_debt"), but can always pay the debt. Paying a debt adds no fee. Venue staff can mark a debt settled.
5. Every capture, top-up, release and debt goes into money_ledger.

Tests: €60 5 v 5 played 4 v 4 -> a top-up of 150 for each of the 8 players (assert the amounts sent to the fake Stripe); 9 players -> 666 each and 672 for the booker (the 6 leftover cents), so top-ups of 66 and 72; a failed top-up in responsible mode is taken from the booker's hold and in own-spot mode becomes a 150 debt; an unticked cash player in responsible mode is covered by the hold; a booker whose hold never succeeded owes whatever is still unpaid at collection, up to 6000 (responsible), or their own 680 (own spot); a debtor can't book, join or choose cash at another venue; paying the debt unblocks them; venue settlement unblocks them; running collection twice changes nothing the second time.

Plan first.
```

### P9 Venue pages and data import

```
Read docs/specs/05-product.md section 12 and docs/specs/15-design.md section 5 (Venue page). Add venue_photos, venue_amenities, venue_menu_items (name, category, description, price_cents, available times and days, is_post_match_offer, offer text, photo, active) and pitch detail fields. Build the venue page with components/ui: photo gallery, name, address with a Directions button (Apple or Google Maps), amenities icon row, pitches, prices, cancellation rules from spec 13, offers, sticky "Book" bar. Leave a slot for the weather strip (P11). Write a script that imports the Venue Profiles and Venue Food & Drink CSVs and photos from the Futty Venue Data folder into these tables and storage; it must be idempotent and refuse rows with missing photo permission.

Tests: import twice gives the same data; a row without photo permission is rejected; page queries return only active items; Jest tests for the venue page states (loading, no photos, full).

Plan first.
```

### P5 Booking flow screens

```
Read docs/specs/13-payments-bookings.md (all sections the player sees) and docs/specs/15-design.md sections 3-5. Rebuild the booking screens I own with components/ui only.

1. Flow: date strip (7 or 14 days by account) -> time -> format (and "players per side: 5 v 5 / 6 v 6" only where the venue allows it) -> venues free at that time as photo cards with price per player -> venue -> checkout.
2. Checkout: "Pay for everyone: €65.50" / "Each pays: €6.80 each" with both prices from the server; for each pays, "I'm responsible for the team" / "Just my spot" with one plain sentence on what each means; price breakdown (pitch + service fee); the cancellation rules in three lines; the non-refundable notice that must be accepted when kickoff is under 6 hours away; cash option where allowed; Apple Pay / Google Pay; sticky total bar.
3. Booking detail: roster with paid state (in app, cash, unpaid), invite and share, a countdown to the next cancellation cutoff, Add to calendar (lib/calendar from A3), Directions, and Cancel, which first shows cancellation_quote and needs a second tap to confirm.
4. Debt: a banner on Book when the player owes money, and a "Pay what I owe" screen; also export useOwed() from lib/use-owed.ts (what the player owes and any failed payment, from the server), which Anghelo connects to Home's banner. Credit: credit per venue with expiry, applied at checkout.
5. Rebuild components/booking/next-game-card.tsx as the real NextBookingCard, keeping its export and props, so Home picks it up without being edited. Don't edit app/(tabs)/index.tsx.
6. The app never computes a price: every amount shown comes from the server response.

Tests (Jest): each screen renders the server's amounts unchanged (680 -> "€6.80"); the non-refundable notice appears at 5h59m and not at 6h01m; Pay is disabled until the notice is accepted; the cancel button shows the quote before cancelling; the debt banner blocks booking and links to payment; 6 v 6 choice hidden when the venue doesn't allow it.

Plan first.
```

### P10 Shared rules and Futty AI

```
Create public.app_rules as the single source for every number in spec 13: fees (80, 55, 0), booking windows (7, 14), free-cancellation minutes (60), cancellation fee (100), refund cutoff hours (6), capture delay (60 minutes), guarantee hold lead (72 hours), collection delay (2 hours), credit expiry (12 months), Gipedo Pano max days (6), Premium price label (€3.99), weather thresholds (60% rain, 40 km/h wind, thunderstorms, 38°C). Readable by everyone, writable only by service_role. Every SQL function, Edge Function and lib/rules.ts (fetched and cached) reads it; remove every hard-coded copy (SERVICE_FEE_CENTS, STANDARD_ADVANCE_DAYS = 2, PERSONAL_PREMIUM_PRICE_LABEL = €4.99, and the numbers in the Futty AI system prompt).

Rewrite the Futty AI system prompt from app_rules plus spec 13: the three booking modes, fees, cancellation and credit, short games, cash and debt, 6 v 6, Gipedo Pano, weather warnings, Premium (€3.99, 14 days vs 7). Add a test file of 20 real player questions, each with the facts its answer must contain, testing the prompt-building with a mocked model call. Include: "Can I get my money back if I cancel 3 hours before?", "What happens if only 8 of us turn up?", "Why can't I book?" (debt), "How much is Premium?".

Tests: changing a value in app_rules changes book_slot, the app display and the AI prompt with no code change; no hard-coded copies remain (a test greps the repo for the old constants).

Plan first.
```

## Now: matches and stats

The design prompts U0–U3 (now) and U4–U8 (next) are in **17 UI Redesign Prompts**.

### A1 Match spec and mock components

Run as two pull requests: **A1a** is the spec only (everything up to "No database code."), so Panos has the contract signatures early; **A1b** is the components, after U1.

```
Read docs/specs/05-product.md sections 2-8, docs/specs/06-coding.md section 4 and docs/specs/15-design.md. Write docs/specs/match-record.md: tables, columns, RLS, every security-definer function with its signature, and the exact signatures of contracts 1, 3 and 4. Contract 4 (send_notification) must list these types, which the payment code will send: guarantee_hold_failed, short_game_warning, top_up_charged, debt_created, debt_settled, cash_unpaid_prompt, booking_cancelled_by_venue, venue_closed_new_bookings, venue_condition_warning, spot_released, gipedo_result_needed. No database code. Then build FormChips, MatchRow and ScoreLine in components/match/ with components/ui and tokens, against typed mock data in lib/match/mock.ts, with Jest tests. Only touch components/match/, lib/match/ and docs/specs/.

Plan first.
```

### A2 Match record and notifications

```
Implement docs/specs/match-record.md as new migrations (match_record) with SQL tests. Result confirmation: one captain submits, the other side accepts or rejects; if nobody responds it confirms after 24 hours; a rejection makes it disputed. This replaces the 3-attempt logic for new matches only, and Gipedo Pano (P8) settles from it. Internal functions service_role only. Build create_match_for_booking, the match_result_confirmed view (with result, disputed flag, kickoff and end time in Cyprus time) and send_notification with every type in contract 4, push now, ready for WhatsApp later, respecting each user's notification settings. QR check-in: a per-match code the venue shows, scanned in the app. Only touch the files this prompt names.

Tests: confirm, reject, silence for 24 hours, a player who wasn't in the match can't submit; send_notification writes one row and one push per recipient and skips users who turned that type off.

Plan first.
```

### A3 Form, reminders, add to calendar

Run as two pull requests: **A3a** is lib/calendar only (the "Add to calendar" part and its calendar test), straight after A2, because P5 needs it; **A3b** is everything else.

```
Using the match record: form guide (last 5 confirmed matches, W/D/L chips, forfeit as "L (forfeit)") for players and named teams; recent matches on profiles; head-to-head between named teams; a job every 15 minutes sending reminders 24h and 2h before a player's games and after them (confirm score, vote, rate, rebook), all in Cyprus time; followed-team notifications; notification settings per type with quiet hours; profile preferences (position, foot, preferred days and times) and "players you play with most". Build lib/calendar: "Add to calendar" adds the event (venue name and address, pitch, kickoff and end, who's playing, link back to the booking) and updates or removes it when the booking moves or is cancelled; P5 uses it on the booking screens. Add a library only if needed, in its own small PR.

Tests for each: form order and forfeit; reminder windows at exactly 24h and 2h in Cyprus time across a daylight-saving change; quiet hours suppress pushes; calendar event updated on reschedule and removed on cancel.

Plan first.
```

### A4 Match page, man of the match, lineups

```
Build the match page (score, scorers, assists, lineups, man of the match, venue, date) with components/ui; it opens once the score is confirmed; captains add their own side's scorers for 24h and the count must match the score. Man-of-the-match voting: only checked-in players, one vote, not yourself, closes 24h after confirmation, ties shared. Lineups: formation presets per format (including 6 v 6), the captain drags players onto a drawn pitch, empty positions link to "Need players". If an SVG library is needed, add react-native-svg in its own small PR; it's native code, so it needs a new development build.

Tests for each rule: scorer count must equal the score; a second vote is refused; voting for yourself is refused; voting closes at 24h; ties are shared.

Plan first.
```

### A8 Post-match food and drink offers

```
After a player submits or confirms a score, show that venue's active post-match offers from venue_menu_items available at the current Cyprus time, with photo, price and offer text, using components/ui. Tapping one shows "Show this at the counter" with a short code; record views and redemptions. Only touch the files this prompt names.

Tests: which offers show at 14:00 vs 22:00; inactive items never show; a code can be redeemed once.

Plan first.
```

### A5 Ratings and skill level

```
Replace XP with a skill level from 1.0 to 7.0 (docs/specs/05-product.md section 4, docs/specs/12-playtomic.md section 5): five sign-up questions give a provisional level; after each confirmed competitive match an Elo-style update from both sides' average levels; a reliability % that rises with competitive matches and scales each change; each booking or post is "Competitive" or "Casual" and only competitive matches move levels. Ratings 1-10: only checked-in players, within 24h, not yourself, hidden individually, shown with 3+ votes, drop highest and lowest with 6+, down-weight raters who give everyone the same score; ratings move the level by at most 0.1. Add "balance teams" for pickup games.

Tests for each rule, including: a casual match changes nothing; a rating can't move the level by more than 0.1; the same-score rater is down-weighted.

Plan first.
```

## Next (21 November to 2 December)

### P7 Release build

```
Prepare the App Store build: hide Team Premium behind a flag if it isn't ready; app display name "Futty"; Premium shows €3.99 from the App Store product and the 7/14-day windows from app_rules; EAS production build and TestFlight upload; re-test account deletion on that build; switch off is_live for every unsigned venue; a demo account and a test venue for Apple's reviewer; list anything App Review is likely to reject (payments, account deletion, Sign in with Apple, location wording). Tests: a release checklist test that fails if any unsigned venue is live or the demo account can't book.

Plan first.
```

### P8 Gipedo Pano

```
Read docs/specs/13-payments-bookings.md section "Gipedo Pano". Rebuild it for new bookings (old bookings keep the old logic):
- each team's captain authorises a manual-capture hold for the pitch price plus 55 cents for each of the 10 players (6550 on a €60 pitch);
- only for games within 6 days; further ahead the app shows "Gipedo Pano can only be booked up to 6 days ahead." and the server refuses;
- settle from match_result_confirmed: loser's hold captured in full, winner's released; draw or dispute: half of each hold captured (amount_to_capture 3275), the rest released;
- each captain enters the result within 24 hours; if only one does, that result stands after 24 hours; if nobody does, 50/50;
- no opponent 24 hours before kickoff: the booking team chooses a normal booking at normal prices, or cancels free with its hold released;
- a team pulls out more than 6 hours before kickoff: 100 cents per player taken from its hold, rest released; less than 6 hours before: it counts as the loser and pays in full;
- switch on the settlement schedule.

Tests: win, loss, draw, dispute, one-sided result after 24h, no result, no opponent, pull-out at 7h and at 5h, a hold that expired, and running settlement twice.

Plan first.
```

### P6 Venue dashboard

```
Read docs/specs/05-product.md section 12 (launch items 1-11) and docs/specs/13-payments-bookings.md (cash, debt, credit, weather, blocking, 6 v 6). Build the launch dashboard with components/ui, phone-first, every common action in two taps or fewer:
calendar per pitch; booking roster with each player's payment choice and status and a tick for cash paid; run collection early; debt list with "mark settled"; credit balances per player; block pitches for a day or time range (new bookings only); flag "conditions may be unsuitable" for a day or slot (notifies booked players); a nudge when the forecast for a booked slot is bad at least 12 hours before kickoff; the "allow 6 v 6 on 5-a-side pitches" setting; offer a player to a short team; cancel a booking (full refund or credit, player's choice, Stripe fee owed by the venue); opening hours, prices, photos, amenities, menu; walk-in and phone bookings marked cash or card; check-in QR and no-shows; venue notifications and daily summary.
Only staff of that venue can do any of this (RLS and function checks).

Tests for every write path, including that staff of venue A can't touch venue B.

Plan first.
```

### P4d Venue payouts (Stripe Connect, decided 7 November)

```
Stripe Connect with separate charges and transfers (not destination charges), so cancellations, credit and the venue's Stripe fee on venue cancellations never need a clawback: onboard each venue (Express account) from the dashboard; after collection, transfer each venue its pitch parts minus anything it owes (venue_payables); credit money is transferred to the venue when it is created, and the venue owes it back as service. A daily reconciliation job checks that, for every booking, venue + Futty + Stripe fees + refunds + credit = what was taken, and alerts on any mismatch. Payments stay in test mode until a venue has signed and finished onboarding.

Tests: transfers equal the ledger for every scenario in P4a-P4c; a venue cancellation reduces the next transfer by the recorded Stripe fee; reconciliation flags a booking with a missing transfer.

Plan first.
```

### P11 Weather

```
Read docs/specs/13-payments-bookings.md section "Weather". Add an Edge Function that fetches the WeatherKit forecast for a venue's coordinates (key in Supabase secrets, signed JWT), caches it per venue for an hour, and returns rain chance, rain intensity, wind, temperature and thunderstorm risk for a booking's hours. Show a weather strip on the venue page, checkout and booking detail, and the banner "Heavy rain forecast. The venue may cancel this booking." when any threshold in app_rules is met. Beyond the forecast range show "Forecast available closer to the date". Show the Apple Weather mark and the data-sources link wherever forecast data appears.

Tests (fake WeatherKit): each threshold triggers the banner; below every threshold no banner; the cache prevents a second call within the hour; the out-of-range message appears.

Plan first.
```

### P12 6 v 6 switching

```
Read docs/specs/13-payments-bookings.md "Switching after booking". Only the booker can switch, until 6 hours before kickoff, and every player is notified. 5 v 5 -> 6 v 6: each player who paid 680 gets 100 as venue credit and the booking has 12 spots. 6 v 6 -> 5 v 5: only while 10 or fewer players have joined; each owes 100 more, charged with the after-match top-ups. When the booker paid for everyone, switching moves no money.

Tests: both directions with the exact credits and top-ups; refused at 5h59m; refused with 11 joined; refused for non-bookers; pay-all switch moves no money.

Plan first.
```

### A6 Shareable cards and A7 Team of the week

Unchanged from 06 Coding section 7. Use components/ui and the 15-design tokens for the card designs.
