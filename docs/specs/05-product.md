# Futty – Product & Features

As of 7 November 2026 (payments, venue and weather rules: 13 Payments & Bookings Spec; UI: 15 Design Brief; both win where this doc disagrees) · Owner: Anghelo (product decisions) · Panos builds every feature in Claude Code (14 and 17)

Every game booked through Futty is a real match: two sides, a venue, a time, a result. That's what lets Futty borrow SofaScore and FotMob's best features for amateur football. But none of it is worth anything unless the stats can't be faked, so a trusted "match record" has to be built first and every feature below sits on top of it.

## 1\. What each current feature does at launch

| Feature | Works well | Doesn't work | Launch verdict |
| :---- | :---- | :---- | :---- |
| Pitch booking | Real availability, slot locking | Venue chosen before time; no price before confirming; 1-hour only | Keep, redesign the flow |
| Split payments | Card tracking per player | Cancels games, overcharges, never pays venues | Replace with the three booking modes in 13 |
| Need players | Fills a short squad | Can be linked to someone else's booking; no player level | Keep, fix ownership, add level |
| Need opposition | Football-specific; nobody else has it | Payment side broken | Keep, make it the headline |
| Gipedo Pano | Distinctive, Cypriot | Collects half the price; disputes pay nothing | In for launch, rebuilt with the rules in 13 (Gipedo Pano) and 14, P8 |
| Teams and leagues | Round robin, standings, fixtures | Stats self-editable; XP only goes down | Keep; replace XP with level and stats below |
| Community feed, follows | Moderation built | Little reason to open it | Keep; feed it match results and cards |
| Venue dashboard | Block slots, house players | Thin for running a venue | Keep and expand: venues judge us on it |
| Premium, Team Premium | Apple verification works | Sells the wrong things | On: €3.99 a month, 14 days ahead instead of 7, no service fee on the player's own spot (decided 7 November) |
| Futty AI | Live availability | States outdated rules (2/21 days, €4.99, 30-minute cancellation). Decided 6 Nov: stays on, rules read from one shared source (14, P10) | On, after P10 |

## 2\. The foundation: every game becomes a match record

Build this first. Everything in section 3 reads from it.

| Piece | What it holds | Rules |
| :---- | :---- | :---- |
| Match | Booking, venue, kickoff, format, side A and side B, status (scheduled, played, confirmed, disputed, void) | Created automatically when a booking is made |
| Sides | A named team (opposition games, leagues) or "Bibs" and "Non-bibs" for a pickup game | Team form and head-to-head only count named teams |
| Players in the match | Who played, for which side, in which position; guests by name | Guests appear on the match page but never get stats |
| Attendance | Who actually turned up | The captain ticks who played, or players check in by scanning a QR code at the venue |
| Result | The final score | Both sides must agree (the existing score agreement logic). Only confirmed matches count |
| Goals | Scorer and assist for each goal | Each captain enters their own side's scorers; the count must match the score |

Non-negotiable: players can't edit stats directly (the security fix in 06 Coding, step 2). Every write goes through server functions that check the match is confirmed and the player was in it.

The QR check-in is worth doing well: it proves attendance for stats, and it gives venues a no-show record, which is part of the after-sales service.

## 3\. The features: who they're for and how they work

| Feature | For players | For teams | How it works |
| :---- | :---- | :---- | :---- |
| Form guide | Last 5 confirmed matches the player played in, any team or pickup | Last 5 matches as that team | Coloured W, D, L chips. A forfeit shows as "L (forfeit)". Shown on profiles, team cards and opposition posts |
| Recent matches | List on the player's profile | List on the team's profile | Score, opponent, venue, date; tap opens the match page |
| Reminders and notifications | Own games: 24 hours and 2 hours before (who's in, who hasn't paid), and after (confirm score, vote MOTM, rate, rebook) | Followers of a team: "X play Y tonight", "Result: X 5–3 Y", "X want an opponent on Thursday" | Uses the existing push tokens and notifications table. A scheduled job every 15 minutes finds games in each window. Settings per notification type; quiet hours |
| Head-to-head | Optional: "you've played against X 4 times" | Record between two named teams: won, drawn, lost, goals, last 3 results | Shown on the opposition post before accepting, on the fixture and on the match page |
| Match page | Their goals, assists, rating, MOTM | Score, scorers, lineups, MOTM, venue, date | Opens after the score is confirmed; scorers can be added for 24 hours |
| Man of the match | Vote once, not for yourself | Shown on the team's match list | Only players who played can vote; voting closes 24 hours after the score is confirmed; ties are shared |
| Player ratings | Each player rates teammates and opponents 1–10 after the game | Team average per match | Individual votes hidden; a match rating shows only with 3 or more votes; feeds the skill level |
| Skill level | A level from 1.0 to 7.0 on every profile | Team level \= average of its regular players | See section 4 |
| Lineups on a pitch | See where you're playing before kickoff | Captain sets the formation and positions | See section 5 |
| Shareable cards | "I scored 3", MOTM, season recap | Result card, team of the week | See section 6 |
| Team of the week | Selected players get a notification and a card | Shown per venue and per league | See section 7 |
| Season stats | Appearances, W/D/L, win %, goals, assists, MOTMs, average rating, level trend | Same plus goals for and against, clean sheets, longest winning run | See section 8 |

## 4\. Skill level

What it's for: matching players to "Need players" posts of the right standard, suggesting fair opponents, and a "balance teams" button that splits a pickup game into two even sides. Playtomic's level system is the model.

1. **Starting level.** Five questions at sign-up: how long you've played, the highest level you played at, how often you play now, position, and how you rate yourself. That gives a starting level, marked "provisional".  
2. **After every confirmed match.** Each side's expected result is worked out from the average levels of the two sides. Winning against a stronger side moves your level up more; losing to a weaker side moves it down more (an Elo-style update). Moves are bigger for the first 10 matches, then settle.  
3. **Ratings nudge it.** Your average rating from that match moves your level by at most 0.1 either way, so one generous friend can't inflate it.  
4. **Provisional until 5 matches.** Show the level with a "provisional" tag until then.

Anti-gaming for ratings: only players who were checked in can rate; 24-hour window; you can't rate yourself; with 6 or more votes the highest and lowest are dropped; someone who gives everyone 10 (or 1\) gets their votes down-weighted.

## 5\. Lineups on a pitch

- Formation presets per format: for example 1-2-1 or 2-2 for 5-a-side, 2-3-1 for 7-a-side, and so on up to 11-a-side.  
- The captain or booker drags players from the squad list onto positions on a drawn pitch. Empty positions show a "Need players" button.  
- Shown before the game (who's playing where, who hasn't paid under option 2\) and on the match page afterwards.  
- The position played feeds team of the week (a keeper is picked as a keeper).  
- Build note: a drawn pitch with drag and drop; the repo already includes the gesture and animation libraries, and needs an SVG drawing library added.

## 6\. Shareable cards

- Fixed designs for an Instagram story (1080 × 1920\) and a square post (1080 × 1080).  
- Result card: score, team names, scorers, MOTM, venue, date, Futty logo and a "Book on Futty" QR code.  
- Also: "I scored a hat-trick", MOTM, team of the week, and a year-end "Your 2026 on Futty" recap.  
- Generated on the phone from the match data and shared through the normal share sheet, tagging the venue's account where it has one.  
- Every card is free marketing; this is the main reason to build it early.

## 7\. Team of the week

- Picked every Monday morning (Cyprus time) for each venue with at least 4 confirmed matches that week, otherwise for the whole city; leagues get their own.  
- The best average match rating per position, with at least 3 ratings each; ties broken by MOTMs, then goals.  
- Selected players get a notification and a shareable card; the venue gets the card for its own social media.

## 8\. Season stats and leaderboards

- Season \= calendar year for casual games, the league season for league games.  
- Player: appearances, wins, draws, losses, win %, goals, assists, MOTMs, average rating, level over time.  
- Team: the same, plus goals for and against, clean sheets, longest winning run.  
- Leaderboards per venue and per city (top scorers, most MOTMs, best win rate), with a minimum number of appearances so one lucky game doesn't top the table.  
- Updated every time a match is confirmed. Year-end recap card in December.

## 9\. Build order

Each step is only worth building once the one before works.

1. Match record, attendance, confirmed results, goals (section 2\)  
2. Form guide, recent matches, reminders, head-to-head (cheap once step 1 exists)  
3. Match page with scorers and MOTM; lineups on a pitch  
4. Player ratings and skill level; "balance teams"  
5. Shareable cards  
6. Team of the week, season stats, leaderboards, year-end recap

Don't copy: live minute-by-minute events, heatmaps, xG or momentum graphs (they need tracking data you don't have), news feeds, or betting odds.

## 10\. After-sales service features

- [ ] "Rate the venue" and "Report a problem" after every game  
- [ ] Problems go to the venue's named founder contact on WhatsApp, with the reply targets in 07 Venues  
- [ ] Monthly venue report: bookings, revenue, no-shows (from QR check-in), slots filled that would have been empty  
- [ ] Refund status visible to the player until it lands

## 11\. Specs to write before code

1. **Payment flow (Panos)**: done as 13 Payments & Bookings Spec (7 November); every screen's text follows 15 Design Brief  
2. **Venue model (Panos, from Dimitris's venue discovery answers)**: named pitches and sizes, which combine, hours per weekday, peak and off-peak prices, cancellation window, photos, address  
3. **Booking flow (Panos)**: date → time → format → venues free then, with price, photo and area; 1h, 1.5h or 2h; total and cancellation rule before paying; guests by name; invite link  
4. **Match record and stats** (Panos, prompt A1 in 14): sections 2 to 8 turned into exact rules for each screen  
5. **Home screen** (Panos, prompt U3 in 17): next game with who's in and who hasn't paid; "Find a team to play" above "Book"  
6. **Venue dashboard (Panos with Dimitris, after discovery)**: today's bookings, block a slot in two taps, cancel for weather, check-ins, payouts  
7. **Copy pass (Dimitris)**: no "authorize", "capture" or "void" anywhere; every money screen says who pays what and when  
8. 12\. Venues: preview mode, venue pages, food and drink, and the venue dashboard (added 6 November)  
9.   
10. All venues in the app now  
11. \- Every target venue is added now, fully working: real pitches, hours, prices, photos, amenities and food and drink offers, from the Futty Venue Data sheets. Only the founders have the app, so nothing is hidden or disabled.  
12. \- Each venue has a live switch (on for everything now). Before the app reaches anyone outside the founders, unsigned venues are switched off so they can't take real bookings.  
13. \- Payments use Stripe test mode until a venue has signed and finished Stripe onboarding, because there is nowhere to pay the money out to before then.  
14. \- A venue moves to live payments only after it has signed and finished Stripe onboarding.  
15. \- Purpose: in December, open the app in front of each venue manager and show them their own venue working.  
16.   
17. Venue page (what players see)  
18. \- Photo gallery of the venue and each pitch, supplied by the venue with written permission (not copied from Google Maps or websites).  
19. \- Amenities and after-sales services as icons: parking, changing rooms, showers, lockers, café or bar, floodlights, bibs, ball hire, first aid, Wi-Fi, plus anything the venue adds.  
20. \- Address with a "Directions" button that opens Apple or Google Maps.  
21. \- Each pitch: size, surface, indoor or outdoor, which formats it hosts.  
22. \- Cancellation rules and prices for that venue.  
23.   
24. Food and drink after the game  
25. \- After the score is entered (or confirmed), the player sees that venue's post-match offers: item, photo, price and offer text, only items available at that time of day.  
26. \- Tapping an offer shows "Show this at the counter" with a code the venue staff can check. No in-app payment for food at launch.  
27. \- Venues manage their items in the dashboard. Until that's built, the founders load them from the Venue Food & Drink sheet.  
28. \- Track how often offers are viewed and redeemed per venue: that's a number to bring to venues, and a future revenue share.  
29.   
30. Venue dashboard: built for a venue manager on a phone, every common action in two taps or fewer  
31.   
32. Launch version (before the December visits):  
33. 1\. Today and this week: a calendar of every booking and block per pitch; tap a booking to see the players, who has paid, who has checked in.  
34. 2\. Pitches: add or edit named pitches (size, surface, which combine), open or close a pitch for maintenance, holiday closures.  
35. 3\. Opening hours per weekday, and prices: peak, off-peak and weekend, per format.  
36. 4\. Block slots and recurring blocks (academy training, regular customers).  
37. 5\. Walk-in and phone bookings: add a booking by hand so the app never double-books; mark it cash or card at the counter.  
38. 6\. Weather and maintenance: flag "conditions may be unsuitable" for a day or slot (players are notified and can cancel under the normal rules); block pitches so nobody can book them (existing games stay on); cancel a booking (every player gets their whole share back by card or venue credit, their choice, and the venue pays Stripe's fee). A nudge when the forecast for a booked slot is bad, at least 12 hours before kickoff (13).  
39. 7\. Check-in: show the match QR code; mark no-shows.  
40. 8\. Venue profile: photos, amenities, after-sales services, rules, contact details.  
41. 9\. Food and drink menu and post-match offers.  
42. 10\. Payouts: Stripe Connect onboarding and status, list of payouts, what each booking paid.  
43. 11\. Notifications to the venue: new booking, cancellation, unpaid spot, daily summary of tomorrow's bookings.  
44. 11a\. Cash and debt (decided 7 November, 13): each booking's roster shows every player's payment choice; staff tick cash as paid; run collection early; see and settle debts; see each player's credit; the "allow 6 v 6 on 5-a-side pitches" setting; offer a player to a team that's short.  
44.   
45. After launch:  
46. 12\. Reports: occupancy by hour and weekday (a heatmap), revenue by pitch, no-show rate, slots Futty filled that would have been empty, food and drink offer redemptions; the monthly report sent automatically.  
47. 13\. Staff accounts with roles: front desk (calendar, check-in, walk-ins) and manager (prices, hours, payouts).  
48. 14\. Integrations: a calendar feed for Google or Apple Calendar, daily summary by email or WhatsApp, CSV export for the venue's accountant.  
49. 15\. Customers: regulars list, message a booker, block a problem player.  
50. 16\. Host tournaments and leagues at the venue.  
51. 17\. (Cash spots moved into the launch version, item 11a.)  
52.   
53. 13\. Calendar and WhatsApp reminders for players (added 6 November)  
54.   
55. Add to calendar  
56. \- Every booking and every fixture has an "Add to calendar" button: Google Calendar, Apple Calendar or any calendar app.  
57. \- The event includes the venue name and address, the pitch, kickoff and end time, who's playing, and a link back to the booking in Futty.  
58. \- If the booking moves or is cancelled, the calendar entry is updated or removed.  
59. \- Later: a personal calendar feed (one link per player) so every Futty game appears automatically.  
60.   
61. WhatsApp reminders  
62. \- Alongside push notifications: 24 hours and 2 hours before kickoff (who's in, who hasn't paid), "unpaid spot" alerts to the booker, and "score your game" after it.  
63. \- Players opt in and choose WhatsApp, push or both, per reminder type.  
64. \- Needs the WhatsApp Business Platform: a business phone number, Meta-approved message templates, and Meta's per-message charges. Check the cost per message for Cyprus before switching it on for everyone; push notifications stay free.  
65. \- The same channel later sends venues their daily summary (section 12, item 14).  
66.

## 14. Weather for players (added 7 November)

- A forecast (rain, wind, temperature for the match hours) on the venue page, checkout and each upcoming game, from Apple WeatherKit through Futty's server.
- When conditions look bad (rain chance 60% or more or heavy rain, wind 40 km/h or more, thunderstorms, 38°C or hotter), a banner says "Heavy rain forecast. The venue may cancel this booking." It warns only; it never promises a cancellation.
- Built in 14 Claude Code Prompts, P11. Full rules in 13.

## 15. Short games and 6 v 6 (added 7 November)

- If fewer players join than the booking is for, the players who joined split the full pitch price after the match. Six hours before kickoff everyone is told and can ask the venue for a player or post a public request; the venue can also offer a player from its dashboard.
- Venues that allow it offer "6 v 6" on 5-a-side pitches: the same pitch price split 12 ways. Details in 13.

