# Futty – Match Record Spec

10 November 2026 · Owner: Anghelo (match track) · Written in prompt A1a (14 Claude Code Prompts), built in A2–A5 · Sources: 05 Product sections 2–8, 06 Coding section 4, 13 Payments & Bookings (wins where it disagrees), 15 Design (words on screen)

This is the database design for the match record: every table, its columns and RLS, every security-definer function with its signature, and the exact signatures of the three contracts the payment code depends on (1, 3 and 4 in 06 Coding section 4). There is no SQL in this document; A2 writes the migrations (`match_*`) from it.

## 1. Decisions (10 November, Anghelo)

These rules were missing or ambiguous in the specs and were decided while writing this document.

1. **Roster source.** Contract 2 (`booking_participants`) hasn't been built: the payment code keeps the roster in `booking_payment_shares`. Until it exists, `create_match_for_booking` reads the players from `booking_payment_shares` where `status in ('pending', 'authorized', 'paid', 'covered')`, the same set the cancellation code (P4b) treats as "holds a spot". When Panos builds `booking_participants` (guest names, venue-provided players), A2's function switches to it with no change to its signature (section 8).
2. **The 24-hour result clock starts at the end of the match.** Each match has one deadline, `result_deadline_at = ends_at + 24 hours` (Cyprus time), as in 13 (Gipedo Pano: "each team's captain enters it within 24 hours of the match"). A result submitted by one side and not answered stands at the deadline. If nobody submits, the match ends as `no_result`, which Gipedo Pano settles 50/50 (13).
3. **Captains.** Named teams: a captain of each side's team (`team_members.role = 'captain'`), and the booker on their own side. Pickup games (Bibs and Non-bibs): the booker submits the score for Bibs, and any player on Non-bibs can accept or reject it.
4. **Notification opt-outs.** Payment and cancellation types are always sent: they can't be turned off. Quiet hours still hold back their push, but the in-app row is always written. Match and social types follow each player's settings (section 7.3).
5. **Forfeits.** A match can end as a forfeit, recorded with the side that forfeited and the reason (`pulled_out` or `no_show`). It appears in `match_result_confirmed` as confirmed, with the other side as the winner. A forfeit counts as a loss in form ("L (forfeit)", 05 section 3) and in stats, but **never moves skill levels**. Gipedo Pano: a team that pulls out less than 6 hours before kickoff counts as the losing team (13), and P8 records it as a `pulled_out` forfeit. What is still open is listed in section 10.
6. **One notification type for a released spot.** `booking_spot_released` (already sent by P4b) **replaces `spot_released`** from the A1 prompt. `spot_released` isn't allowed.

## 1a. Decisions (10 November, Panos's review and Anghelo, A2)

1. **Check-in code is readable by venue staff.** It isn't stored as a hash only: it is stored in its own table, `match_check_in_codes`, that no app role can read, so `get_match_check_in_code` can return it to that venue's staff (section 5.4).
2. **A booking that goes back to `pending_payment`** (P4b's undo, when the booker's payment is undone): `create_match_for_booking` leaves the match as it is, with no error. It re-syncs when the booking is confirmed again, or the match is voided if the booking is cancelled (section 6.1).
3. **`kickoff_at` and `ends_at`** are computed with P4a's `booking_kickoff_at(day, time)` helper, not rebuilt from `booking_day` and `start_time` (section 2).
4. **Check-in window.** The QR check-in is accepted from 60 minutes before `kickoff_at` until 1 hour after `ends_at`. `captain_mark_attendance` stays open longer, from 60 minutes before `kickoff_at` until `result_deadline_at`, so a captain can still tick who played after the game (section 5.4).
5. **Pickup sides.** Players pick their own side (Bibs or Non-bibs) in the match screen, and the booker can move anyone. Sides lock once a result is submitted. A player with no side can't accept or reject the result. In a named game, sides come from team membership and aren't chosen (sections 4.3 and 5.4).
6. **Quiet hours.** There are no defaults: quiet hours are off until a player turns them on and picks the times (A3b). A push held in quiet hours is sent when the player's quiet hours end, except `match_reminder_24h` and `match_reminder_2h`, which are dropped if the game has already started by then (section 6.3).
7. **Notification types live in a table.** `notification_types` (`type`, `always_sent`) replaces the check constraint on `notifications.type`. A new type is added as a row there, not by editing a constraint.
8. **What the schema gives today.** Venue staff = the venue's owner (`venues.owner_profile_id`), see section 10. A booking is a named game when a squad post for it (`squad_posts.venue_booking_id`) led to a friendly match (`friendly_matches.squad_post_id`); there is no link from a booking to a league fixture yet, so `league_fixture_id` stays null until one exists. In a named game the booker's team is side `a` and the friendly's other team side `b`; a player who is a member of side `b`'s team (and not side `a`'s) plays on side `b`, everyone else on side `a`. Side `b` also lists every member of its team (decision 1b.1).

## 1b. Decisions (11 November, agreed with Panos)

1. **A pickup becomes a named game when a friendly is agreed later.** When `create_match_for_booking` is called again for a booking that is now linked to a friendly (`squad_posts.venue_booking_id` → `friendly_matches.squad_post_id`), a pickup match becomes a named game (section 6.1):
   - `kind = 'named'`, `friendly_match_id` set. Side `a` = the booker's team, side `b` = the opponent team; each side's `team_id` is set and its label is the team name.
   - Side `a` = every player holding a spot in the booking. Side `b` = every member of the opponent team (any `team_members.role`: captain, player or substitute), with no share if they hold no spot. A spot holder who is on the opponent team and not on the booker's team plays on `b`; a player in both teams stays on side `a`, the side they booked with.
   - Captains come from `team_members.role = 'captain'`; the booker captains side `a` (decision 3).
   - This replaces any sides players picked. Check-ins (`match_attendance`) and the check-in code are kept.
   - It happens only while the match is `scheduled`, before kickoff and with no result submitted. Otherwise (a submission, `confirmed`, `disputed`, `no_result`, `void`, or past kickoff) the function changes nothing and raises no error.
   - Calling it twice gives the same result. A booking that is named on its first call gets the same roster, and a member who leaves the opponent team before kickoff gets `left_at`.
2. **Only checked-in players count.** Because side `b` now lists every member of the opponent team, including substitutes who may not come, `match_players` is the squad, not who played. Form, stats, ratings, man of the match (voters and nominees) and skill levels count only players with a `match_attendance` row (QR check-in or ticked by their captain). This affects A3 (form guide, recent matches), A4 (man of the match), A5 (ratings and levels) and A7 (stats). The match result itself is not affected: it belongs to the two sides.
3. **Forfeits and team form are exceptions to 1b.2** (Anghelo, 11 November, to confirm with Panos):
   - **Forfeits:** in a confirmed forfeit, every player holding a spot (`share_id` set, `left_at` null) on either side gets it in their form, with or without a check-in. The forfeiting side gets **"L (forfeit)"** and the other side **"W"**. A squad member without a spot (a side `b` team member who held none) still needs a check-in.
   - **Team form** (a named team's last 5) counts every confirmed match that team played, whatever the check-ins. 1b.2 applies to player form and player stats only.
   - The app's helpers are `playerForm` and `teamForm` in `lib/match/form.ts` (A1b), the reference rules for tests and mocks. A3's `player_form` and `team_form` views follow the same rules, and the app reads form from those views (section 7).

## 2. Time

- Every time rule uses Cyprus time (Asia/Nicosia). SQL compares against `now()` and builds timestamps with `at time zone 'Asia/Nicosia'`. Edge Functions use `supabase/functions/_shared/cyprus-time.ts`. Booking days and times are never compared against UTC.
- `kickoff_at = booking_kickoff_at(booking_day, start_time)` and `ends_at = booking_kickoff_at(booking_day, end_time)`, both `timestamptz`, using P4a's helper (decision 1a.3), set from `venue_bookings` when the match is created and updated whenever the match is re-synced (section 6.1).
- Deadlines:
  - **Result:** `result_deadline_at = ends_at + 24 hours`.
  - **Scorers:** captains add their own side's scorers for 24 hours after the result is confirmed (05 section 3; A4).
  - **Man of the match:** voting closes 24 hours after the result is confirmed (05 section 3).
  - **Ratings:** "within 24 hours" (05 section 4); when that window starts is open (section 10).
- "Exactly at the deadline" counts as past it: a deadline at 20:00 closes the window at 20:00:00.

## 3. Match lifecycle

| Status | Meaning | Set by |
| --- | --- | --- |
| `scheduled` | Created from a confirmed booking; before `ends_at` | `create_match_for_booking` |
| `played` | `ends_at` has passed; waiting for a result | `match_jobs_tick` |
| `confirmed` | Result agreed, accepted, stood at the deadline, or a forfeit | `respond_to_match_result`, `match_jobs_tick`, `record_match_forfeit` |
| `disputed` | The other side rejected the submitted result | `respond_to_match_result` |
| `no_result` | Nobody submitted a result by `result_deadline_at` | `match_jobs_tick` |
| `void` | The booking was cancelled before the match ended | `create_match_for_booking`, `match_jobs_tick` |

- A result can be submitted from `kickoff_at` (in `scheduled` or `played`) until `result_deadline_at`.
- `confirmed`, `disputed`, `no_result` and `void` are final. Nothing in the app reopens them; a correction is a service_role operation.
- **Only `confirmed` matches count** for form, stats, levels and the match page (05 section 2), and forfeits don't count for levels (decision 5).
- This replaces the 3-attempt logic (`friendly_matches.score_attempts`, `league_fixtures.score_attempts`) **for new matches only**. Matches recorded before A2 keep the old tables and logic.
- `match_jobs_tick` runs every 15 minutes (the same cadence as reminders, 05 section 3). It is idempotent: running it twice changes nothing the second time.

## 4. Tables

Every table has RLS enabled. **No table can be written by `anon` or `authenticated` directly.** Every write goes through the functions in section 5, which check that the caller was in the match and that the window is open (05 section 2: "players can't edit stats directly"). `service_role` has full access. "Match members" below means profiles with a `match_players` row in that match.

### 4.1 `matches`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `booking_id` | uuid unique, null | → `venue_bookings.id`. Null only for a league fixture played without a Futty booking |
| `venue_id` | uuid null | → `venues.id` |
| `friendly_match_id` | uuid null | → `friendly_matches.id` (opposition and Gipedo Pano games) |
| `league_fixture_id` | uuid null | → `league_fixtures.id` |
| `kind` | text | `pickup` (Bibs v Non-bibs) or `named` (two named teams) |
| `format` | text | Copied from `venue_bookings.format` |
| `players_per_side` | integer | `capacity / 2` of the booking (5 for 5 v 5, 6 for 6 v 6) |
| `kickoff_at`, `ends_at` | timestamptz | Section 2 |
| `status` | text | Section 3 |
| `result_deadline_at` | timestamptz | `ends_at + 24 hours` |
| `side_a_score`, `side_b_score` | integer null, ≥ 0 | Set when confirmed by a result; null for a forfeit (section 10) |
| `forfeit_side` | text null | `a` or `b`: the side that forfeited |
| `forfeit_reason` | text null | `pulled_out` or `no_show`; set exactly when `forfeit_side` is set |
| `confirmed_at` | timestamptz null | When the status became `confirmed` |
| `confirmed_via` | text null | `agreed` (the other side accepted), `deadline` (stood at the deadline) or `forfeit` |
| `created_at`, `updated_at` | timestamptz | |

RLS: **select** for match members, the booker, captains of either named team, and staff of the venue. Players outside the match see confirmed matches only through the views in section 6 (form, recent matches, match page).

### 4.2 `match_sides`

| Column | Type | Notes |
| --- | --- | --- |
| `match_id` | uuid | → `matches.id`; primary key with `side` |
| `side` | text | `a` or `b` |
| `team_id` | uuid null | → `teams.id` for a named team |
| `label` | text | The team name, or `Bibs` (side a) / `Non-bibs` (side b) in a pickup game |
| `captain_profile_id` | uuid null | Named team: the booker on their own side, otherwise a team captain. Pickup: the booker on side a, null on side b (decision 3) |

The booker's side is always side `a`. Team form and head-to-head count named teams only (05 section 2). RLS: select as for `matches`.

### 4.3 `match_players`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `match_id` | uuid | |
| `profile_id` | uuid null | Null for a guest |
| `guest_name` | text null | Exactly one of `profile_id` and `guest_name` is set. Guests appear on the match page but never get stats (05 section 2) |
| `side` | text | `a` or `b`. Named game: from team membership, set again on every re-sync before kickoff (decision 1b.1). Pickup: null until the player picks a side or the booker moves them; locked once a result is submitted (decision 1a.5) |
| `position` | text null | Set from the lineup (A4) |
| `share_id` | uuid null | → `booking_payment_shares.id` the player came from (decision 1). Null for a side `b` team member without a spot (decision 1b.1) |
| `left_at` | timestamptz null | Set when the player's share stops holding a spot before kickoff (or, for a side `b` team member without a spot, when they leave that team); a player who left isn't in the match |
| `created_at` | timestamptz | |

Unique (`match_id`, `profile_id`) where `profile_id` is not null. RLS: select as for `matches`.

### 4.4 `match_attendance`

| Column | Type | Notes |
| --- | --- | --- |
| `match_id`, `profile_id` | uuid | Primary key together |
| `checked_in_at` | timestamptz | |
| `method` | text | `qr` (the player scanned the venue's code) or `captain` (ticked by their captain) |
| `checked_in_by` | uuid | The player themselves, or the captain who ticked them |

Checked-in players are the only ones who can vote for man of the match and rate (05 sections 3 and 4), and the only ones counted in form, stats, ratings, man of the match and levels (decision 1b.2). The venue's no-show record (05 section 10) is the match players without a row here. RLS: select for match members and venue staff.

### 4.5 `match_result_submissions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `match_id` | uuid | |
| `side` | text | The side that submitted |
| `side_a_score`, `side_b_score` | integer ≥ 0 | |
| `submitted_by` | uuid | |
| `submitted_at` | timestamptz | |
| `response` | text null | `accepted` or `rejected` |
| `responded_by`, `responded_at` | uuid null, timestamptz null | |

At most one submission per match: the second side accepts or rejects it, and can't submit its own (A2). RLS: select for match members.

### 4.6 `match_goals`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `match_id` | uuid | |
| `side` | text | The side that scored |
| `scorer_player_id` | uuid null | → `match_players.id`; null for an own goal or an unknown scorer |
| `assist_player_id` | uuid null | → `match_players.id` |
| `entered_by` | uuid | That side's captain |
| `created_at` | timestamptz | |

A side's goals must add up to its confirmed score (05 section 2). RLS: select for everyone who can see the match page (confirmed matches).

### 4.7 `motm_votes`

| Column | Type | Notes |
| --- | --- | --- |
| `match_id`, `voter_profile_id` | uuid | Primary key together: one vote each |
| `nominee_player_id` | uuid | → `match_players.id`, never the voter's own row |
| `created_at` | timestamptz | |

Ties are shared (05 section 3). RLS: a voter can select their own vote; nobody can select other people's votes. The result is shown through the match-page view.

### 4.8 `match_ratings` and `player_levels` (outline for A5)

- `match_ratings`: `match_id`, `rater_profile_id`, `rated_player_id`, `score` (1–10), `created_at`; unique per rater and rated player. Only checked-in players, not yourself, within the ratings window. RLS: a rater sees only their own ratings; individual ratings are never shown (05 section 3).
- `player_levels`: `profile_id` pk, `level` numeric(2,1) between 1.0 and 7.0, `provisional` boolean, `reliability_pct`, `competitive_matches`, `updated_at`; plus `player_level_history` (`profile_id`, `match_id`, `before`, `after`, `reason`). Read by everyone; written only by service_role.
- The maths (Elo constants, reliability, rating weighting) is A5's (section 10).

### 4.9 `match_lineups` (outline for A4)

`match_id`, `side`, `formation` (a preset for the format), `positions` jsonb (position key → `match_players.id`), `updated_by`, `updated_at`. Written by that side's captain or the booker before kickoff, through a function. RLS: select for match members, and for everyone once the match is confirmed.

### 4.9a `match_check_in_codes`

`match_id` pk → `matches.id`, `code` text, `created_at`. One random code per match, made when the match is created. RLS enabled with no policies and no grants to `anon` or `authenticated`: it is read only through `get_match_check_in_code` (venue staff) and `check_in_to_match` (compares it) (decision 1a.1).

### 4.9b `notification_types`

`type` text pk, `always_sent` boolean. One row per type in section 6.3; `notifications.type` and `notification_settings.type` reference it. Readable by everyone signed in; written only by migrations (decision 1a.7).

### 4.10 `notification_settings`

| Column | Type | Notes |
| --- | --- | --- |
| `profile_id` | uuid | Primary key with `type` |
| `type` | text | A type from section 7.3 marked "can be turned off" |
| `enabled` | boolean | |

Plus `notification_quiet_hours`: `profile_id` pk, `starts_local` time, `ends_local` time (Cyprus time). No row means no quiet hours: there are no defaults (section 10). RLS: a profile selects, inserts, updates and deletes only its own rows. A row for an "always sent" type is refused.

### 4.11 `notification_deliveries`

`id`, `notification_id` → `notifications.id`, `push_token_id` → `push_tokens.id`, `channel` (`push`; `whatsapp` later, A9), `status` (`queued`, `sending`, `sent`, `failed`, `held_quiet_hours`, `dropped`), `send_after` (when a held push becomes due: the end of the quiet hours), `sent_at`, `error`, `created_at`. One row per push. RLS: none for players; service_role only.

Pushes are sent by the `notify-send-pushes` Edge Function (every minute): it claims the due deliveries (`queued`, and `held_quiet_hours` whose `send_after` has passed) through `push_deliveries_due`, which hands each delivery out once, sends them to Expo, and records each outcome with `push_delivery_result`.

## 5. Functions

Every function is `security definer` with `set search_path = ''`. Functions marked **service_role** are revoked from `public`, `anon` and `authenticated` and granted to `service_role` only. Functions marked **authenticated** check `auth.uid()` against the match; they never trust an id, side, score or status the app sends without checking it. Errors are raised with these exact codes so the app can show plain words.

### 5.1 Contract and job functions (service_role)

| Function | Returns | What it does |
| --- | --- | --- |
| `create_match_for_booking(p_booking_id uuid)` | uuid | Contract 1, section 6.1 |
| `record_match_forfeit(p_match_id uuid, p_side text, p_reason text)` | void | Sets `forfeit_side`, `forfeit_reason`, `status = 'confirmed'`, `confirmed_via = 'forfeit'`, `confirmed_at = now()`. Refused once the match is `confirmed`, `no_result` or `void` (`match_closed`), for a side other than `a`/`b` (`invalid_side`) or a reason other than `pulled_out`/`no_show` (`invalid_reason`). Called by P8 for a Gipedo Pano pull-out under 6 hours (13) |
| `match_jobs_tick()` | jsonb (counts) | Every 15 minutes: `scheduled` → `played` after `ends_at`; at `result_deadline_at` an unanswered submission → `confirmed` (`confirmed_via = 'deadline'`) and no submission → `no_result`; voids matches whose booking was cancelled before `ends_at`. Idempotent |
| `send_notification(p_profile_id uuid, p_type text, p_data jsonb)` | void | Contract 4, section 6.3 |

### 5.2 Result (authenticated)

| Function | Returns | Checks and errors |
| --- | --- | --- |
| `submit_match_result(p_match_id uuid, p_side_a_score integer, p_side_b_score integer)` | void | The caller is a captain of a side (decision 3), else `not_captain`; between `kickoff_at` and `result_deadline_at`, else `result_window_closed`; no earlier submission, else `result_already_submitted`; scores 0 or more, else `invalid_score`. Notifies the other side (`match_result_submitted`) |
| `respond_to_match_result(p_match_id uuid, p_accept boolean)` | void | The caller is on the other side from the submission: its captain in a named game, any of its players in a pickup game (decision 3), else `not_allowed`; before `result_deadline_at`, else `result_window_closed`; not yet answered, else `already_answered`. Accept → `confirmed` (`confirmed_via = 'agreed'`); reject → `disputed`. Notifies both sides |

A player who wasn't in the match gets `not_in_match` from both (A2 test). Answering when nothing was submitted gives `no_result_submitted`; an answer that is neither accept nor reject gives `invalid_answer`. In a pickup game the submission notifies the other side and the players who haven't picked a side.

### 5.3 Goals, man of the match (authenticated, A4)

| Function | Returns | Checks and errors |
| --- | --- | --- |
| `set_match_goals(p_match_id uuid, p_goals jsonb)` | void | Replaces the caller's side's goals. The caller is that side's captain (`not_captain`); the match is `confirmed` and not a forfeit (`match_not_confirmed`); less than 24 hours after `confirmed_at` (`scorers_window_closed`); the number of goals equals that side's score (`score_mismatch`); scorers and assisters are players of the match (`not_in_match`) |
| `cast_motm_vote(p_match_id uuid, p_nominee_player_id uuid)` | void | The caller is checked in (`not_checked_in`); the match is `confirmed` (`match_not_confirmed`); less than 24 hours after `confirmed_at` (`voting_closed`); not their own row (`cannot_vote_for_self`); no earlier vote (`already_voted`) |

### 5.4 Check-in (A2)

| Function | Caller | What it does |
| --- | --- | --- |
| `get_match_check_in_code(p_match_id uuid)` returns text | authenticated, staff of the match's venue only (`not_venue_staff`) | Returns the per-match code the venue shows as a QR. Generated once per match, stored in `match_check_in_codes` (decision 1a.1) |
| `check_in_to_match(p_match_id uuid, p_code text)` returns void | authenticated | The caller is a player of the match (`not_in_match`); the code matches (`invalid_code`); the match isn't `void` and now is from `kickoff_at − 60 minutes` to before `ends_at + 1 hour` (`check_in_closed`, decision 1a.4). Idempotent |
| `captain_mark_attendance(p_match_id uuid, p_profile_ids uuid[])` returns void | authenticated | The caller is a captain (`not_captain`); every profile is a player on the captain's side (`not_in_match`); the match isn't `void` and now is from `kickoff_at − 60 minutes` to before `result_deadline_at` (`check_in_closed`) |
| `choose_match_side(p_match_id uuid, p_side text)` returns void | authenticated | Pickup only (`not_pickup`). The caller is a player of the match (`not_in_match`); `a` or `b`, and the booker stays on `a` (`invalid_side`, decision 3); no result submitted yet and the match is `scheduled` or `played` (`sides_locked`) |
| `set_match_player_side(p_match_id uuid, p_player_id uuid, p_side text)` returns void | authenticated | Pickup only (`not_pickup`). The caller is the booker (`not_booker`); the player row is in the match (`not_in_match`); `a`, `b` or null, and the booker stays on `a` (`invalid_side`); `sides_locked` as above |

## 6. The contracts

### 6.1 Contract 1: `create_match_for_booking`

```
create_match_for_booking(p_booking_id uuid) returns uuid
security definer, set search_path = '', service_role only
```

- **When the payment code calls it, and what happens when it fails:** see 13 Payments & Bookings, "Bookings and their match".
- **Called by** the payment code whenever a booking reaches `venue_bookings.status = 'confirmed'`, and again whenever its roster changes before kickoff (a share added, cancelled or refunded). Calling it is always safe.
- **Idempotent:** one match per booking (`matches.booking_id` is unique). A second call returns the same id and re-syncs the match:
  - kickoff, end and venue are copied again from the booking;
  - every share that holds a spot (`status in ('pending', 'authorized', 'paid', 'covered')`, decision 1) has a `match_players` row; a player whose share no longer holds a spot gets `left_at`;
  - in a named game, every member of side `b`'s team also has a row on side `b` (no share), and sides are set again from team membership (decision 1b.1);
  - after `kickoff_at` the roster is no longer changed.
- **Sides:** a booking linked to a friendly match or league fixture gets `kind = 'named'` with the two teams (the booker's team as side `a`); any other booking gets `kind = 'pickup'` with Bibs and Non-bibs. The booker is side `a`'s captain.
- **Friendly agreed later** (decision 1b.1, 11 November): a pickup match whose booking is now linked to a friendly becomes `named` on the next call, if it is `scheduled`, before kickoff and has no result submitted. Picked sides are replaced; check-ins are kept. Otherwise nothing changes and no error is raised.
- **Cancelled booking:** if the booking's status is `cancelled` and the match hasn't ended, the match becomes `void` (and stays void).
- **Back to `pending_payment`** (decision 1a.2): when the booking is `pending_payment` and its match already exists, the function returns the match id and changes nothing, with no error.
- **Errors:** `booking_not_found`; `booking_not_confirmed` when it is called on a booking that has never been confirmed (`pending_payment` and no match yet); an `owner_block` booking is refused (`not_a_game`).

### 6.2 Contract 3: `match_result_confirmed` view

Readable by `service_role` only. One row per match whose result is settled: `status in ('confirmed', 'disputed', 'no_result')`. P4c builds a stub with **exactly these columns** (returning no rows); A2 replaces it with `create or replace view`.

| Column | Type | Meaning |
| --- | --- | --- |
| `match_id` | uuid | |
| `booking_id` | uuid | |
| `venue_id` | uuid | |
| `friendly_match_id` | uuid null | Set for opposition and Gipedo Pano games |
| `league_fixture_id` | uuid null | |
| `side_a_team_id` | uuid null | Null in a pickup game |
| `side_b_team_id` | uuid null | |
| `side_a_score` | integer null | Null for a forfeit and `no_result` |
| `side_b_score` | integer null | |
| `outcome` | text null | `side_a_won`, `side_b_won` or `draw`; null for `disputed` and `no_result`. A forfeit gives the other side the win |
| `result_status` | text | `confirmed`, `disputed` or `no_result` |
| `disputed` | boolean | `result_status = 'disputed'` |
| `confirmed_via` | text null | `agreed`, `deadline` or `forfeit`; null unless confirmed |
| `forfeit_side` | text null | `a` or `b`: the side that forfeited; null otherwise |
| `forfeit_reason` | text null | `pulled_out` or `no_show`; null otherwise |
| `kickoff_at` | timestamptz | |
| `ends_at` | timestamptz | |
| `kickoff_local` | timestamp | `kickoff_at at time zone 'Asia/Nicosia'` |
| `ends_local` | timestamp | `ends_at at time zone 'Asia/Nicosia'` |
| `settled_at` | timestamptz | When the row reached its `result_status` |

How Gipedo Pano (13) reads it: `outcome` decides the loser; `disputed` or `no_result` splits 50/50; `draw` splits 50/50; a forfeit's loser is `forfeit_side`.

### 6.3 Contract 4: `send_notification`

```
send_notification(p_profile_id uuid, p_type text, p_data jsonb) returns void
security definer, set search_path = '', service_role only
```

The signature is the one the stub already has (`supabase/migrations/20261109010000_pay_venue_model_tables.sql`). A2 replaces the stub with `create or replace function` and keeps every type that is already allowed.

- **Data.** `p_data.title` and `p_data.body` are the text shown; write them following 15 (money with € and 2 decimals; never "authorize", "capture" or "void"). Every other key is a camelCase id or value the app uses to open the right screen: `bookingId`, `matchId`, `feeId`, `venueId`, `amountCents`. `title` and `body` are stored in their own columns and removed from `data`, as the stub does now.
- **What it does:**
  1. refuses a type that isn't in the list below (`unknown_notification_type`);
  2. writes **one** `notifications` row, always, whatever the settings;
  3. for a type the player turned off (section 4.10), stops there;
  4. otherwise sends **one push per push token** of that profile, recording a `notification_deliveries` row for each. During the player's quiet hours the push is held (`held_quiet_hours`) and sent when the quiet hours end; a held `match_reminder_24h` or `match_reminder_2h` whose match has kicked off by then is dropped (`dropped`) instead (decision 1a.6);
  5. WhatsApp comes later (A9) as a second channel chosen per type; the signature doesn't change.
- **Failures:** a failed push never fails the caller; it is recorded in `notification_deliveries`.

The allowed types. **Always sent** = can't be turned off (decision 4).

| Type | Sent by | Always sent |
| --- | --- | --- |
| `fixture_message` | existing | |
| `squad_post` | existing | |
| `booking_slot` | existing | |
| `booking_cancelled` | existing, payments | ✓ |
| `fixture_agreed` | existing | |
| `match_payment_due` | existing, payments | ✓ |
| `team_invite` | payments | |
| `booking_invite` | payments | |
| `venue_closed_new_bookings` | payments | ✓ |
| `guarantee_hold_failed` | payments (P4a) | ✓ |
| `booking_spot_released` | payments (P4b) | ✓ |
| `cancellation_fee_failed` | payments (P4b) | ✓ |
| `short_game_warning` | payments (P4c) | ✓ |
| `top_up_charged` | payments (P4c) | ✓ |
| `debt_created` | payments (P4c) | ✓ |
| `debt_settled` | payments (P4c) | ✓ |
| `cash_unpaid_prompt` | payments (P4c) | ✓ |
| `booking_cancelled_by_venue` | payments | ✓ |
| `venue_condition_warning` | payments | ✓ |
| `gipedo_result_needed` | payments (P8) | ✓ |
| `guarantee_charged` | payments (P4c): money taken from the booker's hold at collection | ✓ |
| `match_result_submitted` | match (A2) | |
| `match_result_confirmed` | match (A2) | |
| `match_result_disputed` | match (A2) | |
| `match_reminder_24h` | match (A3) | |
| `match_reminder_2h` | match (A3) | |
| `match_after_game` | match (A3): confirm score, vote, rate, rebook | |
| `motm_vote_open` | match (A4) | |
| `followed_team_match` | match (A3): "X play Y tonight" | |
| `followed_team_result` | match (A3): "Result: X 5–3 Y" | |
| `followed_team_opponent_wanted` | match (A3): "X want an opponent on Thursday" | |

`booking_spot_released` replaces `spot_released` from the A1 prompt (decision 6): `spot_released` isn't allowed. A later prompt that needs a new type adds it to this list in the same PR.

## 7. Form, stats and levels

- **Form guide** (A3): the last 5 `confirmed` matches a player played in (any team or pickup), or a named team played as that team, newest first: W, D or L. A forfeit shows as **"L (forfeit)"** for the side that forfeited (05 section 3).
- **Stats** (A7): built from confirmed matches only. A forfeit counts as a loss for the side that forfeited.
- **Skill level** (A5): only confirmed, competitive matches move levels; **forfeits never move levels**, and `disputed`, `no_result` and `void` matches never count.
- Guests never get stats (05 section 2).
- **Only checked-in players count** (decision 1b.2, 11 November): a player counts in form (A3), man of the match (A4), ratings and levels (A5) and stats (A7) only with a `match_attendance` row for the match. Being in `match_players` isn't enough, because a named game's side `b` lists the whole opponent team. Exceptions (decision 1b.3): a confirmed forfeit counts for every spot holder on both sides, and team form counts every confirmed match the team played.
- **Words on screen** (A1b; Anghelo, 11 November, to confirm with Panos): a forfeit shows "Forfeit" in place of the score, with "<team> pulled out" or "<team> didn't show". `disputed` shows "Disputed · not in stats" (not "won't count": a disputed Gipedo Pano game still splits the money 50/50, 13), `no_result` "No result entered", `played` "Waiting for the result", and `void` "Cancelled" (the word "void" is never shown, 17). The app's typed shapes for sections 4 and 6.2 are in `lib/match/types.ts`; they change whenever this document does.
- **The server computes form** (A1b, 11 November): `playerForm` and `teamForm` in `lib/match/form.ts` are the reference rules for tests and mocks only. The app reads form from the server views A3 builds (`player_form`, `team_form`), which must give the same results. Likewise `MatchResultConfirmed` in `lib/match/types.ts` only mirrors the `match_result_confirmed` view (6.2); the app reads the view's rows from the server.
- **Match page link** (A1b, 11 November): a match row shows a chevron and opens the match page only when the screen passes `onPress`, and screens pass it for `confirmed` matches only, because only confirmed matches have a match page (05 section 3).

These are read through views (`player_form`, `team_form`, `player_recent_matches`, `head_to_head`), which A3 and A7 define. Each view exposes confirmed matches only and never exposes individual ratings or votes.

## 8. Contract 2: what the match code needs from `booking_participants`

When Panos builds `booking_participants` (06 section 4), the match code needs, per spot: `booking_id`, `profile_id` or `guest_name`, `is_venue_provided`, whether the spot is still held, and the share id (if any). A venue-provided player plays (13) and gets a `match_players` row as a guest unless they have a profile. Until it exists, decision 1 applies.

## 9. Tests A2 must include

From the A2 prompt, plus this document:
- confirm, reject and 24 hours of silence (at exactly `ends_at + 24h`, in Cyprus time);
- no submission by the deadline → `no_result`;
- a player who wasn't in the match can't submit (`not_in_match`); a non-captain can't submit (`not_captain`);
- in a pickup game any Non-bibs player can accept;
- `record_match_forfeit` gives the other side the win in `match_result_confirmed`, with `forfeit_side` and `forfeit_reason`;
- `create_match_for_booking` twice returns the same id; a cancelled share's player gets `left_at`; a cancelled booking voids the match;
- `send_notification` writes one row and one push per token; skips the push for a type the user turned off; never skips an "always sent" type; holds pushes in quiet hours; refuses an unknown type, including `spot_released`.

## 10. Open questions (not decided here)

Each one is decided with Panos before the prompt that needs it, and written into this document in that PR.

1. **Forfeits:**
   - who may record a `no_show` forfeit (venue staff, the other captain, or both) and how it is proved (check-ins?);
   - whether a forfeit has a score (it is null for now);
   - whether a forfeit counts as a win in the winner's stats;
   - what happens to the match when a Gipedo Pano team pulls out more than 6 hours before kickoff (13 takes €1 per player; is the match `void`?).
2. ~~Check-in window~~: decided 10 November (decision 1a.4).
3. **Ratings window:** "within 24 hours" (05 section 4) of the match end or of confirmation.
4. **Skill level maths** (A5): Elo constants, the size of moves in the first 10 matches, reliability %, and down-weighting raters who give everyone the same score.
5. **Formation presets** per format, including 6 v 6 (A4).
6. ~~Quiet hours defaults~~: decided 10 November, none (decision 1a.6).
7. **A disputed match's goals:** whether scorers can be entered for a disputed match (for now, no: only confirmed).
8. **Venue staff accounts.** Venue staff is only the venue's owner (`venues.owner_profile_id`) today. Staff accounts (front desk, manager) come later, and they must also be allowed to get the check-in code (`get_match_check_in_code`) and see the venue's matches.
9. **The venue's no-show record** (section 4.4) counts match players without a check-in. Since decision 1b.1, side `b` of a named game lists every opponent team member, including substitutes who were never expected to come. Who counts as a no-show in a named game (spot holders only? the opponent's starting players?) is open (11 November).
10. **A pickup player who checked in but never picked a side** gets no form: `formSide` needs `match_players.side`, so a `match_attendance` row with no side counts for nothing. Whether such a player should get the result (and on which side), or be made to pick a side at check-in, is open (11 November).
