# 13 Futty – Payments & Bookings Spec

7 November 2026 · Panos and Anghelo · Final decisions. Copy of the Google Doc "13 Futty – Payments & Bookings Spec"; if the two disagree, the Google Doc wins and this file is updated in the same PR as the code.

## What this is

These are the money and booking rules Panos and Anghelo agreed on 7 November 2026. They replace decisions A–F in 01 Futty – Decisions to Make. Code is built only from this document, and every rule here gets a test.
- **Agreed** = decided in chat on 7 Nov.
- **Confirmed** = first proposed to close gaps, then ticked by the founders on 7 Nov. Every rule in this document is now agreed.
- Every amount uses a **€60 5-a-side (5 v 5, 10 players)** paid with a **standard European card**: Stripe takes 1.5% + €0.25 on each payment it takes.

## Prices and fees

The venue always gets its full pitch price; Futty adds a service fee per player and pays Stripe out of it. **Agreed.**
- **Each player's part of the pitch** = pitch price ÷ the number of players the booking is for (10 for 5 v 5, 12 for 6 v 6, 14 / 18 / 22 for 7s / 9s / 11s). Leftover cents from dividing go on the booker's share.
- **Service fee:** €0.80 per player when each player pays their own share; €0.55 per player when the booker pays for everyone in one payment.
- **Premium players** pay no service fee.
- **Paying with venue credit:** no service fee. If the credit doesn't cover the whole share, the rest is paid by card **plus the normal €0.80**.
- **It's a service fee, not a card fee.** It's charged the same whatever the payment method; card surcharges on consumer cards are banned in the EU.
- **Pitch prices (decided 9 November):** by default a venue has **one price per format, the same at every hour**. Peak and weekend prices are optional and apply only when the venue's data provides them; a venue without them charges its one price for every slot.
  - **When a venue has them:** its peak and weekend hours are stored with its price rules. Unless its data sets other hours, **peak** is Monday to Friday from 17:00 until closing and **weekend** is Saturday and Sunday all day. Every other hour is **off-peak**, at the venue's one price.
  - **A game is priced half hour by half hour,** each half hour at its own price.
  - **Example, one price:** a 5-a-side at €50 an hour costs €50 at any hour, any day: €50 ÷ 10 = €5.00 + €0.80 = **€5.80 each**.
  - **Example, crossing into peak:** the same venue with a €60 peak price. A weekday game from 16:30 to 17:30 is half off-peak and half peak: €25 + €30 = €55, so €55 ÷ 10 = €5.50 + €0.80 = **€6.30 each**.

| Booking                                        | Each player pays | Stripe takes                | Futty keeps per player     |
|------------------------------------------------|------------------|-----------------------------|----------------------------|
| 5 v 5, each pays own share                     | €6.80            | €0.35                       | €0.45                      |
| 6 v 6 on a 5-a-side pitch, each pays own share | €5.80            | €0.34                       | €0.46                      |
| 5 v 5, booker pays all (€65.50 in one payment) | €6.55            | €1.23 for the whole payment | €0.43                      |
| 6 v 6, booker pays all (€66.60 in one payment) | €5.55            | €1.25 for the whole payment | €0.45                      |
| Premium player, own share                      | €6.00            | €0.34                       | −€0.34 (Futty pays Stripe) |

Futty's figures are before Stripe Connect payout costs. UK and non-European cards cost about €0.07–€0.12 more per payment.

**Premium (agreed):** €3.99 a month. Premium players book **14 days ahead**; standard accounts book **7**. *The app today says 2 and 21 days and €4.99, so the code, the Futty AI's answers and the App Store product all have to change.*

**Confirmed:** when a Premium booker pays for everyone, only the booker's own spot is fee-free; the other players' spots still carry €0.55. For example, 5 v 5 = €60 + 9 × €0.55 = €64.95.

## Booking modes

The booker picks one of three ways to pay when booking. **Agreed.** The choice decides who pays and who covers a player who doesn't pay.

| Mode                              | Who pays                                          | Fee per player | Who covers an unpaid or no-show spot                       |
|-----------------------------------|---------------------------------------------------|----------------|------------------------------------------------------------|
| **Booker pays for everyone**      | The booker, one payment for the whole pitch       | €0.55          | Nobody needs to: the venue is already paid                 |
| **Each pays, booker responsible** | Each player pays their own share, by card or cash | €0.80          | The booker's guarantee hold, taken 2 hours after the match |
| **Each pays, just my spot**       | Each player pays their own share, by card or cash | €0.80          | The player who didn't pay goes into debt to the venue      |
- **Whatever the mode, the full pitch price is paid.** If fewer people play, the players who play pay more (see Short games).
- **The booker sends invites** to their players from the booking. Empty spots can be filled three ways:
  - ask the venue for a player;
  - post a public request any Futty player can join;
  - accept a player the venue offers from its dashboard.
- **A player the venue provides plays free.** The team covers his spot like an empty one.
- **If the booker is responsible but doesn't show** while the team plays, a teammate covers his share or he pays it in the app. Otherwise his hold covers it.
- **The mode is always chosen (decided 9 November).** The server refuses a booking without one (`mode_required`); there is no default.

## When money is held and taken

A payment is held when the player pays and taken 1 hour later. Everything still unpaid is collected 2 hours after the match. **Agreed.**


Step 3 applies only when the booker is responsible.
1.  **When a player pays** (card, Apple Pay or Google Pay), their share is **held**. Their card is also saved, with their consent, so top-ups and debts can be charged later.
2.  **1 hour after paying**, the share is **taken**. The free-cancellation hour ends here. *Exception:* a booking made less than 6 hours before kickoff is taken **straight away**, and the player must accept a "This booking is non-refundable" notice first.
    - **Per share (decided 9 November):** the exception applies to any share paid less than 6 hours before kickoff, including a player paying late on a booking made days earlier.
3.  **The booker's guarantee** (when the booker is responsible) is saved at booking and **held for the full pitch price 3 days before kickoff**, or at booking if the match is less than 3 days away. Holds last about 7 days, so this is the earliest that's safe.
    - If the hold fails, the booker is notified and asked to fix their card. **It's retried every 6 hours; the booker is notified once, on the first failure (decided 9 November).**
    - **A failed hold never cancels the booking. Whatever the hold would have covered at collection becomes the booker's debt to the venue**.
    - **Retries stop at kickoff (decided 9 November).** After that no hold is tried; anything still unpaid becomes the booker's debt at collection.
    - **The booker can replace their card (decided 9 November)** in the app and the hold is retried at once. If their bank asks for 3-D Secure, they're asked to complete it in the app.
4.  **The free-cancellation hour (decided 9 November)** ends 60 minutes after paying or 6 hours before kickoff, whichever comes first. The share is taken at that moment. Whether a share is non-refundable is decided when the player confirms payment, not when the payment is started.
5.  **The booker completes payment within 15 minutes of booking (decided 9 November):** the full amount when paying for everyone, or their own share plus a saved card in the each-pays modes. Otherwise the booking is cancelled and its pitches released. This replaces the old 3-hour auto-cancel.
6.  **Every player paying in the app saves a card (agreed),** including a Premium cash player or a player paying fully with venue credit, so top-ups and debts can be charged later.
7.  **6 hours before kickoff:** refunds stop, and in a short game every player gets the "You're 8 of 10" notice (see Short games).
8.  **After the match:** a cash player the venue hasn't ticked gets: "Pay €6.00 by card now, or remain in debt to \[venue\]."
9.  **2 hours after the match, collection runs automatically.** The venue can run it earlier from its dashboard, or tick cash as received first.
    - top-ups in short games are charged;
    - in **responsible** mode, anything still unpaid is taken from the booker's hold, and the rest of the hold is released;
    - in **just my spot** mode, anything still unpaid becomes that player's debt to the venue.
    - **Decided 10 November (collection):**
      - **The booker's hold covers a share that was never paid in full, service fee included:** €6.80 for an unpaid €6.80 share, the same as that player would owe in just-my-spot mode. The total taken is capped at the hold (the pitch price, €60), pitch money first, then fees.
      - **The venue can run collection early only once the match has ended**, so late joiners can still make the top-ups smaller.
      - **The booker is told when money is taken from their hold:** "€X was taken from your hold for unpaid spots: \[names\]." (always sent, type `guarantee_charged`). Nothing is sent when the whole hold is released.
      - **A late cancellation whose card payment was never taken** (the hold went before it could be taken) still counts toward the pitch price, and that card payment is collected like any unpaid amount: from the booker's hold in responsible mode, or as that player's debt in just-my-spot mode.
10. **The old 3-hour auto-cancel is removed.** Unpaid spots no longer cancel a booking.

**When a booker's payment fails (agreed 7 Nov), they owe it as debt to the venue, and the game still goes ahead:**
- **The booker was responsible for the whole team:** they owe everything still unpaid at collection, up to the full pitch price.
- **The booker paid only for their own spot:** they owe only their own share.
- **Either way**, the debt blocks them everywhere on Futty until it's paid.

The trade-off: the venue's protection is now the debt block, not money already held.

## Cancellations and refunds

A player who cancels in the first hour gets everything back. After that €1 is kept and the rest becomes venue credit, until 6 hours before kickoff, when refunds stop. **Agreed.** Credit can't be cashed out.

| A player cancels their own spot…                                  | Player gets back              | Venue gets                             | Futty keeps             | Stripe                               |
|-------------------------------------------------------------------|-------------------------------|----------------------------------------|-------------------------|--------------------------------------|
| Within 1 hour of paying (booked more than 6 hours before kickoff) | €6.80, the hold is cancelled  | €0                                     | €0                      | €0                                   |
| From 1 hour after paying until 6 hours before kickoff             | €5.80 as credit at that venue | Holds the €5.80 until it's spent there | €0.65 (€1 minus Stripe) | €0.35, paid when the money was taken |
| Less than 6 hours before kickoff                                  | Nothing                       | €6.00                                  | €0.45                   | €0.35                                |
| Booked less than 6 hours before kickoff, at any time              | Nothing (no free hour)        | €6.00                                  | €0.45                   | €0.35                                |

**Agreed rules around the table:**
- **Cancelling releases the spot**, and the remaining players are told so they can fill it.
- **A late cancellation whose spot gets filled:** the venue keeps both payments. The player who cancelled gets nothing back.
- **The venue warns of bad conditions:** normal rules still apply. The warning exists so players can cancel before the 6-hour cutoff.
- **The venue cancels a booking:** every player gets their whole share back, by card refund (5–10 working days) or as venue credit, their choice.
  - Stripe's €0.35 per player is **taken off the venue's next payout**.
  - Futty earns nothing on that booking.
- **The booker can cancel their own spot only**, which leaves an empty spot and tells the team. Or they can cancel **the whole team**.

**Confirmed:**
- **The booker cancels the whole team (each pays own share):**
  - every other player gets their full share back, card or credit (their choice), because they didn't cancel;
  - the booker pays **€1 for every player who had paid**, as one extra charge. For example, 9 other players paid: the booker's own share follows the table above, plus a €9 charge.
- **The booker cancels a booking they paid for everyone:** in the middle window, €1 per player is kept (€10 on a 5 v 5). The rest becomes credit at that venue.
- **The whole team can be cancelled less than 6 hours before kickoff, but nobody gets money back, and the slot is released for others to book (agreed 7 Nov).** It's the same no-refund rule as every other late cancellation.
- **Decided 10 November (cancellations):**
  - **The booker's €1 charge counts only payments already taken.** When the booker cancels the whole team, they pay €1 for each other player whose payment (their share, or a cash player's €0.80 fee) was already taken. A payment that is only held is released, at no charge. For example, 10 players: 6 taken and 3 still held, so the booker pays 6 × €1 = **€6**.
  - **The €1 charge applies only when the team is cancelled more than 6 hours before kickoff.** Less than 6 hours before kickoff nobody gets money back, so there is no €1 charge. Inside the booker's own free hour the charge still applies: other players' payments that were taken count, held ones don't.
  - **Futty receives the €1 charge.**
  - **It is taken on-session when the booker confirms the cancellation, with the amount shown first:** "Cancelling the whole team costs €6: 6 players × €1".
    - If it fails, or needs 3-D Secure the booker doesn't complete, the cancellation still goes ahead.
    - The booker is notified once, and the charge is retried every 6 hours. Retries stop at the original kickoff.
    - Anything still unpaid becomes the booker's debt, owed to Futty (built in P4c).
  - **Card refund or credit:** when the booker or the venue cancels, a player whose payment was taken has **48 hours** to choose venue credit. With no choice, it goes back to their card.
  - **The venue cancels:** the venue owes Stripe's real fee on every payment that was taken, whether the player takes a card refund or credit, so Futty neither earns nor loses on that booking.
  - **€1 kept, the rest as credit, applies to whatever the share paid.** A Premium player's €6.00 gives €5.00 credit. A cash player's €0.80 fee is all kept, with no credit, because the pitch part was never paid. A 6 v 6 the booker paid for everyone (€66.60) keeps €12.00 (€1 × 12 players) and gives €54.60 credit.
  - **A share paid with credit is treated the same way:** the €1 is kept even from credit. A Premium share paid fully with €6.00 credit gives €5.00 credit back.
  - **A booker who paid for everyone can only cancel the whole booking,** not "my spot".
  - **A booker who cancels only their own spot in responsible mode stays responsible:** their guarantee hold is unchanged.
  - **Exactly 6 hours before kickoff is still the middle window,** as for the non-refundable rule: exactly 6 hours is not "less than 6 hours".
  - **Nothing can be cancelled once the game has started,** by anyone, the venue included.
  - **The venue can cancel up to kickoff,** and every player gets their full share back even less than 6 hours before kickoff.
  - **The venue cancels after a player cancelled late (decided 10 November):** a player who forfeited their share by cancelling less than 6 hours before kickoff gets it back too, card refund or credit, their choice within 48 hours, and the venue owes Stripe's fee on it. Futty's €1 from an earlier middle-window cancellation stays with Futty.
  - **Credit that paid for a share goes back to the credit it came from,** keeping its original expiry, in every case, the middle window included (decided 10 November). Only the card-paid part becomes new 12-month credit. In the middle window the €1 is kept from the card-paid part first, then from the credit. For example, €5.00 credit + €1.80 by card: the €5.00 goes back with its old expiry and €0.80 becomes new credit. The card-or-credit choice covers only the card part.
  - **When credit comes back, the latest-expiring credit is returned first (decided 10 November),** so when part of the credit is kept (the €1), what's kept is the credit that expires soonest.
  - **A kept share whose card part is never taken** (the hold expired before it could be taken): the €1 applies only to what was actually paid, so in the middle window up to €1 of the credit that paid for it is kept and the rest goes back; less than 6 hours before kickoff it is all kept.
  - **Choosing credit turns the whole card payment into credit,** the service fee included (€6.80 gives €6.80 credit).
  - **Only payments taken by card count toward the booker's €1 charge.** A share paid entirely with credit doesn't count.
  - **The free hour of a share paid entirely with credit** is the 60 minutes after the player's card was saved.
  - **An unpaid share's open payment is cancelled when the player cancels,** so it can't be paid afterwards.
  - **A player who cancels can't rejoin the same booking** (one spot per player per booking). Letting them rejoin while the spot is still free is a follow-up after launch.
  - **Notifications:** the other players are told when a spot opens up or a game is cancelled (with what they get back and how to choose), and the booker is told if their €1 charge fails.
  - **A 3-D Secure the booker doesn't finish when cancelling isn't notified at once.** The first off-session retry is 6 hours later, and the booker is told if that fails.
  - **The venue's Stripe fee is the fee recorded when the payment was taken** (from its balance transaction).
- **Payouts (decided 7 November):** Stripe Connect with separate charges and transfers. Futty's Stripe account takes every payment; after collection each venue is sent its pitch money minus anything it owes (for example Stripe's fee on its own cancellations), so no money ever has to be pulled back from a venue.
- **Credit sits with the venue.** Futty sends the venue its credit money at the next payout and keeps a record of each player's credit there. The decisions doc (#16) still asks for legal advice on this before real money flows.
  - **In the ledger (decided 10 November):** credit money is the venue's from the moment the credit is issued, so it is paid out at the next payout as usual. When a player chooses credit, Futty's service fee goes to the venue with it. Spending, returning or expiring credit later moves no new money to the venue; the ledger only records the change in credit the venue holds. Every booking still balances: venue + Futty + Stripe + refunds = what was taken.

## Short games, top-ups and 6 v 6

If fewer players join than the booking is for, the players who joined split the full pitch price, charged as a top-up after the match. **Agreed.**

**Example:** a 5 v 5 played 4 v 4 = €60 ÷ 8 = €7.50 + €0.80 = **€8.30 each**, so each player gets a **€1.50 top-up**.
- **6 hours before kickoff:** everyone in the booking gets "You're 8 of 10. If nobody else joins, each player pays €1.50 extra after the match." The notice has the buttons to request a player.
- **2 hours after the match**, top-ups are charged to each player's saved card. Someone who joins at the last minute just makes the top-up smaller, with no refunds.
- **Futty absorbs Stripe's fee on top-ups.** That's about €0.27 on €1.50, leaving Futty about €0.18 per player in that game.
- **Cash players' amount goes up** on the venue dashboard: €7.50 instead of €6.00.
- **A failed top-up:** the player is asked to pay in the app. If they don't, the booker's hold covers it (responsible mode) or it becomes the player's debt (just my spot).
- **Booker pays for everyone:** there are no top-ups, because the booker already paid the full pitch price.
- **Confirmed:** "joined" means everyone who holds a spot in the booking, not who turns up. A no-show still owes their share; a venue-provided player counts as an empty spot.
- **Leftover cents when the booker gave up their spot (decided 10 November):** they go on the share of the first player who joined.
- **A late cancellation's kept money counts toward the pitch price (decided 10 November).** The players who joined pay only what's still missing. For example, 10 players, one cancels less than 6 hours before kickoff and nobody takes the spot: their €6.00 pitch part is kept, so the other 9 owe only the remaining €54 and nobody gets a top-up. The joined players never pay less than their normal share, so a late-cancelled spot that gets filled still pays the venue twice (above).

### 6 v 6 on a 5-a-side pitch
- A venue with a real 6-a-side pitch (English School Central Park) lists it as its own pitch type with its own price. Nothing below applies to it.
- A venue that allows it (Nuevo Campo) turns on **"Allow 6 v 6 on 5-a-side pitches"** in its dashboard. Only then does the booking form show **Players per side: 5 v 5 / 6 v 6**.
- 6 v 6 splits the same €60 between 12 players: **€5.80 each**, or €66.60 when the booker pays for everyone.
- A 6 v 6 game where only 10 players join becomes €6.80 each, through the normal top-up.

**Switching after booking (agreed):** allowed until 6 hours before kickoff.
- **5 v 5 → 6 v 6:** each player who paid €6.80 gets **€1.00 as venue credit**, which costs nothing in Stripe. The booking now has 12 spots.
- **6 v 6 → 5 v 5:** allowed only while 10 or fewer players have joined. Each player then owes €1.00 more, charged with the after-match top-ups.
- **Confirmed:** only the booker can switch, and every player is notified. When the booker paid for everyone, switching moves no money: the fee stays as it was at booking.

## Cash, debt and venue credit

Debt and credit are between the player and the venue, and the venue manages them in its dashboard. Futty records them and enforces the rules. **Agreed.**

### Cash at the venue
- A player who picks cash still **pays the €0.80 service fee by card** when joining.
- The venue dashboard lists every player in each booking with their payment choice and status: *paid in app*, *cash – not yet paid*, *cash – paid*. Staff tick cash players as they pay in person.
- After the match, an unticked cash player gets: **"Pay €6.00 by card now, or remain in debt to \[venue\]."**
  - **Decided 10 November:** that wording is for just-my-spot mode. When the booker is responsible, it's **"Pay €6.00 by card now, or \[booker name\] will be charged for your spot."**
- Unpaid at collection time (2 hours after the match): the booker's hold pays (responsible mode) and the player settles with the booker outside the app. Otherwise the player goes into debt to the venue (just my spot).

### Debt
- **A player in debt to any venue can't book, join a booking or choose cash anywhere on Futty** until it's cleared. Paying off the debt is always allowed.
- Debt is cleared by paying it in the app by card, or by the venue marking it settled in its dashboard.
  - **Decided 10 November:** when the venue marks settled a debt that includes Futty's service fee (for example €6.80 = €6.00 pitch + €0.80 fee), the player's debt is fully cleared and Futty's part is owed by the venue: it comes off the venue's next payout.
- The player sees how much they owe and to which venue. The venue sees everyone who owes it.
- **Decided 10 November:** a debt can be owed to a venue or to Futty (for example the booker's unpaid €1-per-player charge for cancelling the whole team). Both block booking everywhere on Futty, and both are paid with "Pay what I owe".
- **Confirmed:** paying a debt adds no new fee. Futty absorbs Stripe's cost, about €0.34 on €6.00, because the fee was already paid at booking.
- **Confirmed:** a cash player who cancels follows the normal timings, but only the €0.80 fee is at stake: the hold is cancelled in the first hour; after that the fee is kept.

### Venue credit
- Credit comes from cancelling in the middle window, a venue cancellation (if the player chooses credit), or a 5 v 5 → 6 v 6 switch.
- **It can only be spent at the venue that issued it and can't be cashed out**, like Playtomic's club wallets.
- Credit pays the pitch part of a share with no service fee. A shortfall is paid by card plus €0.80.
- The venue dashboard shows each player's credit with that venue.
- **Expiry:** credit expires 12 months after it's issued (agreed 7 Nov), subject to the legal advice in decisions doc \#16.
- **Decided 10 November (credit):**
  - Credit is used only with a card payment, never with cash.
  - **The booker paying for everyone can pay with credit too.** If credit covers the whole pitch price, no service fee is charged. Otherwise the card pays the rest plus the normal €0.55 per player (a Premium booker's own spot stays fee-free). For example, €50 credit on a €60 pitch: €10.00 + €5.50 = **€15.50** by card.
  - A Premium player paying a shortfall pays no service fee.
  - When credit covers the whole pitch part, nothing is charged and the player's card is saved instead (every player paying in the app saves a card).
  - **Credit set aside for a payment that's never finished goes back:** when that payment is cancelled, when the booking expires, or when it isn't completed within 15 minutes. A player's credit never stays locked.
  - **A payment undone after it was held (decided 10 November):** when the payment is cancelled at Stripe just as the player confirmed it, the hold is undone, the credit comes back and the player is asked to pay again. If it was the booker's payment, the booking goes back to waiting for payment with a new 15-minute payment window from that moment, and the booker is told to pay again within it. If they don't, the booking is cancelled and its pitches released, as for any unpaid booking.
  - **Only the 15-minute release can reopen a booking (decided 10 November).** Undoing a payment as above, and reopening the booking, happens only when Futty cancelled the payment because it wasn't finished within 15 minutes. Any other cancellation of a held payment, such as a hold expiring after 7 days or a cancel in the Stripe dashboard, never reopens or cancels a confirmed booking: the money for that share is released or returned (credit goes back as above), the booking stays as it is, and the founders get an admin alert. The same whether the share was paid by card, credit or both.
    - **Telling the player (decided 10 November):** if the game hasn't kicked off yet, the player gets a payment-due notification that opens the payment screen: "Your payment for [venue, day, time] didn't go through. Pay €X to keep your spot." €X is what the share costs now, priced without the credit, which has gone back. From kickoff on, the player isn't notified: collection handles it.
  - **Nobody is asked to pay again on a cancelled booking (decided 10 November).** A held payment on a booking that's already cancelled is released with the booking, and its credit comes back; the player isn't told to pay again.
  - **Expired credit stays with the venue.** The expiry check runs with the payment jobs, not once a day: it only ever expires credit past its date, once.
  - **A share paid entirely with credit is judged non-refundable when the card is saved,** as a card payment is when it's held: saved less than 6 hours before kickoff, the player must have accepted the "This booking is non-refundable" notice, otherwise nothing is used and they're asked to pay again.
- **Legal check before real money:** the terms must spell out the debt block across all venues and the credit rules.

## Gipedo Pano

In Gipedo Pano, the losing team pays for the pitch. **Agreed.**
- **Each team's card is held for the full pitch price.** Today the code holds only half, which is a bug to fix.
- After the match, players confirm the result. **The loser's hold is taken in full; the winner's is released.**
- **A draw or a dispute splits it 50/50:** half of each team's hold is taken (Stripe partial capture), and the rest released free.
- **Only for games within 6 days**, because holds expire after about 7. Choosing a date further ahead shows: "Gipedo Pano can only be booked up to 6 days ahead."
- The scheduled job that settles results gets switched on.
- A cost for disputing is left to the venue's and player's discretion. The risk: a losing team pays less by disputing. We accept that at launch and watch the dispute rate.

**Confirmed:**
- **Fee:** each hold is the pitch price plus €0.55 for each of the 10 players (€65.50 on a €60 pitch). The loser pays €65.50; in a draw, each team pays €32.75.
- **Confirming the result:**
  - each team's captain enters it within 24 hours of the match;
  - the captains agree = settled; they disagree = dispute (50/50);
  - only one captain enters a result = after 24 hours that result stands, so a losing team can't avoid paying by staying silent;
  - nobody enters a result = 50/50.
- **No opponent 24 hours before kickoff:** the booking team chooses to play it as a normal booking (normal prices), or cancel free with its hold released.
- **A team pulls out:**
  - more than 6 hours before kickoff: €1 per player is taken from its hold, and the rest released;
  - less than 6 hours before kickoff: it counts as the losing team and pays in full.

## Weather, condition warnings and blocking pitches

Players see the forecast for their match. Venues can warn about bad conditions or close pitches to new bookings. **Agreed.**

### Forecast for players
- Shown on the venue page, on the booking screen and on each upcoming game: rain, wind and temperature for the match hours.
- When conditions look bad, a banner appears: **"Heavy rain forecast. The venue may cancel this booking."** It only warns and never promises a cancellation.
- **Data: Apple WeatherKit**, called from Futty's server so it works on Android too.
  - Futty's Apple Developer membership already includes 500,000 free calls a month.
  - Each venue's forecast is fetched at most once an hour and cached.
  - Apple requires its "Weather" mark and a data-sources link next to the forecast.
  - Open-Meteo's free tier is for non-commercial use only, so it isn't an option without paying.
- **Confirmed thresholds:**
  - rain chance of 60% or more, or heavy rain, in the match hours;
  - wind of 40 km/h or more;
  - thunderstorms;
  - 38°C or hotter.

The forecast only reaches about 10 days ahead. Further out, the app shows "Forecast available closer to the date".

### Venue condition warning
- The venue flags a day or time slot as **"conditions may be unsuitable"** (waterlogged, storm coming). Every player booked then is notified.
- Normal cancellation rules apply. The point is that players hear in time to cancel before the 6-hour cutoff and keep €5.80 as credit.
- **Confirmed:** the dashboard nudges the venue when the forecast for one of its booked slots is bad, at least 12 hours before kickoff, so warnings come early enough to use.

### Blocking pitches
- The venue picks a day, or a time range on a day, and marks pitches **unavailable**. Nobody can book them.
- **Blocking stops new bookings only.** Games already booked stay on, and their players are told the venue has closed new bookings.
- **Joining (decided 9 November):** players can still join a game that was booked before the block. The join screen shows the venue's notice that it has closed new bookings.
- If the venue then cancels one of those games, the venue-cancels rule applies: full refund or credit, and the venue pays Stripe's €0.35 per player.

## Bookings and their match (decided 11 November)

Every game booking has one match record (docs/specs/match-record.md, section 6.1).

- **Which bookings:** only bookings with a payment mode (made since P4a) get a match. Owner blocks and older bookings never do.
- **Created or re-synced** when a booking is confirmed, when it is moved (day, time or venue), and when a player joins or leaves.
- **Cancelled:** a cancelled booking voids its match.
- **A failure never blocks money:** if the match sync fails, the booking, payment or cancellation still goes through and is never rolled back. The error is caught and a retry is queued.
- **Retries** run after 1, 5 and 15 minutes, then every 60 minutes, until the sync succeeds or the booking's match is void.
- **Alert:** the founders get the existing admin alert once, at the third failure.

## Venue pages and the venue data import (decided 11 November)

Venues are loaded from the Futty Venue Data sheet by an import script (`scripts/import-venues`). Its rules:

- **Not live:** every venue is imported with `is_live = false`. Going live is a separate step, after the venue signs.
- **Photos need permission:** a photo is imported only when `photo_permission_given` is yes. Without permission the venue is still imported, with no photos.
- **Never guess:**
  - blank cells stay empty, and a price, hours or a pitch is never guessed;
  - a close of "00:00" is the end of that day;
  - a close after midnight (e.g. "01:00") isn't supported yet, so that day's hours are skipped and listed in the import's report.
- **Amenities:**
  - "yes" counts, keeping a note in brackets such as "(free)" but not a source note such as "(per activeplanet.com)";
  - "no" isn't shown;
  - anything else (e.g. "equipment rental listed") is skipped and reported.
- **Pitches:** the sheet's free-text pitch description is kept for Futty's own use only. It isn't shown, and no pitches are shown until real ones are entered.
- **No price, no booking:** a venue with no price can't be booked.
- **Peak prices:** the `price_peak` / `price_offpeak` columns aren't used yet, because peak pricing isn't decided. They stay in the sheet and aren't imported.
- **Food and drink:** items are imported with their price, offer price and dietary tags.
- **Same result every time:** the import is idempotent, keyed on `venue_id` (V001...). An existing venue is matched only through an optional mapping file (`venue_id` -> existing venue id), never by name.
- **A re-import never changes `is_live`:** a venue the import creates is not live, but a venue that already exists (already imported, or named in the mapping file) keeps its setting. Re-running the import never switches a live venue off, or on.
- **A blank `active` cell** imports the item as not active, and the report lists it.
- **An item removed from the sheet** is switched off, not deleted.
- **Withdrawn photo permission:** the venue's photo rows are removed and its files are deleted from storage. A photo file can be read only while a photo row (or an item's photo) points to it.

**Who sees a venue:**
- A venue that isn't live is hidden from discovery: it's not in the Book list, and a player with nothing there can't reach its page. It can't be booked.
- It isn't hidden from players who already hold a booking, a debt or credit there. They still see the venue on their bookings (name, address, their booking details) and its page, with the Book bar off. Its owner always sees it.
- A live venue with no price shows its page with the Book bar off and "Not taking bookings yet".
- **Directions:** on iPhone, "Directions" offers Apple Maps or Google Maps. On Android it opens Google Maps.

## Booking screens (decided 12 November)

The booking screens (P5) show only amounts the server computes: `booking_quote` for checkout, `venues_free_at` for the Book list, `booking_detail` for a booking, `my_owed` and `my_credit` for debt and credit.

- **Game length and start times:** the Book flow offers games of 60, 90 or 120 minutes (60 by default), starting every half hour from 07:00 to 23:30, Cyprus time. A start time is offered only if the game ends by midnight. The server still checks every slot against the venue's opening hours.
- **Players per side:** the Book flow picks the format before the venue. "Players per side: 5 v 5 / 6 v 6" shows after 5-a-side is picked, only when at least one live venue allows 6 v 6 on 5-a-side pitches. Picking 6 v 6 lists only those venues. Coming from a venue page, it shows only if that venue allows it.
- **Cash:** offered by the server's rules only, in the two each-pays modes. Never with venue credit, and never to a player in debt. There is no venue setting for cash; every venue accepts it.
- **Who sees the roster:** everyone in a booking sees each player's name and paid state (in app, cash, cash paid, unpaid). Only the booker sees everyone's amounts; the other players see only their own.
- **Testing a booking end to end:** the SQL tests run `book_slot` in each of the three modes through to a confirmed booking against the local database. The app's Jest tests check that the chosen mode reaches `book_slot`; they don't need a database.

## Server-side checks that make it airtight

The app can be tampered with, so every rule that involves money or availability is checked on Futty's server. The app only displays the result.
- **Prices come from the venue's data on the server,** never from the app.
- **Player numbers are checked:** 10 / 14 / 18 / 22 per format, and 12 only where the venue allows 6 v 6. *Today the server accepts any number, so a booking for "100 players" would cost €0.60 each.*
- **Booking windows:** 7 days for standard accounts and 14 for Premium. Premium status comes only from Apple's verified purchase.
- **Gipedo Pano** is refused more than 6 days ahead.
- **Cyprus time:** "in the past" and every cutoff are measured in Cyprus time. *Found 7 Nov: the code compared against UTC, so in winter a slot that started up to 2 hours ago could still be booked (3 hours in summer). Fixed in pull request \#20.*
- **A sensible slot:** the end is after the start, within opening hours; pitches between 1 and what the venue has; a format the venue offers.
- **Blocked pitches** are refused for new bookings; a game booked before the block can still be joined. **Unsigned venues (the live/not-live switch) and players in debt** are refused when booking, joining and choosing cash.
- **Only a venue's own staff** can tick cash, settle debt, block pitches, flag conditions or cancel that venue's bookings. Only the booker can cancel the whole team or switch 5 v 5 / 6 v 6; switching closes 6 hours before kickoff.
- **Every money movement happens once.** Each Stripe call carries an idempotency key, and each movement is written to a ledger with its reason.
- **The books always balance:** for every booking, venue + Futty + Stripe + refunds + credit = what was taken. A daily check flags any booking where they don't.
- Stripe webhooks are signature-checked and scheduled jobs need the cron secret (already live).

**Tests (decisions doc: no PR without them):**
- **Database tests** for every rule above. They run in CI against a fresh local database on every pull request.
- **Edge Function tests** with Stripe in test mode, or mocked, for:
  - holding and taking payments;
  - refunds and credit;
  - top-ups;
  - the booker's hold;
  - Gipedo Pano settlement.
- Each worked example in this document becomes a test case with that exact amount.

## Confirmed rules and build order

Every rule below was ticked by the founders on 7 November 2026.
- ✓ Premium booker paying for everyone: only their own spot is fee-free
- ✓ a failed payment becomes the booker's debt (the whole unpaid amount if responsible, their own share if not); the booking stays on
- ✓ Booker cancels the whole team: €1 for each player who paid; the others get everything back
- ✓ Booker paid for everyone and cancels in the middle window: €1 per player kept
- ✓ the whole team can be cancelled less than 6 hours before kickoff, with no refunds, and the slot becomes free for others to book
- ✓ "Joined" means holding a spot, not turning up
- ✓ Only the booker can switch 5 v 5 / 6 v 6; no money moves when the booker paid for everyone
- ✓ Debt payments add no new fee
- ✓ Cash player cancelling: the €0.80 fee is kept after the first hour
- ✓ Credit expires after 12 months (pending legal advice)
- ✓ Gipedo Pano: €0.55 per player fee, result confirmation, no-opponent and pull-out rules
- ✓ Weather thresholds, and the venue nudge at least 12 hours before kickoff

### Build order

Each step is one pull request with its tests. The safety base comes first because everything else depends on it. The step-by-step Claude Code prompts are in 14 Futty – Claude Code Prompts.
1.  **Test setup in CI, plus the server checks:** player numbers, 7/14-day windows, Cyprus time, slot checks, the live/not-live switch.
2.  **The three booking modes and fees:** €0.55 / €0.80 / Premium €0; taking money at +1 hour; non-refundable late bookings; the booker's guarantee hold.
3.  **Cancellations:** the timings, the venue-credit record, venue cancellations, and the record of what Futty owes each venue.
4.  **Collection 2 hours after the match:** top-ups, the booker's hold, debt and the debt block. The 3-hour auto-cancel is removed.
5.  **The venue dashboard:**
    - the cash roster and ticking;
    - debt and credit views;
    - blocking pitches;
    - condition warnings;
    - the 6 v 6 setting.
6.  **6 v 6 on the booking form**, and switching.
7.  **Gipedo Pano fixes**, and switching settlement on.
8.  **Weather** with WeatherKit.
9.  **Premium:** €3.99, 14 / 7 days, updated in the app and in the Futty AI's answers.

**Timing risk:** this is about two weeks of focused work, and code-complete is Friday 20 November. If it slips, steps 8 and 6 (weather, switching) can follow straight after the App Store submission without touching any money rules.

### Founder tasks that unblock the build
- ☐ Panos: create a WeatherKit key in Apple Developer (Certificates, Identifiers & Profiles, Keys)
- ☐ Panos: set the Premium subscription to €3.99 in App Store Connect
- ☐ Panos: fix the live Stripe account details before any real payment
- ☐ Owner to name: legal advice on venue credit and the terms (decisions doc \#16, G)
