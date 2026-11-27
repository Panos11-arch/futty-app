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

## 1c. Decisions (11 November, Anghelo, A3b-1)

1. **Reminder times.** `match_reminder_24h` is due at `kickoff_at - 24 hours` and `match_reminder_2h` at `kickoff_at - 2 hours`: elapsed hours, like `result_deadline_at`, so across the 25 October clock change a 20:00 Sunday kickoff gets its 24h reminder at 21:00 on Saturday. Each is due until the next one (24h until 2h before, 2h until kickoff). `match_after_game` is due from `ends_at` until `result_deadline_at`. Only `scheduled` matches get the 24h and 2h reminders; `void` matches get nothing.
2. **Late bookings.** A reminder is sent only if the match existed when it fell due (`matches.created_at <= due time`): a game booked 5 hours ahead gets the 2h reminder only.
3. **Once each.** Each reminder and followed-team message is sent once per player (or follower) per match, however often the job runs (`match_notification_log`).
4. **Who's in and who hasn't paid** (24h and 2h reminders: "6 in, 2 haven't paid."). Who's in: players holding a spot (or guests) who haven't left; a named game's side `b` squad members without a spot aren't counted. Who hasn't paid uses the venue roster's meaning (13, "Cash at the venue": *paid in app*, *cash – not yet paid*, *cash – paid*), over the shares that hold a spot: a card share is paid in app once `authorized`, `paid` or `covered` and unpaid while `pending`; a cash share is paid once `cash_received_at` is set (ticked by the venue, or paid by card afterwards) and otherwise not yet paid (`booking_unpaid_count`).
5. **Followed teams** (`user_follows`, `target_type = 'team'`): `followed_team_match` goes with the 2h reminder ("Home FC play Away FC tonight at 20:00, <venue>.", "today" before 18:00); `followed_team_result` when a named match becomes `confirmed` ("Result: Home FC 5–3 Away FC"; a forfeit: "Result: Home FC v Away FC · Forfeit, Away FC pulled out" or "didn't show"); `followed_team_opponent_wanted` when a team posts "Need opposition" ("Lions want an opponent on Thursday.", the day in Cyprus time), from a trigger on `squad_posts`, which replaces the push `notify-squad-post` sent for opposition posts. People in the match are left out (they get the match's own notifications), a follower of both teams gets one message, and the poster isn't told about their own post.
6. **"Players you play with most"** (`player_teammates`): confirmed matches where both players checked in on the same side. It is personal: a player reads only their own list.
7. **Head-to-head** counts a forfeit as a win for one team and a loss for the other (section 7: a forfeit counts as a loss in stats), with no goals.

## 1d. Decisions (12 November, Anghelo, A3b-2b; to confirm with Panos)

1. **Notification settings groups** (section 4.10). The settings screen lists each type a player can turn off under one of three groups:
   - **Your games:** `match_reminder_24h`, `match_reminder_2h`, `match_after_game`, `match_result_submitted`, `match_result_confirmed`, `match_result_disputed`, `motm_vote_open`, `team_of_the_week` (A7a), `streak_badge` (A11), `fixture_agreed`, `fixture_message`, `booking_invite`.
   - **Teams you follow:** `followed_team_match`, `followed_team_result`, `followed_team_opponent_wanted`.
   - **Community:** `squad_post`, `booking_slot`, `team_invite`, `saved_search_match` (added 18 November with saved searches).
   - Which types exist and which are always sent come from `notification_types`. A switchable type the app doesn't know yet shows under "Other", so it is never hidden. A new type is added to a group in the same PR that adds it.
2. **Always sent.** Every `always_sent` type is listed under "Always sent" with no switch and one shared reason: "About money or a cancelled game, so we always send these."
3. **Profile preferences.** Position and preferred foot are the existing `profiles.position` and `profiles.preferred_foot`. Preferred days are `profiles.preferred_days text[]` (`mon` … `sun`) and preferred times `profiles.preferred_times text[]` (`morning`, `afternoon`, `evening`), each checked by a constraint and empty by default (migration `match_profile_prefs`). They are visible to their owner only: profiles' select policy shows a player only their own row, and `get_public_profile` and `get_public_profiles` don't return them. Later matching reads them on the server.
4. **Quiet hours on screen.** Off until the player turns them on and picks both times (decision 1a.6: no defaults). Times are Cyprus wall-clock times; a start later than the end spans midnight ("ends the next day"). Turning them off deletes the row.

## 1e. Decisions (12 November, Anghelo, A4a; to confirm with Panos)

1. **Who writes goals and lineups.** In a named game, each side's captain writes only their own side (`match_captain_side`). In a pickup game Non-bibs has no captain (decision 3), so the booker writes both Bibs and Non-bibs; `set_match_goals` takes an optional `p_side` for that (required when the caller may write both sides). A Non-bibs player can't.
2. **No man of the match for a forfeit.** No game was played: `cast_motm_vote` refuses it (`match_not_confirmed`, as for goals) and no `motm_vote_open` is sent. Disputed matches have no goals and no vote either (closes section 10, question 7).
3. **The man of the match is shown once voting closes** (`confirmed_at + 24 hours`). Until then the match page shows only that voting is open and the caller's own vote. Ties are shared: every player with the most votes is man of the match, each shown with their vote count. Nobody ever sees who voted for whom.
4. **Formation presets** (closes section 10, question 5). Outfield lines from back to front; the goalkeeper is always added. Stored in `match_formation_presets`:

   | Players per side | Presets |
   | --- | --- |
   | 5 | 1-2-1, 2-1-1, 2-2, 1-1-2 |
   | 6 | 2-2-1, 3-1-1, 2-1-2, 1-2-2 |
   | 7 | 2-3-1, 3-2-1, 3-3, 2-2-2 |
   | 9 | 3-3-2, 3-2-3, 4-3-1, 3-4-1 |
   | 11 | 4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 5-3-2, 4-5-1, 3-4-3 |

   Position keys: `gk`, then `d1`, `d2`, … for the first line, `f1`, … for the last line, and `m1`, … for every line between (4-2-3-1: `gk`, `d1`–`d4`, `m1`–`m5`, `f1`). The key is what `match_players.position` holds. (Team of the week no longer reads positions since decision 1k.)
5. **A change of players per side clears the lineups.** `create_match_for_booking` re-syncs `players_per_side` from the booking's capacity, so a 5 v 5 switched to 6 v 6 (P12) changes it. The saved lineups then no longer fit the presets, so a trigger on `matches.players_per_side` deletes that match's lineups and clears `match_players.position`; the captains set them again. P12 needs nothing more than calling `create_match_for_booking` after the switch.
6. **Smaller rules.** Scorers and assisters are players on that side who haven't left; guests can score (they never get stats); a null scorer is an own goal or an unknown scorer; an assist needs a scorer and can't be the scorer. The man of the match nominee is a player who checked in (1b.2), on either side, never a guest. A lineup can leave positions empty (the app shows "Need players"); each player fills at most one position.
7. **A position belongs to a side.** A player who changes side (`choose_match_side`, `set_match_player_side`, the named-game re-sync) or leaves the match (`left_at`) loses their `match_players.position` and is taken out of the lineup; the rest of the lineup stays. A pickup that becomes a named game (decision 1b.1) has its sides rebuilt, so all its lineups and positions are cleared, as in 1e.5. The match page also leaves out any lineup entry whose player isn't on that side.

## 1f. Decisions (17 November, Anghelo, A5a; to confirm with Panos)

> **Partly replaced by decision 1l (S13B, 22 November):** the starting level (1f.2), the update constants and the 1.0–7.0 scale (1f.3) and the 1–10 ratings (1f.4) are replaced; 1f.1, 1f.5 (default level now 4.0) and 1f.6 stand.

Skill level, ratings and competitive matches (05 section 4; 12 section 2, rows 2 and 3). Closes section 10, questions 3 and 4.

1. **Competitive or casual.** A flag on the match, not on the booking: `matches.competitive` stays null until a captain chooses, and `matches.is_competitive = coalesce(competitive, kind = 'named')`.
   - By default, named games are competitive and pickups are casual.
   - A pickup that becomes a named game (decision 1b.1) turns competitive, unless a captain already chose.
   - Any captain of either side (the booker on side a, or a team captain) changes it with `set_match_competitive`, while the match is `scheduled` and before `kickoff_at`. Passing null goes back to the default.
   - Only confirmed, competitive matches that aren't forfeits move levels. Disputed, `no_result` and `void` matches never do.
2. **Starting level.** The app calls `set_starting_level` once with the five sign-up answers. The level is 1.0 plus these points, capped to 1.0–6.0 and rounded to 0.1. It starts provisional, with 0% reliability.

   | Question | Answers and points |
   | --- | --- |
   | How long you've played | `under_1` 0 · `1_3` 0.3 · `3_10` 0.6 · `over_10` 0.8 |
   | Highest level you played at | `kickabout` 0 · `amateur` 0.7 (school or amateur league) · `semi_pro` 1.5 · `professional` 2.2 |
   | How often you play now | `rarely` 0 · `monthly` 0.2 · `weekly` 0.5 · `several_weekly` 0.7 |
   | Position | `gk`, `def`, `mid` or `fwd`; stored, adds nothing |
   | How you rate yourself, 1–10 | (rating − 1) / 9 × 1.5 |

   A player who never answered gets a default 3.0 (provisional) the first time they count in a competitive match. They can still answer the questions until they have played one competitive match; after that the answers are refused (`level_already_set`).
3. **The update after a match.** Every player who checked in (decision 1b.2) moves after a confirmed competitive match:
   - Expected result: E = 1 / (1 + 10^((opponents' average − own side's average) / 2)). The averages are the checked-in players' levels before the match. A side 1.0 level weaker expects 0.24.
   - Actual result: S = 1 for a win, 0.5 for a draw, 0 for a loss.
   - K = 0.40 for a player's first 10 competitive matches, then 0.20.
   - Move = K × (S − E) × (1 − reliability / 200).
   - Reliability = min(100, 5 × competitive matches), so it reaches 100% after 20 matches. At 100% a move is half its size.
   - A level is provisional until 5 competitive matches.
   - Then the ratings nudge it (decision 4). The level is clamped to 1.0–7.0 and stored with two decimals; the app shows one.
   - Worked examples: a first match between even sides moves the winners +0.20 and the losers −0.20. In a first match, a 2.0 side beating a 3.0 side moves +0.30 (an upset); the 3.0 side beating the 2.0 side moves +0.10.
   - `match_jobs_tick` runs the update once the ratings window (`confirmed_at + 24 hours`) and the check-in window (`result_deadline_at`) have both closed. It runs once per match (`matches.levels_applied_at`), oldest confirmation first.
   - Matches already settled when A5a shipped never move levels.
4. **Ratings.**
   - Only players who checked in can rate, and only players who checked in can be rated (never a guest or someone who left). Teammates and opponents can both be rated.
   - The score is 1–10. You can't rate yourself, and you rate each player once.
   - The match must be confirmed and not a forfeit. Ratings close 24 hours after `confirmed_at` (closes question 3).
   - A player's match rating needs 3 or more ratings. With 6 or more, one highest and one lowest are dropped.
   - A rater counts 0.25 only when they rated at least 3 players in that match and gave every one of them the same score. Giving the same score to some players while varying others is normal and keeps a weight of 1.
   - The rating nudges the level by 0.1 × (rating − 5.5) / 4.5, so never more than 0.1 either way.
   - Ratings in casual matches are kept and shown, but move nothing.
   - The match page shows each player's rating (one decimal, with 3 or more ratings) once the ratings window closes. Individual ratings are never shown: a rater sees only their own.
   - A rating uses the rater's check-in, so `venue_unmark_arrived` refuses it (`check_in_used`), as it does for a man-of-the-match vote.
5. **Balance teams** (`balance_match_teams`). The booker of a pickup can split it into two sides whose average levels are closest.
   - Who is split: players holding a spot or checked in, who haven't left. Guests stay where they are.
   - The sides differ in size by one at most, and the booker stays on side a.
   - A player with no level counts as 3.0, and nothing is written to `player_levels`.
   - Every split is tried for 16 players or fewer. Above that, players are dealt out greedily, then the best swaps are made.
   - It is locked as for `set_match_player_side` (`sides_locked`).
6. **XP is replaced by the level.** New matches never award or take XP. The app shows the level instead: one decimal, a "provisional" tag until 5 competitive matches, and the reliability %. `profiles.xp` and `teams.xp` stay, because legacy screens and the old 3-attempt score functions (which still take 20 XP for repeated disputes on old matches) read them. They are dropped once nothing reads them.

## 1g. Decisions (18 November, Anghelo, A7a; to confirm with Panos)

Season stats, leaderboards and team of the week (05 sections 3 and 8; 06 section 7, A7).

1. **No leaderboard minimum** (agreed with the founders, 18 November). Every player with a confirmed, counted match at a venue or in a city that year is on its leaderboards. `stats_min_appearances()` is 1. The win-rate board breaks ties by more appearances, so a 100% record over 5 games ranks above one over 1 game.
2. **Seasons.** The calendar year in Cyprus time for every confirmed match (league games included, so a player's year is complete); a league is also its own season; and all time. A match at 00:30 on 1 January in Cyprus belongs to the new year.
3. **Forfeits count as 3-0** (18 November). The forfeiting side gets a loss and the other side a win, for every spot holder with or without a check-in (as in form, 1b.3). The 3-0 counts in a team's goals for and against and clean sheets, but no player is credited with a goal. Closes section 10, question 1, "whether a forfeit counts as a win in the winner's stats" (yes, 3-0).
4. ~~**Team of the week** (agreed with the founders, 18 November).~~ **Replaced by decision 1k (19 November).** Kept below for history only: the single team for all of Futty, the points table and the lineup positions no longer pick the team.
   - **One team for all of Futty**, picked once a week by `match_jobs_tick` from Monday 09:00 Cyprus time, from every confirmed match of the week before (Monday 00:00 to Monday 00:00, Cyprus time).
   - **Points per match**, by the player's position in that match's lineup (1e.4; no position counts as a midfielder):

     | Position | Points |
     | --- | --- |
     | Forward | 3 per goal, 2 per assist |
     | Midfielder | 3 per assist, 2 per goal, 1 if their side scored 3 or more |
     | Defender | 4 for a clean sheet, 2 per goal, 1 per assist, 1 if their side conceded 1 or fewer |
     | Keeper | 5 for a clean sheet, 2 if their side conceded 1 or fewer |
     | Everyone | 1 for a win, 3 for man of the match (once voting has closed) |

     A forfeit counts as 3-0 (1g.3): the winners get the win, the clean sheet and "scored 3 or more", but no goals; the side that forfeited gets nothing.
   - **Score:** a player's average points per game that week. Their position is the one from their latest match that week.
   - **The team:** the best keeper, defender, midfielder and forward (each only if there is one), then the best other player who isn't a keeper. Ties go to more men of the match, then the higher average match rating, then more goals.
   - Each player picked gets `team_of_the_week` (it can be turned off; it's in "Your games").
   - **Later:** teams of the week for each level band, once there are enough rated games each week (about 12 or more at a venue).
5. **What is shown.** Season averages are aggregates of match ratings that the match page already shows to everyone signed in (1f.4); no individual rating or vote is ever shown.

## 1h. Decisions (18 November, Anghelo, A9; to confirm with Panos)

WhatsApp reminders (05 section 13; set-up and templates in `whatsapp-templates.md`).

1. **Off until switched on.** `whatsapp_settings.enabled` is false until the business account, the templates and the Cyprus price are in place. While it is off, players can't opt in or choose WhatsApp, and everything goes by push.
2. **Opting in.** A player adds their WhatsApp number (E.164; the app adds +357 to an 8-digit Cyprus number). A number can be active on one account only. They can stop in the app, or by replying STOP (or ΣΤΟΠ) on WhatsApp.
3. **Which reminders.** The 24-hour and 2-hour reminders and "How did it go?" (`match_after_game`), each set to push, WhatsApp or both. The default is push. The booker's "unpaid spot" alert has no notification type yet, so it isn't included; the reminders already say who hasn't paid.
4. **Never lost.** A player who chose WhatsApp but has no active number, or has opted out, gets push. Turning a type off turns it off on every channel. Quiet hours hold WhatsApp messages like pushes, and a held match reminder whose game has started is dropped.
5. **Cost.** Every message's pricing category is logged from Meta's delivery report. Its cost comes from `whatsapp_prices` (integer micro-euros, by country code and category), which ships empty until the Cyprus price is checked. `whatsapp_costs_by_month` totals it.

## 1i. Decisions (18 November, Anghelo, A11; to confirm with Panos)

Weekly streaks and streak badges.

1. **A streak** is Cyprus weeks (Monday to Sunday) in a row in which the player counted in at least one confirmed match (decisions 1b.2 and 1b.3). It counts **played weeks only**. It is worked out from the match record whenever it is read; only the badges are stored.
2. **Missed weeks.** One missed week is allowed and adds nothing; two missed weeks in a row end the streak. The week in progress is never held against the player: it counts as soon as they have a counted match in it, and is judged only once it ends.
3. **Cancelled games.** A cancelled game's week is its booking day's.
   - **Broken:** a week where the player cancelled their own spot, or, as the booker, cancelled the whole booking, ends the streak.
   - **The booker's cancellation and the other players:** a whole-booking cancellation breaks only the booker's streak. For the booking's other players that week is an ordinary missed week, so it uses their one allowed miss.
   - **Forgiven:** a week where the venue cancelled the game (any venue cancellation, weather and blocks included), or a Gipedo Pano game was cancelled because no opponent took it on (the booker chose to cancel, or it was cancelled automatically), isn't held against the player. The week is skipped, counted neither as played nor as missed, so missed, forgiven, missed is still two misses in a row.
   - **A counted match wins:** a week in which the player counted in a match is played, whatever else was cancelled that week.
4. **Badges.** Bronze 2 weeks, Silver 4, Gold 8, Platinum 12, Diamond 20, Champion 30. Each is awarded once, to every player who reaches it, Premium or not.
   - `match_jobs_tick` awards them once a week, from Monday 09:00 Cyprus time (as team of the week, 1g.4), from each player's **best** streak through the Sunday just ended. A match confirmed late still earns its badge the next Monday.
   - The player is told with `streak_badge` (can be turned off; "Your games"). Premium players: "You've earned the Bronze streak badge"; basic players: "You've earned the Bronze streak badge. Go Premium to unlock it." The words depend on Premium at the time the badge is awarded.
5. **What is shown.**
   - Every player sees their own current and best streak (the Streak card on their profile), with all six badges: earned or not yet, with the weeks each needs.
   - Badges are shown in colour only while the player is Premium (`profiles.is_premium`). Basic players see their earned badges greyed out, with "Go Premium to unlock streak badges".
   - A badge stays earned when Premium ends, and is shown greyed out again until the player is Premium again.
   - Other players' profiles show the badges that player has earned, greyed the same way, by that player's Premium status. A player's streak itself is read only by that player.

## 1j. Decisions (18 November, Anghelo, A10; to confirm with Panos)

> **Replaced by decision 1l (S13B, 22 November):** the intro, the steps and the ratings step are gone. A captain logs Score → Goals → Assists → Review; everyone else gets the Man of the Match vote. The pushes still open the after-game screen.

The post-match flow: after a match, an optional, skippable walk through what a player can still add.

1. **The steps, in order.**
   1. The score. Anyone who can enter it (a captain; the booker in a pickup) or answer it (the other side's captain in a named game; any Non-bibs player in a pickup) does it with the result panel. Everyone else sees "Waiting for your captain".
   2. Goals and assists. Captains only, as on the match page (decision 1e.1): in a pickup the booker writes both sides.
   3. The man of the match vote.
   4. Ratings.
2. **It stores nothing new.** Each step uses the match page's existing functions, hooks and windows (sections 2, 5.2, 5.3 and 5.5), and the server checks every write again. There is no migration.
3. **Which steps show.** A step is left out when its window has closed ("exactly at the deadline" counts as past it, section 2) or when this player has already done it:
   - **Score:** the player's part is done once a score is in that they can't answer (it came from their own side), or once they have answered. A pickup player with no side has nothing to do.
   - **Goals:** done once every side the captain writes has a goal row for each goal of its score. 0–0 has nothing to add.
   - **Vote:** done once the player has voted.
   - **Ratings:** done once the player has rated everyone they can.
   - Forfeits, disputed and `no_result` matches have no goals, vote or ratings (decisions 1e.2 and 1f.4). A void match has no steps at all.
4. **Not open yet.** Goals, the vote and ratings open only once the result is confirmed. While the result can still be entered or answered, they show with "This opens once the result is confirmed." and Skip. They show only to players who will be able to do them: a captain who writes a side for goals, and a player who has checked in for the vote and ratings.
5. **Moving through.** An intro comes first, saying: "Add the result and your stats. You'll see them at the end of the week, and they put you in the running for team of the week." It has Start and Skip. Every step has Skip. The last step's Done (or Skip) returns to the match page. The steps are worked out once, when the flow opens. With nothing left to do, the flow says "Nothing to add for this match." and offers the match page.
6. **Where it opens.**
   - Tapping the `match_after_game`, `match_result_confirmed` or `motm_vote_open` push, when it carries a `matchId` (`lib/push-tap.tsx`). The confirmed and vote-open pushes bring players back when the vote and ratings actually open. Every other match type still opens the match page.
   - The match page: "Add your stats", shown only while this player has at least one step left.
   - Home's Previous game card: a game that has a match (a booking, friendly or league fixture linked to one) offers "Add your stats". This rarely shows for now. Previous game lists only old-style results (a friendly's agreed score, a league fixture's score, a booking's self-reported result). A match made since A2 appears there only if its booking, friendly or fixture also has one of those. Until Previous game reads the new match record, the pushes and the match page are the main ways in.

## 1k. Team of the Week (decided by Panos, 19 November; shapes 22 November)

Replaces decision 1g.4. Recorded in S0; built in S14 and shown in Rankings (S15; `docs/specs/15-design.md` section 0.6, images 15 and 27).

1. **Two kinds of team.**
   - **League team:** that league's fixtures only.
   - **General team:** only non-league competitive games (bookings, squad games and friendly fixtures against another team, as long as the game wasn't switched to Friendly). League games never count towards it. Each week, per format, there is one for **All Cyprus** (all non-league competitive games), one per city and one per busy venue (decided 24 November).
   - **A busy venue** has 4 or more confirmed matches that week (decided 24 November). Only matches that feed the general team count: confirmed, non-league, competitive, any format (decided by Panos, 25 November).
   - **Friendly games never count** (decided by Panos and Anghelo, 25 November): a game switched to Friendly (`matches.competitive` false) is left out of every Team of the Week, league and general, and Player of the week.
   - Everyone can view both.
2. **Premium only.** Only players who are Futty Premium when the team is picked (`profiles.is_premium`, read on the server at that moment) can be selected. A non-Premium player is skipped, and the next best eligible player is picked instead.
3. **One team per format** (5, 6, 7, 9 and 11-a-side), from games in that format only. Shapes:

   | Format | Keeper | Defence | Midfield | Strikers |
   | --- | --- | --- | --- | --- |
   | 5-a-side | 1 | 1 | 2 | 1 |
   | 6-a-side | 1 | 2 | 2 | 1 |
   | 7-a-side | 1 | 2 | 3 | 1 |
   | 9-a-side | 1 | 3 | 3 | 2 |
   | 11-a-side | 1 | 4 | 3 | 3 |

4. **Selection, then placement. No positions are used.**
   1. **Selection:** the 5, 6, 7, 9 or 11 eligible players with the best average match rating (S13B) over the period. A player needs at least 1 match in the period (decided 24 November).
   2. **Placement** uses per-game figures from that period, not totals (decided 24 November):
      - the most goals per game → the striker slots;
      - the next, by goals + assists per game → midfield;
      - the rest → defence, except the one with the lowest goals + assists per game, who goes in goal.
      - Worked example: 10 goals in 1 game (10.0 per game) ranks above 20 goals in 5 games (4.0 per game).
   3. **Ties** at every step go to more games played in the period, then the higher rating, then the earlier sign-up (decided 24 November).
   4. **Too few eligible players:** the team shows the filled slots and marks the rest "No eligible player". It is never hidden (decided 24 November). Slots fill strikers, then midfield, then the keeper, then defence (decided by Panos, 25 November).
   5. **Player of the week:** the highest-rated player in that team, with the same tie rules (decided 24 November).
5. **The period and when it's picked:** kept from 1g.4. It is the week from Monday 00:00 to Monday 00:00, Cyprus time, picked by `match_jobs_tick` from Monday 09:00 Cyprus time.
6. **Selected players** get **one** `team_of_the_week` notification per week in total, however many teams they are in (decided by Panos, 25 November): "You're in the <area> <format> Team of the Week." (for example "You're in the All Cyprus 5-a-side Team of the Week."). It names their **best team** and opens it:
   - by scope: All Cyprus → league → city → venue;
   - then, within that scope, the format they played most that week;
   - then (an S14 assumption, flagged on PR #214) their higher rating in that team, then the smaller format, then the area name.
7. **A skipped player** (one who would have been picked but isn't Premium) gets **one** in-app notification per week in total (decided by Panos, 25 November; `team_of_the_week_skip_scope` returns `''`): "You'd have made the <area> <format> Team of the Week (<rating>). Get Futty Premium to be eligible.", naming their best team by the same order, with their rating in that team. It opens Premium (`premium_offers`).
   - It goes out as a push only if they switched on a new **"Premium and offers"** notification setting. That setting is off by default (Apple guideline 4.5.4).
8. **One general team per format a week** (decided by Panos, 26 November). Within the general teams of one format, a player is in at most one team a week.
   - Teams are picked in the order **All Cyprus → city → venue**. A player already in a higher team is passed over, and the next best eligible player fills his place.
   - Being passed over is **not a skip**: it brings no Premium nudge (item 7). A non-Premium player is still skipped (item 2) in a team he would have made, which can now be a lower team when the higher players are already picked above.
   - **League teams and other formats are separate:** a player can be in the 5-a-side and the 7-a-side general teams and in his league's team in the same week.
   - Two teams at the same level (two cities, or two venues) are picked in order of **more matches that week first, then the area name** (an assumption, flagged for Panos on the PR).
   - Notifications stay one of each per week in total (items 6 and 7).

## 1l. Logging after the game, ratings and levels (S13B; decided by Panos, 21 and 22 November)

Recorded and built in S13B. Spec 05 sections 3, 4 and 4.1 changed with Anghelo's OK. Rules on money stay spec 13's.

1. **No positions.** No position is logged or used for ratings, Team of the Week or stats (in 5-a-side a defender often scores and a forward doesn't, and many players never set one).
2. **Sides.** Pickup games keep Bibs v Non-bibs, picked before the game (the booker can move anyone). A saved team playing another team shows the two team names. A Booking v2 half pitch whose side B has its own captain (an opposition invite accepted, a matched opponent) is a game between two captains: side a = the booking's own players and side A's captain, side b = side B's players and side B's captain (`create_match_for_booking`, Panos's function). The same captain on both halves stays a pickup.
3. **Only a captain logs** (`log_match_result`), from kickoff until `result_deadline_at`: Score (both sides, always) → Goals → Assists → Review, with a progress bar (0, 33, 66, 100%). Goals: a top-down pitch, each player a circle with − / +. Both halves are open only when every player of the other side is in his own booking (a pickup, or he paid for both sides); otherwise only his half, the other locked with its score ("Logged by their captain"). The server refuses goals or assists for any player outside the sides he writes (`not_your_player`). Each logged side's goals plus own goals equal its score; assists are optional and never more than the side's goals. Review is text only.
4. **One captain** (a pickup, or both sides his): his Confirm confirms the score, which shows at once for stats and ratings. He can correct it for 24 hours (item 6). In a Competitive game the other side's players check it for levels (item 11). Nothing checks his goals and assists.
5. **Two captains:** each logs both scores and his own side's goals and assists. The first matching pair confirms the match. A pair that differs is a failed try: both captains are told (`match_score_mismatch`) and can change theirs; after `app_rules.match_score_tries` (3) failed tries the match is disputed (no ratings, levels or power ranking; in a league or tournament the organiser decides). A captain who changes his own side's score logs its goals and assists again; changing only the other side's keeps them. At the deadline: two different scores → disputed; one captain's score → confirmed (as before); none → `no_result`. A disputed Losers pay game settles 50/50, as spec 13 says. The chat between the two captains comes with S13.
6. **Corrections:** the same captains, their own sides' goals, assists and who played, for 24 hours after confirmation (`set_match_stats`).
   - **Two captains:** the agreed score is final (`score_locked`).
   - **A lone captain** (decided by Anghelo 25 November) can correct the score too, until it is accepted (item 11: then `score_locked`), from the match page's Edit stats: Score → Goals → Assists → Review. A side whose score changed has its goals redone so they add up; the other side's stats stay. Not for a Losers pay match, whose money settles from the score (`score_locked`).
   - The ratings are recomputed. Every player in the match is told "Score corrected" with the new score (`match_result_confirmed`, so its preference applies). A corrected score sends the "Check the score" card again (item 11). Levels are applied only once the game is final, so they use the corrected score.
7. **Who played** (decided by Anghelo 25 November). Ratings, no-shows and the Man of the Match vote follow check-ins (1b.2), and players rarely scan the venue's QR, so the captain confirms who played while logging:
   - On Goals, every player of the sides he writes counts as played. Each has a small "Didn't play" control; a player marked so is greyed out and can't score or assist (`player_did_not_play`).
   - On save (`log_match_result`, `set_match_stats`, per player `played` in `p_stats`) the server ticks every played player in (method `captain`, as `captain_mark_attendance`) and removes only captain ticks for players who didn't play.
   - A QR or venue check-in can't be removed (`cannot_remove_check_in`); nor can a player who has voted for Man of the Match be marked "Didn't play" (`check_in_used`). Neither shows the control.
   - Ticks change only until `result_deadline_at`, as `captain_mark_attendance` (`check_in_closed`); after it the control is locked, and a player without a check-in can't score.
   - **Known limit:** in a two-captain match a side's players are ticked only when their own captain logs. If side b's captain never logs, side a's score confirms at the deadline and side b's players who didn't check in by QR or at the venue get no rating (tested in `match-s13b-6-played`). Not changed.
8. **Ratings:** spec 05 section 4.1. Only players who checked in (1b.2), including the captain's ticks (item 7); ties for Man of the Match share the +0.3. Computed on confirmation, after a correction and when voting closes; `match_rating_shown` reads them, so season stats and Team of the Week use them. Past confirmed matches were rated once from what they had logged (from the score alone where no goals were logged). The 1–10 vote rows stay in `match_ratings`, unused; `rate_match_player` and `get_match_ratings` are no longer the app's.
9. **Levels:** spec 05 section 4, on 1.0–10.0, with the rules of item 11.
10. **Assists** are tallies per player (`match_assists`); goals stay one row per goal in `match_goals` (null scorer = own goal). Older matches keep their paired assists on their goals; both count.
11. **Levels like Playtomic** (decided by Panos 25 November; spec 05 section 4 items 2, 5 and 6).
   - **Game type.** Every game is Competitive by default (`matches.competitive` defaults to true; `is_competitive` reads it). Before kickoff the booker, or either captain of a named game, can switch it to Friendly (`set_match_competitive`, `competitive_locked` from kickoff, `not_captain` for anyone else). Everyone in the booking sees which it is. Matches created before 25 November keep their setting (named competitive, pickups casual). A Friendly game counts for nothing: no levels and no power ranking (decision 1m; S14b renamed the ranking's "friendly" category to "non-league"). Its score, stats and ratings still show. **A Friendly game counts for the player, never against others** (decided by Panos and Anghelo, 25 November; S14): it is left out of everything that ranks players publicly (Team of the Week and Player of the week, the venue leaderboards, the venue page's top players, and any future Player of the season or tournament, XP tier or badge), and still counts for personal progress (the player's own season stats, streaks and the match page). Streak badges follow the streak and count it (decided by Anghelo and confirmed by Panos, 25 November).
   - **Who moves.** Only Competitive, confirmed games that aren't forfeits; disputed and no-result games never count. Every player who played moves, and only when both sides have at least one Futty player who played (a profile, not a guest, not marked "Didn't play"). Otherwise the score, stats and ratings show but no level moves, and no card is sent.
   - **A pickup's score is checked** (one captain). The players marked as played on the side the booker isn't on get "Check the score" (`match_score_check`) on Home, on the match page and as a push: Accept or Reject (`respond_to_match_score`). If the booker didn't play, everyone who played except him gets it. Players on the booker's side, the booker and anyone marked "Didn't play" can't answer (`cannot_check_score`). No card in a Friendly game.
   - **The first answer settles it.** Accept counts the score for levels and closes the card for everyone; Reject holds it until the booker corrects it; later answers are ignored. No answer within 24 hours of the score being logged counts as accepted. An accepted score is final (`score_locked`); goals, assists and who played can still be corrected in their own windows.
   - **Reject.** The booker is told "Your score was rejected. Check it and fix it." (`match_score_rejected`). A score correction within his 24-hour window (and any score correction while the card is open) sends the card again to the same players, clears earlier answers and restarts the 24 hours. Still rejected when his window ends: no level moves for that game; stats and ratings stay. A Losers pay score can't be corrected, so a Reject there means no level change (the money is unaffected).
   - **Named games** (two captains) are unchanged: both enter the score and it must match.
   - **When levels change** (decided by Anghelo 25 November, for Panos's OK). Once, when the game is final: at the latest of the score being settled (Accept, 24 hours of silence, or a named game's confirmation), `confirmed_at + 24 hours` (the Man of the Match window, for the rating nudge) and `result_deadline_at` (who played). The result move and the nudge run together (`apply_match_levels`), so a level never needs reversing. An Accept settles the score but doesn't move levels sooner.

## 1m. Power ranking (S14b; decided by Panos, 22 and 25 November)

An app-wide team ranking, like FIFA's world ranking. Built in S14b (`match_power_ranking` migration) and shown in Rankings (S15; `docs/specs/15-design.md`, image 14). Every constant is in `app_rules` (`power_ranking_*`).

1. **One ranking per format** (5, 6, 7, 9 and 11-a-side). Every registered team (a `teams` row) starts at 1000 in each format.
2. **After each counted game:** new points = old points + K × (W − We).
   - W = 1 win, 0.5 draw, 0 loss.
   - We = 1 / (10^(−d/600) + 1), where d = the team's points minus the opponent's before the game.
   - K by importance: **non-league 20** (called "friendly" until 25 November), league match 40, tournament group match 40, tournament knockout 50.
   - Worked examples (tests): equal teams, a league win is +20 and −20; a non-league win is +10; a knockout win is +25; a 20-point favourite losing a league match is −20.8; a draw between equal teams is 0.
   - Points are stored unrounded; the screen rounds them.
3. **Penalty shootouts** (decided by Panos, 25 November). S14b built win, draw and loss only and stored the shootout values (0.75 for the winner, 0.5 for the loser) in `app_rules` (`power_ranking_w_shootout_win`, `power_ranking_w_shootout_loss`). S10A records shootouts (decision 1o) and switches `power_ranking_shootouts` on: a drawn game decided on penalties scores W 0.75 for the winner and 0.5 for the loser. Worked example (test): between equal teams, a knockout shootout win is +12.5 for the winner and 0 for the loser.
4. **Which games count.** Every confirmed game between two registered Futty teams, in any mode:
   - **Matches:** Competitive (a game switched to Friendly counts for nothing), not a forfeit, both sides a different registered team (`match_sides.team_id`), with a score. Category non-league.
   - **League fixtures:** league results still count through `league_fixtures`. Since S10 (decision 1n) a fixture gets a match when it's scheduled, and the match's final result is copied to the fixture, which then completes; fixtures made before S10 keep the old path. A completed fixture between two registered teams, without a forfeit or void result, counts in its league's format at K 40. Its kickoff is its scheduled day and time in Cyprus time; with no time, 00:00 on that day; with no day, when the fixture was created (decided by Anghelo, 26 November).
   - **Once only:** a match linked to a league fixture (`matches.league_fixture_id`) is left to the fixture.
   - **Tournaments** (S10A, decision 1o): a completed tournament fixture between two registered teams counts in the tournament's format, group K 40, knockout K 50. Its kickoff is its kick-off time; a result the organiser enters without one counts when it was entered. A tournament match is left to its fixture (`matches.tournament_fixture_id`), so it counts once.
   - **Never:** pickup games without two registered teams, forfeits, disputed, void and no-result games.
5. **When a game counts** (decided by Anghelo, 26 November): once it is final, at the same moment levels move (1l item 11): from the latest of `confirmed_at + 24 hours` and `result_deadline_at`, with a lone captain's score accepted (or 24 hours without an answer). A Rejected score that is never fixed never counts; corrected and final, it does.
6. **Order and corrections.** Games apply in kickoff order, once each. The job (`power_ranking_tick`, run by `match_jobs_tick` every 15 minutes) recalculates a format from the earliest game that needs it: a game that became final after a later one was applied, or an applied game that changed (a corrected score, a new status, a removed game or team).
7. **A deleted team.** A team with games can't be deleted (its matches and fixtures refer to it). Once its games are removed and it is deleted, its history goes with it, and its opponents are recalculated without those games.
8. **The list.** A team appears after 3 counted games in that format. After 60 days without one it is inactive and hidden; its points are kept, and it is listed again after its next game. Ties go to more games, then the team name. ▲▼ is the change of rank since Monday 00:00 Cyprus time.
9. **The breakdown.** A history row per team per game: points before and after, the change, the opponent, the score, the match type and the expected win chance (`get_power_ranking_history`).
10. **Server only.** Computed on the server. Signed-in players read the ranking (`get_power_ranking`), the breakdown and the history rows, and write nothing.

## 1n. Competitions (S10; decided 26 November)

Built in S10 (server: migrations `match_s10_league_seasons`, `match_s10_league_matches`, `match_s10_competition`; screens: the S10 page PR, image 13). Leagues only: tournaments (the Knockout tab, By group, penalties (AP) and group tables) are decision 1o.

1. **League fixtures create matches** (decided by Panos, 26 November).
   - When a fixture gets its day and time it gets exactly one match: kind `named`, side a = the home team, side b = the away team, each side's captain = that team's captain, `league_fixture_id` set, `booking_id` null. No booking is linked to a fixture yet, so `booking_id` stays null for now.
   - **Length** (decided by Anghelo, 26 November, for Panos's OK): a match with no booking lasts `app_rules.league_match_minutes`, 60 by default (spec 13's game length). A new value applies only to matches created after it changes. The result deadline is the end + 24 hours, as for every match.
   - **Players** (decided by Anghelo, 26 November): each side is that team's members, kept in step until kickoff and frozen after it. A member who joins before kickoff is added; one who leaves before kickoff is removed; after kickoff the list never changes. S13B's rules decide who played.
   - **The score** comes from the match flow with the named-game rule (both captains agree). Captains log it on Home → **Log the score**. When the match is final (the moment levels move, 1l item 11), its score is copied to the fixture (side a = home) and the fixture is completed, so the power ranking counts league and non-league games at the same moment. A match forfeit becomes the fixture's forfeit. A disputed or no-result match leaves the fixture open for the organiser (for Panos's OK).
   - **Always Competitive:** the server refuses Friendly on a league match (`league_always_competitive`).
   - **Rescheduled:** the match follows (kickoff, end, deadline) and keeps its length. **Void or forfeit:** the match is void, with no stats, ratings or levels. A result that had already counted leaves the power ranking and the stats. Levels already moved stay (a level never needs reversing, 1l item 11).
   - **Old fixtures:** fixtures made before S10 keep the old `score_attempts` path (`league_fixtures.match_flow` false). The old path refuses the others (`use_match_flow`). No backfill (pre-launch test data).
2. **Seasons are child rows** (decided 26 November; needs Panos's OK). A city league (the top-level row) keeps sign-up. Each season is a child of it ("Season N"), and a season's divisions are children of that season. A new season never deletes anything: past fixtures, matches and standings stay.
   - Starting a season creates "Season N" and moves the sign-up rows into it, so the next sign-up starts empty and the same teams can sign up again. The city league stays in sign-up; while a season is unfinished, a full sign-up doesn't start another.
   - Ending Season N records its champion (`champion_team_id`) and creates Season N+1 with Division 1 (top 10) and Division 2 (11th to 20th). Promotion and relegation record Division 1's winner as the champion and create the next season with the bottom 2 and top 2 swapped. Division 3 and below carry over with the same teams.
   - A standard league (always open) has no seasons: it is its own season.
3. **Standings** are computed from fixtures: 3 points a win, 1 a draw, plus any adjustment. **Tiebreakers** (the order S10A uses, decided 26 November): points, goal difference, goals scored, head-to-head points between the teams still level, then team name. The name stands in for the organiser's draw, which leagues don't have yet (for Panos). The Rules text is, word for word: "Teams level on points: goal difference, then goals scored, then head-to-head points, then team name." Promotion, relegation and the split use the same order. The old `league_teams` counters (played, won, drawn, lost, goals for and against) were dropped on 27 November; `pts_adjustment` stays and counts in the points.
4. **Matchday** (decided 26 November, for Panos's OK): week n of the season, Monday to Monday in Cyprus time, counted from the season's start date. A fixture with no day yet is "Not scheduled" and counts in the whole season once played. A rescheduled fixture moves to the week it's played in.
5. **Player of the season:** the highest average match rating with at least 3 matches (`competition_player_min_matches`); ties as Team of the Week. **Team of the season** (or of one matchday): Team of the Week's selection and placement (1k item 4) over that period. **Eligibility:** everyone (`app_rules.competition_awards_premium_only` stays false; decided by Panos, 27 November).
6. **Featured match:** the next scheduled fixture whose two teams have the best (lowest) combined standings position, ties to the earlier kickoff; with none, the latest result.
7. **Player stats** (rating, matches, goals, assists, Man of the match, clean sheets, goals conceded per match) are Premium only: the server refuses everyone else (`premium_required`, `profiles.is_premium`). The Stats tab is free. Both leave out players blocked either way and show a minor's first name only (A5).
   - **Premium reads** (decided by Anghelo, 27 November; OK'd by Panos; tested in `match-s11-1-premium`): `get_competition_player_stats` only. **Free** to every signed-in player: `get_competition_stats`, `get_competition_awards`, `get_competition_power_ranking`, `stats_leaderboards`, `venue_highlights`, Team of the Week, and a player's own stats. None is open to a signed-out caller. Every league page (city league seasons, divisions, standard leagues) is the same page with the same lock. Player of the tournament follows S10A.
8. **Power rankings tab:** the competition's teams in the order of their app-wide points for the format (1m). There is no separate count. ▲▼ is the change of place in this list since Monday 00:00 Cyprus time, the start of the current matchday.
9. **Not built** (decided by Panos, 26 November):
   - **No bells**, on the competition page or on match rows. Futty has no live events, so a bell would only say "kick-off". There is no subscriptions table and no new notification type; the star is S9's pin. A "Results of teams I follow" setting may come after launch.
   - **No Discussion section:** posts and their moderation come with S7b, which adds a competition's discussion.
   - **No followers count:** pins are private bookmarks, not follows (for Panos).

## 1o. Tournaments (S10A; decided by Panos 21 November, changed 22, 24 and 25 November; Anghelo 27 November)

Built in S10A (server: migrations `match_s10a_tournaments`, `match_s10a_tournament_play`, `match_s10a_power_shootouts`, `match_s10a_tournament_reads`; screens: the S10A page PR, images 13 and 17).

1. **Admins** (decided by Anghelo, 27 November). Founders run tournaments from an admin screen. Admins are the rows of `app_admins`: only service_role adds or removes one (in the dashboard), so an admin can't make another admin. `is_app_admin()` reads the caller, and every admin function checks it on the server (`not_admin`), never the app.
2. **A tournament** has a name, a venue (or none), an area, a country (`CY`), start and end dates, the team format, max teams, a squad, an entry fee per player, a registration deadline, the match length and a status: `coming_soon` (before sign-up opens), `registration`, `groups`, `knockout`, `finished`. The admin sets the match length and each kick-off time; nothing is in code.
   - **Dates are optional** (decided 22 November). Without them the events list, Home and the competition page show "Coming soon" instead of a date. Until sign-up opens, tapping the tournament anywhere opens the same "Coming soon" screen as leagues (S9, image 17), and Home's featured card shows "Coming soon" instead of Join.
   - **Entry fee** (decided by Anghelo, 27 November): stored in cents and shown only, as "€X per player, paid to the organiser". Nothing is collected in the app: no payment, ledger or payout. Collecting it would need new rules in spec 13 (who pays, the deadline, refunds), as a later step.
   - **No booking:** Futty books the pitches with the venue by phone. No pitch choice, venue payment or payout in the app.
3. **Registration.** A team's captain registers it while registration is open, before the deadline and while the tournament isn't full, with a kit colour and a squad.
   - **Badge:** the team's kit colour with its initials. The colours are the player kit tokens (`kitRed` … `kitWhite`).
   - **Squad** (decided by Anghelo, 27 November): the format's starters plus up to 2 subs (5 to 7 in 5-a-side), all members of the team. A player is in one squad per tournament (`player_in_other_squad`). The captain changes it until the registration deadline; after it only an admin can (an injury, say). Every change is logged (`tournament_squad_changes`). A tournament match's players are the two squads, not every member (unlike leagues).
4. **The Nuevo Campo structure** (the only one built; any other size is refused, `unsupported_structure`): 16 five-a-side teams in 4 groups of 4 (A–D), set or drawn by the admin. Each team plays the other three once: 3 points a win, 1 a draw, 0 a loss. The top 2 of each group reach the quarter-finals.
5. **Group ties:** points, goal difference, goals scored, head-to-head points between the teams still level (a mini-table when three are), then the organiser's draw, entered in the admin screen. The Rules line, word for word: "Teams level on points: goal difference, then goals scored, then head-to-head, then the organiser's draw." A tie for 1st or 2nd that only the draw can break holds the quarter-finals until the admin enters it.
6. **Knockout** (fixed, never random): QF1 = A1 v D2, QF2 = A2 v B1, QF3 = B2 v C1, QF4 = C2 v D1. **Semi-finals changed (decided by Anghelo and Panos, 24 November):** SF1 = winner QF1 v winner QF3; SF2 = winner QF2 v winner QF4, so a group's two teams can only meet in the final. Then the final. The quarter-finals fill when every group game has a result; each later round fills as its winners are known. Closing the tournament records the champion.
7. **Penalties.** A drawn knockout match goes to a penalty shootout (3 each, then sudden death), entered with the score. The server refuses a level knockout score without one (`shootout_required`), a shootout anywhere else (`shootout_not_allowed`) and one that can't happen (`invalid_shootout`: no winner, or a side above 3 not one ahead). Shown as "AP" with the shootout score.
8. **Matches and results.** A fixture with a kick-off time gets one named match with no booking: side a = home, side b = away, each team's captain, always Competitive (`tournament_always_competitive`), the tournament's match length, the result deadline its end + 24 hours.
   - Each captain logs the score, his team's scorers and assisters (S13B), plus the shootout in a drawn knockout game. Both scores and shootouts must match to confirm, with S13B's tries.
   - A mismatch that ends disputed, or no result, goes to the organiser, who enters the result in the admin screen. He can also correct any result.
   - A correction that would change a team already in a next-round game that has a result, or a logged score, is refused (`next_round_played`).
   - When the match is final (the moment levels move, 1l item 11) its result completes the fixture.
9. **Power ranking:** decision 1m items 3 and 4.
10. **The page** reads a tournament like a season (1n): Player stats (Premium only), Stats, Player and Team of the tournament, and Power rankings, plus the group tables, matches by group or round with AP, and the Knockout tab with its sources ("A1", "Winner QF1") until the teams are known. A player sees his own team's squad only.
11. **Flagged for Panos** (27 November): tournament games are named games without a league, so they feed the general Team of the Week, as other named games do. Not changed.

## 2. Time

- Every time rule uses Cyprus time (Asia/Nicosia). SQL compares against `now()` and builds timestamps with `at time zone 'Asia/Nicosia'`. Edge Functions use `supabase/functions/_shared/cyprus-time.ts`. Booking days and times are never compared against UTC.
- `kickoff_at = booking_kickoff_at(booking_day, start_time)` and `ends_at = booking_kickoff_at(booking_day, end_time)`, both `timestamptz`, using P4a's helper (decision 1a.3), set from `venue_bookings` when the match is created and updated whenever the match is re-synced (section 6.1).
- Deadlines:
  - **Result:** `result_deadline_at = ends_at + 24 hours`.
  - **Scorers:** captains add their own side's scorers for 24 hours after the result is confirmed (05 section 3; A4).
  - **Man of the match:** voting closes 24 hours after the result is confirmed (05 section 3).
  - **Ratings:** until 24 hours after the result is confirmed (`confirmed_at + 24 hours`, decision 1f.4).
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
| `competitive` | boolean null | Set by a captain before kickoff; null = the default (decision 1f.1) |
| `is_competitive` | boolean, generated | `coalesce(competitive, kind = 'named')`: only these matches move levels |
| `levels_applied_at` | timestamptz null | When the level update handled the match (decision 1f.3) |
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
| `method` | text | `qr` (the player scanned the venue's code), `captain` (ticked by their captain) or `venue` (ticked by the venue's staff, P6e) |
| `checked_in_by` | uuid | The player themselves, or the captain or staff member who ticked them |

Checked-in players are the only ones who can vote for man of the match and rate (05 sections 3 and 4), and the only ones counted in form, stats, ratings, man of the match and levels (decision 1b.2). The venue's no-show record (05 section 10; 13 "No-shows", decided 17 November) is the players holding a spot (`share_id` set, its share still in, `left_at` null) without a row here, final at `result_deadline_at`. RLS: select for match members and venue staff.

**Showed up (Profile tile; decided by Panos, 26 November).** The share of this season's games where you held a spot that you turned up to: checked in ÷ (checked in + no-show + late cancel), as a whole percentage (`round`), shown as "–" until 3 games count. The season is the Cyprus calendar year, and the tile follows the Profile's format filter. Server: `my_profile_showed_up(p_format)`, the caller's own figures only.

- **Checked in and no-show** count only in games that went ahead and are final: status `confirmed`, past `result_deadline_at`, and you held a spot (`match_spot_holder`). A cancelled booking or a void, no-result or not-yet-final game never gives anyone a no-show.
- **Late cancel** (a miss): you cancelled after spec 13's free-cancellation cut-off and the server recorded it as your own `booking_cancellation_lines` row with `"window" = 'late'`. It counts once per booking, by the booking's Cyprus day. When a booker cancels the whole booking late, only the booker gets the miss; the other players' lines are `'other'`. Free-hour and middle-window cancels are not misses.
- **Friendly games count.** **Forfeits don't count either way**, as a check-in, a no-show or a late cancel.
- **Not recorded as late today (not counted as misses):**
  1. A late cancel of a share with no money on it yet (a pending share, or cash not ticked): the line's `window` is null.
  2. Leaving a Losers-pay game: `losers_pay_leave` works out the window but doesn't store it.

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
| `sort` | integer | The order the captain entered them (1, 2, …) |
| `scorer_player_id` | uuid null | → `match_players.id`; null for an own goal or an unknown scorer |
| `assist_player_id` | uuid null | → `match_players.id`; only with a scorer |
| `entered_by` | uuid | That side's captain (or the pickup booker, decision 1e.1) |
| `created_at` | timestamptz | |

A side's goals must add up to its confirmed score (05 section 2). RLS: select for everyone who can see the match page (`match_page_visible`: match members, and everyone signed in once confirmed).

### 4.7 `motm_votes`

| Column | Type | Notes |
| --- | --- | --- |
| `match_id`, `voter_profile_id` | uuid | Primary key together: one vote each |
| `nominee_player_id` | uuid | → `match_players.id`, never the voter's own row |
| `created_at` | timestamptz | |

Ties are shared (05 section 3). RLS: a voter can select their own vote; nobody can select other people's votes. The result is shown through `get_match_page`, once voting closes (decision 1e.3).

### 4.8 `match_ratings` and `player_levels` (A5a, decision 1f)

- `match_ratings`: `match_id`, `rater_profile_id`, `rated_player_id` (→ `match_players.id`), `score` (1–10), `created_at`; primary key (`match_id`, `rater_profile_id`, `rated_player_id`). Written only through `rate_match_player`. RLS: a rater selects only their own ratings; individual ratings are never shown (05 section 3).
- `player_levels`: `profile_id` pk, `level` numeric(4,2) between 1.00 and 7.00 (shown with one decimal), `provisional`, `reliability_pct` (0–100), `competitive_matches`, `source` (`questionnaire` or `default`), `updated_at`. Readable by everyone signed in; written only by `set_starting_level` and `apply_match_levels`.
- `player_level_history`: `id`, `profile_id`, `match_id` (null only for `start`), `reason` (`start`, `result` or `ratings`), `level_before`, `level_after`, `created_at`; unique (`profile_id`, `match_id`, `reason`). Readable by everyone signed in (the level trend in A7).
- `player_level_answers`: `profile_id` pk, `years_played`, `highest_level`, `play_frequency`, `position`, `self_rating`, `created_at`. Readable only by its owner.

### 4.8a `streak_badge_levels`, `streak_badges` and `streak_badge_runs` (A11, decision 1i)

- `streak_badge_levels`: `badge` pk (`bronze`, `silver`, `gold`, `platinum`, `diamond`, `champion`), `label`, `weeks` (2, 4, 8, 12, 20, 30), `sort`. Readable by everyone signed in; written only by migrations.
- `streak_badges`: `profile_id`, `badge`, `awarded_at`; primary key (`profile_id`, `badge`), so each badge once per player. Readable by everyone signed in (shown on profiles), never by anon; written only by `streak_badges_tick`.
- `streak_badge_runs`: `week_start` pk (a Monday), `awarded`, `ran_at`: one row per week the badge step has run. service_role only.

### 4.9 `match_lineups` (outline for A4)

`match_id`, `side` (primary key together), `formation` (a preset for the match's `players_per_side`, from `match_formation_presets`, decision 1e.4), `positions` jsonb (position key → `match_players.id`; empty positions are left out), `updated_by`, `updated_at`. Written by that side's captain (or the booker, for either side of a pickup) before kickoff, through `set_match_lineup`, which also sets `match_players.position`. Cleared when `players_per_side` changes or a pickup becomes a named game (decisions 1e.5, 1e.7); a player who changes side or leaves is taken out (1e.7). RLS: select for match members, and for everyone once the match is confirmed (`match_page_visible`). `match_formation_presets` (`players_per_side`, `formation`, `sort`) is readable by everyone signed in; `match_formation_positions(formation)` returns its position keys.

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
| `match_reminders_tick(p_now timestamptz default now())` | jsonb (counts) | A3b: the reminders and `followed_team_match` due at `p_now` (decision 1c). `match_jobs_tick` calls it with `now()` after its own steps |

### 5.2 Result (authenticated)

| Function | Returns | Checks and errors |
| --- | --- | --- |
| `submit_match_result(p_match_id uuid, p_side_a_score integer, p_side_b_score integer)` | void | The caller is a captain of a side (decision 3), else `not_captain`; between `kickoff_at` and `result_deadline_at`, else `result_window_closed`; no earlier submission, else `result_already_submitted`; scores 0 or more, else `invalid_score`. Notifies the other side (`match_result_submitted`) |
| `respond_to_match_result(p_match_id uuid, p_accept boolean)` | void | The caller is on the other side from the submission: its captain in a named game, any of its players in a pickup game (decision 3), else `not_allowed`; before `result_deadline_at`, else `result_window_closed`; not yet answered, else `already_answered`. Accept → `confirmed` (`confirmed_via = 'agreed'`); reject → `disputed`. Notifies both sides |

A player who wasn't in the match gets `not_in_match` from both (A2 test). Answering when nothing was submitted gives `no_result_submitted`; an answer that is neither accept nor reject gives `invalid_answer`. In a pickup game the submission notifies the other side and the players who haven't picked a side.

### 5.3 Goals, man of the match (authenticated, A4)

| Function | Returns | Checks and errors |
| --- | --- | --- |
| `set_match_goals(p_match_id uuid, p_goals jsonb, p_side text default null)` | void | Replaces the caller's side's goals. `p_goals` = `[{"scorerPlayerId": uuid or null, "assistPlayerId": uuid or null}]`. The caller is in the match (`not_in_match`) and writes that side: its captain, or the booker for either side of a pickup (`not_captain`, decision 1e.1); `p_side` is `a`/`b`, and given when the caller may write both sides (`invalid_side`); the match is `confirmed` and not a forfeit (`match_not_confirmed`, so disputed matches too); less than 24 hours after `confirmed_at` (`scorers_window_closed`); `p_goals` is an array of goals with valid ids, an assist only with a scorer and not the scorer (`invalid_goals`); the number of goals equals that side's score (`score_mismatch`); scorers and assisters are players on that side who haven't left (`not_in_match`) |
| `cast_motm_vote(p_match_id uuid, p_nominee_player_id uuid)` | void | The caller checked in (`not_checked_in`); the match is `confirmed` and not a forfeit (`match_not_confirmed`, decision 1e.2); less than 24 hours after `confirmed_at` (`voting_closed`); not their own row (`cannot_vote_for_self`); the nominee is a player of the match who checked in and hasn't left, not a guest (`nominee_not_eligible`); no earlier vote (`already_voted`) |
| `set_match_lineup(p_match_id uuid, p_side text, p_formation text, p_positions jsonb)` | void | `p_side` is `a` or `b` (`invalid_side`); the caller writes that side as for goals (`not_in_match`, `not_captain`); the match is `scheduled` and before `kickoff_at` (`lineup_locked`); the formation is a preset for the match's `players_per_side` (`unknown_formation`); `p_positions` is an object whose keys are the formation's positions and whose values are player ids or null (`invalid_position`); no player twice (`duplicate_player`); every player is on that side and hasn't left (`not_in_match`). Upserts the lineup and sets `match_players.position` for that side |
| `get_match_page(p_match_id uuid)` | jsonb | Match members at any time, everyone signed in once `confirmed`; anyone else `match_not_found`. Returns `matchId`, `status`, `kind`, `format`, `playersPerSide`, `kickoffAt`, `kickoffLocal` (Cyprus), `endsAt`, `venue {id, name}`, `sides [{side, label, teamId, score}]`, `forfeit {side, reason}`, `confirmedAt`, `scorersOpenUntil`, `motmVotingClosesAt`, `motmOpen`, `goals [{side, scorer, assist}]`, `motm [{…player, votes}]` (all tied leaders, once voting closes), `myVote` (the caller's nominee), `lineups [{side, formation, positions [{key, …player}]}]`. A player is `{playerId, profileId, name, guestName}`. Score, goals and man of the match only for a confirmed match that isn't a forfeit |

`motm_vote_open` is sent through `send_notification` when a match becomes `confirmed` other than by forfeit (agreed, or at the deadline), to every player who checked in and hasn't left, and to a player ticked in by their captain later while voting is open; once per player per match (`match_notification_log`). Text: "Man of the match" / "Bibs 4–2 Non-bibs. Who was man of the match? Voting closes tomorrow at 20:00." (Cyprus time).

### 5.4 Check-in (A2)

| Function | Caller | What it does |
| --- | --- | --- |
| `get_match_check_in_code(p_match_id uuid)` returns text | authenticated, staff of the match's venue only (`not_venue_staff`) | Returns the per-match code the venue shows as a QR. Generated once per match, stored in `match_check_in_codes` (decision 1a.1) |
| `check_in_to_match(p_match_id uuid, p_code text)` returns void | authenticated | The caller is a player of the match (`not_in_match`); the code matches (`invalid_code`); the match isn't `void` and now is from `kickoff_at − 60 minutes` to before `ends_at + 1 hour` (`check_in_closed`, decision 1a.4). Idempotent |
| `captain_mark_attendance(p_match_id uuid, p_profile_ids uuid[])` returns void | authenticated | The caller is a captain (`not_captain`); every profile is a player on the captain's side (`not_in_match`); the match isn't `void` and now is from `kickoff_at − 60 minutes` to before `result_deadline_at` (`check_in_closed`) |
| `venue_mark_arrived(p_match_id uuid, p_profile_id uuid)` returns void | authenticated, staff of the match's venue only (`not_venue_staff`) | P6e. The player holds a spot (`not_in_match`); the match isn't `void` and now is from `kickoff_at − 60 minutes` to before `result_deadline_at` (`check_in_closed`). Writes method `venue`. Idempotent: an existing check-in is kept |
| `venue_unmark_arrived(p_match_id uuid, p_profile_id uuid)` returns void | authenticated, staff of the match's venue only | P6e. The same checks. Removes only a `venue` row (`not_venue_check_in`, `not_checked_in`). Refused once the player has voted for man of the match or rated a player in the match (`check_in_used`; ratings added by A5a) |
| `choose_match_side(p_match_id uuid, p_side text)` returns void | authenticated | Pickup only (`not_pickup`). The caller is a player of the match (`not_in_match`); `a` or `b`, and the booker stays on `a` (`invalid_side`, decision 3); no result submitted yet and the match is `scheduled` or `played` (`sides_locked`) |
| `set_match_player_side(p_match_id uuid, p_player_id uuid, p_side text)` returns void | authenticated | Pickup only (`not_pickup`). The caller is the booker (`not_booker`); the player row is in the match (`not_in_match`); `a`, `b` or null, and the booker stays on `a` (`invalid_side`); `sides_locked` as above |

### 5.5 Levels, ratings, balance teams (A5a, decision 1f)

| Function | Caller | What it does |
| --- | --- | --- |
| `set_starting_level(p_years text, p_highest text, p_frequency text, p_position text, p_self_rating integer)` returns jsonb `{level, provisional, reliabilityPct, competitiveMatches}` | authenticated | The starting level from the five answers (1f.2). Refused when the caller already answered, or has a default level and a competitive match (`level_already_set`); an unknown answer gives `invalid_answer` |
| `set_match_competitive(p_match_id uuid, p_competitive boolean)` returns void | authenticated | Any captain (`not_captain`), while `scheduled` and before kickoff (`competitive_locked`); null = back to the default |
| `rate_match_player(p_match_id uuid, p_player_id uuid, p_score integer)` returns void | authenticated | `match_not_found`; the rater checked in (`not_checked_in`); confirmed and not a forfeit (`match_not_confirmed`); before `confirmed_at + 24 hours` (`rating_closed`); not their own row (`cannot_rate_self`); the rated row is a profile who checked in and hasn't left (`player_not_eligible`); 1–10 (`invalid_score`); once per player (`already_rated`) |
| `get_match_ratings(p_match_id uuid)` returns jsonb | authenticated, as `get_match_page` (`match_not_found`) | `ratingsOpen`, `ratingsCloseAt`, `players [{playerId, profileId, rating, count}]` (3 or more ratings, one decimal, only once the window has closed) and `myRatings [{playerId, score}]` (the caller's own) |
| `balance_match_teams(p_match_id uuid)` returns jsonb `{sideA, sideB: {players, average}}` | authenticated, the booker of a pickup (`not_pickup`, `not_booker`, `sides_locked`) | Decision 1f.5. Writes `match_players.side` |
| `apply_match_levels(p_match_id uuid, p_now timestamptz default now())` returns text | service_role | The update for one match (1f.3): `applied`, `skipped` (settled but moves nothing), `not_yet` or `already` |
| `match_levels_tick(p_now timestamptz default now())` returns integer | service_role | Runs `apply_match_levels` for every confirmed match whose windows have closed. `match_jobs_tick` calls it and returns its count as `levels` |
| `match_rating_for(p_match_id uuid, p_player_id uuid)` returns jsonb `{rating, count}`; `match_rater_weight`; `match_level_start` | service_role | Helpers for the rules above |

### 5.6 Streaks (A11, decision 1i)

| Function | Caller | What it does |
| --- | --- | --- |
| `get_my_streak()` returns jsonb | authenticated (`not_authenticated`) | The caller's own streak only: `current`, `best`, `isPremium`, `badges [{badge, label, weeks, earned, awardedAt}]` (all six levels, in order) |
| `get_player_streak_badges(p_profile_id uuid)` returns jsonb | authenticated (`not_authenticated`) | `inColour` (that player's `is_premium`) and `badges [{badge, label, weeks, awardedAt}]`, earned badges only |
| `player_streak_weeks(p_profile_id uuid, p_now timestamptz)` returns table (`week_start`, `state`) | service_role | Each week's `played`, `broken` or `forgiven` (1i.3) up to the week of `p_now`; missed weeks are the ones not listed |
| `player_streak(p_profile_id uuid, p_now timestamptz default now())` returns table (`current_weeks`, `best_weeks`) | service_role | The streak at `p_now` (1i.1–1i.3) |
| `streak_badges_tick(p_now timestamptz default now())` returns integer | service_role | The weekly badge step (1i.4): once a week from Monday 09:00 Cyprus time; returns how many badges it awarded. `match_jobs_tick` calls it and returns its count as `streak_badges` |

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
  5. WhatsApp (A9, decision 1h): for a WhatsApp-capable type the player set to WhatsApp or both, with an active number and WhatsApp switched on, one WhatsApp delivery (`channel = 'whatsapp'`, the number in `phone_e164`) instead of, or as well as, the pushes. The signature doesn't change. `notify-send-whatsapp` sends them with `whatsapp_deliveries_due` and `whatsapp_delivery_result`; `whatsapp-webhook` records delivery reports and STOP replies.
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
| `gipedo_opponent_left` | payments (P8): a Gipedo Pano opponent's offer lapsed or was withdrawn | ✓ |
| `gipedo_no_opponent` | payments (P8): no opponent 24 hours before kickoff, play as normal or cancel free | ✓ |
| `gipedo_pulled_out` | payments (P8): the other team pulled out | ✓ |
| `gipedo_settled` | payments (P8): what a Gipedo Pano hold paid after the match | ✓ |
| `booking_switched` | payments (P12): the booker switched 5 v 5 / 6 v 6, with the player's credit or extra | ✓ |
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
| `team_of_the_week` | match (A7; S14): "You're in the All Cyprus 5-a-side Team of the Week." Once per week, naming the best team (decision 1k item 6) | |
| `premium_offers` | match (S14): "You'd have made the All Cyprus 5-a-side Team of the Week (8.4). Get Futty Premium to be eligible." Once per week (decision 1k item 7). Off until the player switches on "Premium and offers" (`notification_types.default_enabled` false; Apple guideline 4.5.4); the in-app notification is always written | |
| `saved_search_match` | payments (saved searches, spec 13): "A pitch you were looking for is free" / "A game you were looking for needs players" | |
| `streak_badge` | match (A11): "You've earned the Bronze streak badge" (decision 1i) | |

`booking_spot_released` replaces `spot_released` from the A1 prompt (decision 6): `spot_released` isn't allowed. A later prompt that needs a new type adds it to this list in the same PR.

## 7. Form, stats and levels

- **Form guide** (A3): the last 5 `confirmed` matches a player played in (any team or pickup), or a named team played as that team, newest first: W, D or L. A forfeit shows as **"L (forfeit)"** for the side that forfeited (05 section 3).
- **Stats** (A7): built from confirmed matches only. A forfeit counts as a loss for the side that forfeited.
- **Skill level** (A5): only confirmed, competitive matches move levels; **forfeits never move levels**, and `disputed`, `no_result` and `void` matches never count. The rules and constants are decision 1f.
- **XP** (A5a, decision 1f.6): replaced by the level. New matches never change XP; the app shows the level (one decimal), a "provisional" tag and the reliability % where it showed XP.
- Guests never get stats (05 section 2).
- **Only checked-in players count** (decision 1b.2, 11 November): a player counts in form (A3), man of the match (A4), ratings and levels (A5) and stats (A7) only with a `match_attendance` row for the match. Being in `match_players` isn't enough, because a named game's side `b` lists the whole opponent team. Exceptions (decision 1b.3): a confirmed forfeit counts for every spot holder on both sides, and team form counts every confirmed match the team played.
- **Words on screen** (A1b; Anghelo, 11 November, to confirm with Panos): a forfeit shows "Forfeit" in place of the score, with "<team> pulled out" or "<team> didn't show". `disputed` shows "Disputed · not in stats" (not "won't count": a disputed Gipedo Pano game still splits the money 50/50, 13), `no_result` "No result entered", `played` "Waiting for the result", and `void` "Cancelled" (the word "void" is never shown, 17). The app's typed shapes for sections 4 and 6.2 are in `lib/match/types.ts`; they change whenever this document does.
- **The server computes form** (A1b, 11 November): `playerForm` and `teamForm` in `lib/match/form.ts` are the reference rules for tests and mocks only. The app reads form from the server views A3 builds (`player_form`, `team_form`), which must give the same results. Likewise `MatchResultConfirmed` in `lib/match/types.ts` only mirrors the `match_result_confirmed` view (6.2); the app reads the view's rows from the server.
- **Match page link** (A1b, 11 November): a match row shows a chevron and opens the match page only when the screen passes `onPress`, and screens pass it for `confirmed` matches only, because only confirmed matches have a match page (05 section 3).

These are read through views (`player_form`, `team_form`, `player_recent_matches`, `head_to_head`), which A3 and A7 define. Each view exposes confirmed matches only and never exposes individual ratings or votes.

The A3b views (signed-in players read them; signed-out users can't):

| View | Columns |
| --- | --- |
| `player_form` | `profile_id`, `position` (1 = newest, at most 5), `match_id`, `kickoff_at`, `result` (`W`, `D`, `L`, `L_forfeit`) |
| `team_form` | `team_id`, `position`, `match_id`, `kickoff_at`, `result` |
| `player_recent_matches` | `profile_id`, `match_id`, `kickoff_at`, `kickoff_local`, `venue_id`, `venue_name`, `kind`, `side`, `label`, `opponent_label`, `team_id`, `opponent_team_id`, `goals_for`, `goals_against`, `result`, `forfeit_side`, `forfeit_reason` |
| `head_to_head` | `team_id`, `opponent_team_id`, `played`, `won`, `drawn`, `lost`, `goals_for`, `goals_against`, `last_3` (`[{matchId, kickoffAt, result, goalsFor, goalsAgainst}]`, newest first) |
| `player_teammates` | `profile_id` (always the caller), `teammate_profile_id`, `matches_together`, `last_played_at` |

The A7a views and tables (decision 1g; signed-in players read them, signed-out users can't):

| View or table | Columns |
| --- | --- |
| `player_season_stats` | `profile_id`, `season_kind` (`year`, `league`, `all`), `season_year`, `league_id`, `appearances`, `won`, `drawn`, `lost`, `win_pct`, `goals`, `assists`, `motm`, `average_rating`, `rated_matches`, `level_start`, `level_end` |
| `team_season_stats` | `team_id`, `season_kind`, `season_year`, `league_id`, `played`, `won`, `drawn`, `lost`, `win_pct`, `goals_for`, `goals_against`, `clean_sheets`, `longest_win_run`, `motm`, `average_rating` |
| `team_recent_matches` | as `player_recent_matches`, by `team_id` |
| `stats_leaderboards` | `scope` (`venue`, `city`), `scope_key` (venue id or city), `scope_name`, `season_year`, `profile_id`, `appearances`, `goals`, `motm`, `won`, `win_pct`, `min_appearances`, `goals_rank`, `motm_rank`, `win_rate_rank` |
| `team_of_the_week` (S14, decision 1k) | `id`, `week_start` (a Monday), `kind` (`general`, `league`), `area` (`all`, `city`, `venue`, `league`), `area_key` (`''`, city key, venue id or league id), `area_name`, `league_id`, `venue_id`, `format`, `matches`; unique per week, kind, area and format |
| `team_of_the_week_players` | `team_of_the_week_id`, `profile_id`, `slot` (`gk`, `def`, `mid`, `fwd`), `sort` (1–11, keeper first), `games`, `goals`, `assists`, `clean_sheets`, `average_rating`, `player_of_the_week` |
| `team_of_the_week_shapes` | `format`, `keepers`, `defenders`, `midfielders`, `strikers` (decision 1k item 3) |

`match_rating_shown(match, player)` returns a player's match rating once the match page shows it (null otherwise); `stats_min_appearances()` is decision 1g.1.

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
   - ~~whether a forfeit counts as a win in the winner's stats~~: decided 18 November, yes, as 3-0 (decision 1g.3);
   - what happens to the match when a Gipedo Pano team pulls out more than 6 hours before kickoff (13 takes €1 per player; is the match `void`?).
2. ~~Check-in window~~: decided 10 November (decision 1a.4).
3. ~~Ratings window~~: decided 17 November, 24 hours from `confirmed_at` (decision 1f.4).
4. ~~Skill level maths~~: decided 17 November (decision 1f), to confirm with Panos.
5. ~~Formation presets~~: decided 12 November (decision 1e.4).
6. ~~Quiet hours defaults~~: decided 10 November, none (decision 1a.6).
7. ~~A disputed match's goals~~: decided 12 November, no (decision 1e.2).
8. **Venue staff accounts.** Venue staff is only the venue's owner (`venues.owner_profile_id`) today. Staff accounts (front desk, manager) come later, and they must also be allowed to get the check-in code (`get_match_check_in_code`) and see the venue's matches.
9. **The venue's no-show record** (section 4.4) counts match players without a check-in. Since decision 1b.1, side `b` of a named game lists every opponent team member, including substitutes who were never expected to come. Who counts as a no-show in a named game (spot holders only? the opponent's starting players?) is open (11 November). **Decided 17 November (Anghelo):** spot holders only; a squad member without a spot and a venue-offered player never count (section 4.4; 13 "No-shows").
10. **A pickup player who checked in but never picked a side** gets no form: `formSide` needs `match_players.side`, so a `match_attendance` row with no side counts for nothing. Whether such a player should get the result (and on which side), or be made to pick a side at check-in, is open (11 November).
