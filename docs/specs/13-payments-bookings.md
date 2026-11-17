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
  - **The venue cancels:** the venue owes Stripe's real fee on every payment that was taken, whether the player takes a card refund or credit, so Futty neither earns nor loses on that booking. Before staff confirm, the venue's cancel quote shows that amount: "Stripe's fees on these payments: €X.XX. This comes off your next payout." The server adds up the fee recorded for each card payment this cancel refunds or turns into credit, the same amount the cancel then records as owed. Nothing is shown when it is €0.
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
  - **Money the venue took in person is never paid out (decided 13 November):** the ledger kinds `cash_received`, `counter_paid` and `debt_cash_received` (see "Venue dashboard") are left out of payouts by name, because the venue already holds that money.
  - **Decided 16 November (P4d):**
    - **One transfer per booking, once its money is final:** after its collection (each pays); when its collection would run, the match's end plus the collection delay (pay-all); once every Gipedo Pano settlement is done; once a cancelled booking's refunds and card-or-credit choices are done. The transfer is what the ledger says the venue earned on that booking (`venue_cents`) that no transfer has covered yet.
    - **What the venue owes comes off its next transfer** (for example Stripe's fee on its own cancellation, or Futty's part of a debt it settled in person). A venue whose balance is below zero is never charged: it shows on its Payouts screen as owed to Futty and waits for its next booking.
    - **Late money** on a booking already paid out (a debt paid by card, a late top-up) goes in a further transfer on the next run of the payout job.
    - **No transfer until the venue is live (signed) and has finished Stripe onboarding.** Its money waits and goes out on the first run after both. Stripe can't be in test mode for one venue and live for another: switching Stripe to live keys is a separate production step.
    - **Futty's available balance (PR #81 review):** transfers draw on Futty's available Stripe balance, and card money is pending in Stripe for days first. A shortage is waiting, not failure: pending payouts are sent oldest first while they fit in the available EUR balance; one that doesn't fit, or that Stripe refuses for lack of balance, waits for the next run with no attempt counted and no alert. The Payouts screen says the money is waiting for card payments to clear in Stripe. The daily check reports the total waiting and the oldest waiting payout.
    - **Test data at the switch to live keys (PR #81 review):** each venue's Stripe account records its mode (test or live). An account from the other mode is never paid, and onboarding creates a new account in the current mode. **Payouts start at a venue only from its `payouts_from`** (set by Panos when the venue goes live on live keys; nothing while it is empty). Bookings created before it never transfer and are never reported missing; the Payouts screen shows them as "before Futty payouts".
    - **Bank payouts** from the venue's Stripe account follow Stripe's default schedule; the venue sees them in its Stripe Express dashboard, linked from the Payouts screen.
    - **A daily check** alerts the founders to any booking whose books don't balance, and to money that was due before the last payout run that no transfer covered.
- **Credit sits with the venue.** Futty sends the venue its credit money at the next payout and keeps a record of each player's credit there. The decisions doc (#16) still asks for legal advice on this before real money flows.
  - **In the ledger (decided 10 November):** credit money is the venue's from the moment the credit is issued, so it is paid out at the next payout as usual. When a player chooses credit, Futty's service fee goes to the venue with it. Spending, returning or expiring credit later moves no new money to the venue; the ledger only records the change in credit the venue holds. Every booking still balances: venue + Futty + Stripe + refunds = what was taken.

## Short games, top-ups and 6 v 6

If fewer players join than the booking is for, the players who joined split the full pitch price, charged as a top-up after the match. **Agreed.**

**Example:** a 5 v 5 played 4 v 4 = €60 ÷ 8 = €7.50 + €0.80 = **€8.30 each**, so each player gets a **€1.50 top-up**.
- **6 hours before kickoff:** everyone in the booking gets "You're 8 of 10. If nobody else joins, each player pays €1.50 extra after the match." The notice has the buttons to request a player.
- **2 hours after the match**, top-ups are charged to each player's saved card. Someone who joins at the last minute just makes the top-up smaller, with no refunds.
- **Futty absorbs Stripe's fee on top-ups.** That's about €0.27 on €1.50, leaving Futty about €0.18 per player in that game.
- **Cash players' amount goes up** on the venue dashboard: €7.50 instead of €6.00.
- **A cash player already ticked as paid is topped up by card like everyone else (decided 16 November).** They saved a card when joining, so the difference between their pitch part and the cash they paid is charged to it with the other top-ups, with no extra fee. A failed top-up takes the normal path: the booker's hold covers it (responsible mode) or it becomes the player's debt (just my spot). This applies to every short game and to a switch to fewer players. For example, a 5 v 5 played by 9 = €60 ÷ 9 = €6.66 (the booker €6.72): a ticked cash player who paid €6.00 gets a **€0.66 top-up**. A cash player who paid by card in the app after the match already paid what was due then and owes nothing more.
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
- **Decided 16 November (switching):**
  - **The €1.00 is the difference in each player's pitch part** (pitch price ÷ 10 minus pitch price ÷ 12), computed from the booking's price, not a fixed amount. The booker carries the leftover cents, as when paying; when the booker gave up their spot, the first player who joined carries them, as in collection. For example, a €55 pitch: €5.50 → €4.58 is €0.92 credit, and the booker's €5.50 → €4.62 is €0.88.
  - **A share that's held but not yet taken** gets its credit when it is taken. A payment started at the old price that lands after the switch is treated the same way.
  - **A share paid with credit:** the €1.00 goes back to the credit that paid for it first (latest-expiring first, keeping its expiry), as in cancellations; only a card-paid part becomes new 12-month credit.
  - **A cash player not yet ticked as paid** gets no credit: the cash they owe drops from €6.00 to €5.00. A cash player already ticked as paid is treated like a card payment: €1.00 credit.
  - **Premium players** get the pitch-part difference too.
  - **Cancelling after a 5 v 5 → 6 v 6 switch** works from what's left after the credit: the venue cancels, €5.80 goes back to the card and the €1.00 credit stays; the player cancels in the middle window, €4.80 credit; the player cancels late, €5.00 counts toward the pitch price.
  - **A booker who paid for everyone and cancels after a switch** keeps €1 per player counted on the number of players they paid for at booking, since switching never changes what they paid.
  - **One switch per booking,** either direction. A second switch is refused, so credit can't be issued and spent before the top-up is collected.
  - **6 v 6 only on 5-a-side pitches:** a 5 v 5 booked on a bigger pitch can't switch to 6 v 6. Gipedo Pano bookings can't switch.
  - **Exactly 6 hours before kickoff is still allowed,** as for cancellations.
  - **6 v 6 → 5 v 5 with a cash player already ticked as paid (decided 16 November):** they are topped up by card like a card player, €1.00 on a €60 pitch (€5.00 paid in cash, €6.00 due), with the normal failed top-up path (see Short games).

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
- **Only for games within 5 days** (6 days when agreed; changed to 5 by decision 5 below, to be confirmed), because holds expire after about 7. Choosing a date further ahead shows: "Gipedo Pano can only be booked up to 5 days ahead."
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

**Decided by Dimitris 12–13 November, to be confirmed by Panos and Anghelo (P8).** These are not yet agreed by the founders or in the Google Doc. P8 is built to them; any that changes on review changes the code with it.

12 November:
1. **No opponent, "play as normal"** means the booker pays for everyone, taken from the hold already placed (a Premium captain €64.95, the rest released). If the captain hasn't chosen by 6 hours before kickoff, the booking is cancelled free and the hold released. The opposition post closes 24 hours before kickoff.
2. **Pull-out more than 6 hours before kickoff:** the €1 per player goes to Futty, and the matched game is called off. If the opponent pulls out, the post reopens (it stays closed from 24 hours before kickoff), the booking team keeps its hold and gets the same choice at 24 hours. If the booking team pulls out, the booking is cancelled, the slot freed and the opponent's hold released free.
3. **An expired hold:** whatever should have been taken from it becomes that captain's debt to the venue, as with the guarantee hold. A winner's expired hold owes nothing.
4. **All formats:** the fee is €0.55 × the players in the booking. An odd cent in a 50/50 split goes on the booking team: the pitch price is split exactly, and the two holds' fees together are halved, rounded up, with the opponent paying half its own fee rounded down (a Premium opponent's €64.95 hold: the booking team pays €32.76, the opponent €32.47). A Premium captain's own spot is fee-free, as when the booker pays for everyone.

13 November:
5. **5 days, not 6:** kickoff is at most 120 hours away when it is booked (changed from 144 hours on 13 November). A hold is placed at booking and Stripe keeps it for about 7 days (168 hours). With 144 hours, a game of up to 2 hours and the 24-hour result window, settlement could come 170 hours after the hold, so the loser's hold had often expired and the venue got a debt instead of the money. With 120 hours it comes at most 146 hours after, so every hold is still there. A hold that expires anyway still becomes a debt (decision 3), as the fallback.
6. **Gipedo Pano is refused less than 24 hours before kickoff**, so there is time to find an opponent.
7. **After "play as normal"** the booking cancels under the pay-for-everyone rules.
8. **A pull-out fee that can't be taken** (the hold expired) is a debt owed to Futty.
9. **An opponent captain's offer lapses** if their hold isn't placed within 15 minutes; the post reopens.
10. **Card only:** no cash and no venue credit, for either team's hold.
11. **The booking team leaving before any opponent's hold is placed** is a free cancel: the booking is cancelled and the hold released.

Also built into P8, from the review of 13 November:

12. **Exactly 6 hours before kickoff** a pull-out pays the €1 per player, not the forfeit, as for cancellations ("exactly 6 hours is not less than 6 hours").
13. **A captain who pulled out can't offer again** for the same game (`cannot_rejoin`), as a player who cancels can't rejoin.
14. **A player already in the booking can't be its opponent captain** (`already_in_booking`).
15. **The pull-out fee is capped at the hold.** At €1 per player it never reaches it, but no hold is ever asked for more than it holds.
16. **No pull-out after kickoff.** From kickoff the result decides who pays.
17. **A forfeit settles at once:** a pull-out less than 6 hours before kickoff confirms the match as that team's loss straight away, so its hold is taken and the other team's released before the game.
18. **Cancelling while a settlement waits:** when the booker cancels the whole team (after "play as normal") or the venue cancels, a "play as normal" or pull-out settlement not yet carried out is stood down and the normal cancellation rules decide what the hold pays. While one is being carried out at Stripe, cancelling waits ("Try again in a minute"). Once one is carried out, its money is treated as any payment already taken: "play as normal" cancels under the pay-for-everyone rules, and a pull-out fee stays with Futty, as the €1 from an earlier middle-window cancellation does.

**How it's built (P8):** Gipedo Pano is the fourth booking mode, chosen at checkout by a team's captain for that team. Each captain's hold is never taken at +60 minutes, and the booking is left out of the 2-hour collection. The settlement runs every minute in `run-payment-jobs`: the loser's hold is taken in full, the winner's released, and a 50/50 split takes half of each hold with a partial capture. A pull-out less than 6 hours before kickoff is recorded as that team's forfeit, so it settles as the loser. A hold Stripe lets expire is marked expired (the captain isn't asked to pay again) and settles as gone: what it should have paid becomes the debt of decision 3 or 8. Bookings whose Gipedo Pano was chosen on the squad post before this keep the old logic and its own job (`settle-gipedo-pano`).

## Weather, condition warnings and blocking pitches

Players see the forecast for their match. Venues can warn about bad conditions or close pitches to new bookings. **Agreed.**

### Forecast for players
- Shown on the venue page, on the booking screen and on each upcoming game: rain, wind and temperature for the match hours.
- When conditions look bad, a banner names the reason and then says **"The venue may cancel this booking."** It only warns and never promises a cancellation. The reasons (decided 16 November):
  - rain chance or heavy rain: **"Heavy rain forecast."**
  - wind: **"Strong wind forecast."**
  - thunderstorms: **"Thunderstorms forecast."**
  - heat: **"Extreme heat forecast."**

  When several are met, all their reasons appear on one line, in that order and each once, e.g. "Strong wind forecast. Extreme heat forecast. The venue may cancel this booking."
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
- **Removing a block (decided 14 November, Dimitris; for Panos to confirm):** staff can remove a block their venue added. It only reopens the slot to new bookings and never touches existing bookings, their players or their money.

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
- **"Need players" / "Need opposition" posts:** a new post made from a booking offers no payment choice and no Gipedo Pano; the players who join pay by the booking's own mode. Gipedo Pano comes back as a checkout mode in P8. Posts made before this keep working as they are.
- **Testing a booking end to end:** the SQL tests run `book_slot` in each of the three modes through to a confirmed booking against the local database. The app's Jest tests check that the chosen mode reaches `book_slot`; they don't need a database.

## Venue dashboard (decided 13 November, Dimitris; for Panos to confirm)

The dashboard (P6) records the money a venue takes in person, so revenue by source can be read from the ledger's `venue_cents`.

- **Walk-in and phone bookings:** staff add them at the counter. They hold real pitches, so the app can never double-book them, and they're refused on blocked pitches, outside opening hours and once the game has ended.
  - **Price:** the server fills in the venue's price for that slot; staff may change it (for example a discount for regulars). Both the venue price and the amount charged are kept, and revenue shows when they differ. Both are kept only with the walk-in's own details: the booking's `amount_cents`, which app players are priced from, is always 0, so the amount staff typed can never be charged by card.
  - This money never goes through Futty or Stripe, so working rule 2 (the server computes every amount) doesn't apply to the amount charged.
  - Staff mark it paid by **cash or card at the counter**: one `counter_paid` ledger row for the amount charged (nothing for a free booking).
  - **A paid walk-in can be cancelled** up to kickoff: a reversing `counter_paid` row takes the amount back off the venue's revenue.
  - Walk-ins and phone bookings have no match, no players, no payment mode and no collection. Their booker is the staff member who added them, so every path that trusts the booker (cancelling, quotes, invites, squad posts, booking detail, adding players) refuses them; only the dashboard's own cancel cancels them. Only that venue's staff are told a booking is a walk-in; anyone else asking for a cancellation quote gets the same answer as for someone else's app booking. The old 3-hour auto-cancel for unpaid shares never touches them, and they (like an owner's training blocks) don't count as the staff member's upcoming games when deleting their account.
  - **Customers:** a phone number is stored in one form (`+357XXXXXXXX` for Cyprus; other countries keep their `+` code), so a caller is one customer however the number was typed. When a known number books again, the name given that time is kept.
- **Ticking cash:** when staff tick an app player's cash as paid, the share's pitch part at that moment (e.g. €6.00) is recorded once as a `cash_received` ledger row.
  - **Ticked cash in a cancellation (decided 13 November, Dimitris; corrected the same day; for Panos to confirm):** ticked cash follows the cancellation rules exactly as if the player had paid it by card. The card part alone goes through Stripe; the cash is worked out beside it, in the same quote.
    - **Handed back** only when a card player would get money back: the venue cancels (including a share already forfeited by a late cancel, as for a card player), a player cancels in the free hour, or the booker cancels the whole team more than 6 hours before kickoff. One reversing `cash_received` row takes it back off the venue's revenue.
    - **Middle window** (after the free hour, more than 6 hours before kickoff): as for a card player, €1 is kept over card and cash together and the rest becomes credit at the venue. Example: a cash player paid €0.80 by card and €6.00 cash; €0.80 of card and €0.20 of cash are kept, and €5.80 becomes credit. The venue keeps the cash (credit money is the venue's from the moment it's issued) and the share is credited.
    - **Late** (inside 6 hours, by the player or the whole team): nothing comes back, so the venue keeps the cash.
- **A debt settled at the venue (decided 13 November, Dimitris; for Panos to confirm):** when staff mark a debt settled, the player paid the venue in person, so the whole debt is recorded once as a `debt_cash_received` ledger row (`venue_cents` = the debt, e.g. €6.80). Futty's part is still owed by the venue (the `venue_payable` row), so revenue nets €6.00. A debt paid by card in the app stays a Stripe payment.
- **`cash_received`, `counter_paid` and `debt_cash_received` are excluded by name** from P4d's payouts and from the daily balance check.
- **Condition warning words:** "[Venue] says conditions may be unsuitable on [day, time]. Normal cancellation rules apply: cancel at least 6 hours before kickoff to keep your money as credit at [venue]." Sent as `venue_condition_warning` to every player still in each game the flag covers that hasn't ended, the booker included only while still in (a free game has no shares, so its booker is told). Each player is warned once per game, however many flags overlap it.
- **Still in a game** (everywhere on the dashboard: warnings, the roster, the joined count): a share that is pending, authorized, paid or covered, as the cancellation rules count it. A player who left with credit, by forfeit or for a refund isn't.
- **Revenue (P6b):** dated by when the money moved, as a Cyprus date; weeks run Monday to Sunday. Revenue sums the ledger's `venue_cents`, never `amount_cents`: a reversal (a cancelled paid walk-in, cash handed back) has a positive `amount_cents` and a negative `venue_cents`.
  - **Sources (decided 13 November, Dimitris; for Panos to confirm):** *app card* is every row that went through Stripe or moves money between Futty and the venue (captures, refunds, transfers, venue payables). *App cash* is ticked cash (`cash_received`, with its reversal) and debts settled at the venue (`debt_cash_received`), with Futty's part of that debt (the `venue_payable` for it), so a settled €6.80 debt shows €6.00. *Walk-in* and *phone* are `counter_paid`, by the walk-in's source. Rows that move no money (holds, credit and debt records) aren't revenue.
  - **Fees:** Futty's fee and Stripe's fee are shown separately, as the ledger has them (`futty_cents`, `stripe_fee_cents`). On a €6.80 share that is €6.00 venue, €0.45 Futty and €0.35 Stripe.
  - **The CSV** has the same rows and totals as the screen: Cyprus dates, amounts in euros with two decimals. Walk-in and phone rows show the venue's price and the amount charged. It is built from one server response (the rows, each source's total and the total, read at the same moment), ends with each source's total and the total, and starts with a UTF-8 byte order mark so Excel reads Greek names (commas separate the columns). The Futty column is the ledger's `futty_cents`, so it is headed "Futty", not "Futty fee": it also holds what the venue owes Futty and what Futty keeps from a cancellation. **(Decided 17 November, Dimitris; for Panos to confirm)** Before sharing, the app checks the export's period, each source's figures and the totals against the screen's; if anything differs (money moved since the screen loaded), it shares nothing, says so and reloads the screen, so staff never get a file that disagrees with what they saw.
    - **The payouts CSV (decided 17 November, Dimitris; for Panos to confirm)** sits next to it on the Money screen ("Export payouts CSV", for the same day, week or month), so the venue's owner can match Futty's transfers against their Stripe Express dashboard. A payout belongs to the period by when it was sent (`sent_at`, as a Cyprus date). It has one line per payout and booking: the sent date and time (Cyprus), the payout, its Stripe transfer id, its status (sent or reversed), the booking, its day and kickoff, and what that payout sent for the booking (its `venue_payout_items.venue_cents`, which can be below zero when the payout took back money the venue owed). Then each payout's total (`venue_payouts.amount_cents`), the total sent and the total reversed. Every amount is read from `venue_payouts` and `venue_payout_items` in one server response; the app refuses a file whose totals aren't its lines. Payouts not sent yet are left out (the Payouts screen shows them). A reversed payout stays in the period it was sent in. A partially reversed payout is still "sent" there, as on the Payouts screen; only a payout reversed in full counts in the total reversed. Above the button: "Stripe pays your bank on its own schedule, so one bank deposit can hold several transfers. Your Stripe dashboard shows which."
  - **Who** is the player whose share, debt or guarantee the money is, or the walk-in's contact. Money that is the venue's own (no player behind it) has no name.
  - **Price overrides** are walk-in and phone bookings marked paid in the period at a price other than the venue's, a free one included (it moves no money, so it is read from the walk-in's own details, not the ledger).
  - **A debt the venue settled before `debt_cash_received` existed** gets its row once, dated when it was settled.
- **Customers (decided 13 November, Dimitris; for Panos to confirm):** app players are anyone with a share, debt or credit at the venue, **and (decided 14 November, Dimitris; for Panos to confirm) the booker of any game booked there**, so the booker of a free game (which has no shares) is listed. Staff see their name and their bookings, debt and credit at that venue only, never their email or phone. Walk-in and phone contacts show the name and phone staff entered. A customer at one venue is never listed at another.
  - **Booking counts (decided 14 November, Dimitris; for Panos to confirm)** count the bookings still on, as everywhere on the dashboard: for a player, a game they're still in (or, in a game they booked without a share, while it isn't cancelled); for a contact, a walk-in or phone booking that isn't cancelled. A customer's own page still lists all their bookings with each one's status.
- **Bookings list (decided 14 November, Dimitris; for Panos to confirm):** the venue's app, walk-in and phone bookings by booking day, filtered by source and status. It opens on Cyprus today and the next six days, and a range is at most **31 days, both ends counted**. This is a limit on the dashboard query, not a booking rule, so it isn't in `app_rules`: the app refuses a longer range before asking, and `venue_bookings_list` refuses it too (`range_too_long`).
- **Debt and credit lists:** debt at a venue is what's owed to that venue (a debt owed to Futty isn't listed); credit is what the player can still spend there.

## Venue setup (decided 17 November, Dimitris; for Panos to confirm)

Staff edit their venue's opening hours, closures, prices and pitches from the dashboard (P6e). Only that venue's staff can, and only through the server's setup functions: the app can't write these tables directly. Games already booked are never changed.

- **Prices:** staff can change a format's price, and its peak and weekend prices and hours, at any time. The new price applies to new bookings and quotes only. A game already booked keeps the price it was booked at, and so does every player who joins it later. Removing a format's price means that format can't be booked there ("No price, no booking"). Every price is more than €0: the main price, and the peak and weekend prices when the venue has them. A €0 price would make free games by mistake.
- **Closures and opening hours:** a closure (a range of days) or shorter hours stop new bookings only, as a block does. Games already booked stay on, and every player still in them is told that the venue has closed new bookings, with the same message as for a block. Removing a closure reopens new bookings only, as removing a block does. A closure that ended before today can't be added.
- **Told once per change:** a block tells its players once per block. In the same way, players are told once per closure, once per hours change and once per pitch closure. A new closure over the same game tells them again, even after an earlier one was removed. An hours change tells the players of each game it newly puts outside the hours, so saving the same hours again tells nobody. Closing a pitch again after reopening it tells them again.
- **Pitches:** a pitch that holds a game (past or future; a cancelled game holds none) can't be deleted, only closed. A closed pitch gets no new bookings, alone or combined; games already on it stay on, and every player still in a game on it that hasn't ended is told, with the same message as for a block. Its size and formats can't change while it holds a game that hasn't ended. Its name, surface, indoor or outdoor, description and order can always change. Deleting an unused pitch removes the combinations it was part of. Removing a combination never moves a game already booked.

## Venue notifications (decided 17 November, Dimitris; for Panos to confirm)

A venue's staff (its owner today) are told about their own venue only, through `send_notification`. Staff can turn each kind off; none is always sent.

- **New booking:** an app booking is confirmed (the booker has paid, or it was free). Walk-ins, phone bookings and owner blocks tell nobody, because staff added them.
- **Booking cancelled:** only when the booker cancels the whole booking. A player leaving their spot, or the venue's own cancel, tells nobody.
- **Short game:** when the 6-hour check finds a game short ("Short game: 8 of 10"), counted as the players' warning counts it, so the venue can offer a player.
- **Daily summary at 20:00 Cyprus time,** for tomorrow: each pitch's games in time order; for app games, players joined vs needed (still in, as everywhere on the dashboard); cash expected, as two figures: app players' cash not yet ticked, and walk-in or phone bookings not yet marked paid (which may still be paid by card at the counter); blocks (including owner blocks) and condition flags. **Nothing is sent on a day with no game, block or flag.** Every venue with staff gets it, live or not.
- **Once each:** every notice and each day's summary is sent once per staff member, however often the job runs. A summary missed at 20:00 is sent at the next run that evening, never after midnight. Nothing from before this feature is sent.
- **Cyprus time:** every day and time in the text is Cyprus time, never UTC (a 19:00 game in winter reads 19:00).

## Post-match offers (decided 17 November, Dimitris; for Panos and Anghelo to confirm)

Spec 05, "Food and drink after the game". No money moves: the player pays at the counter, so nothing goes in the ledger.

- **Who sees them, and where:** every player in the match (not one who left) sees them on the match screen once a score is in: a result was submitted, or the match is confirmed. A rejected or disputed score counts as entered (decided 17 November, Dimitris): the players are still at the venue. Anyone else who can open the match (a booker or captain who isn't playing, the venue's staff) sees nothing. A void match, or one with no venue, has no offers. On Home, a submit or accept the server took opens the match screen only when it has offers to show; otherwise Home stays as it is. Matches made since A2 only, not the older score forms.
- **Which offers:** the venue's items that are active and marked as post-match offers, available at that moment in Cyprus time. Their days are ISO weekdays (1 = Monday), and their window runs from `available_from` up to `available_to`. An item with no days or no window is on every day or all day.
- **How long:** from when a score is in until 2 hours after the match's end, or midnight Cyprus time on the match day, whichever comes first. The match day is the day of kickoff. Codes for that day can't be used after midnight, so no new code is made after it.
- **Price:** the offer price, with the normal price struck through when both exist and differ; otherwise whichever price there is. Both come from the server.
- **The code:** tapping an offer shows "Show this at the counter" with a 6-character code, with no 0/O or 1/I. Each player gets one code per offer per match; opening the offer again shows the same code. A code is valid until midnight Cyprus time on the match day. A code issued while the item was available is honoured until then, even after the item's window has closed.
- **Redeeming:** on the venue dashboard, staff type the code, check what it's for, and confirm. Only staff of that venue can redeem its codes. A code is redeemed once, and never by the player who holds it.
- **What's recorded:** one view per code (the first time the player opens that offer's code sheet; opening it again adds none), and each redemption (when, and by which staff member), per venue. Codes and redemptions stay when the player's account or the menu item is deleted, so the venue's counts don't drop; such a code can no longer be redeemed.

## Venue-offered players (decided 17 November, Dimitris; for Panos to confirm)

A venue can offer a player to a team that's short (05 §12, item 11a); the booker accepts or declines it ("Booking modes").

- **Who:** staff type the player's name (1 to 40 characters). He has no Futty account, so he isn't notified. He plays in the booking's match as a guest.
- **Which games:** a confirmed app booking in an each-pays mode (booker responsible or just my spot) with an empty spot, until kickoff. Spots taken are the players still in, the accepted venue players and the offers not yet answered. Not a pay-for-everyone booking, a Gipedo Pano booking, a walk-in or phone booking, or a cancelled one.
- **The booker answers** from the booking, until kickoff. An offer still unanswered at kickoff lapses. Staff can withdraw an offered or accepted player, and the booker can remove an accepted one, both until kickoff.
- **He takes a spot:** while he is accepted, app players can join only up to the booking's size minus the accepted venue players. Accepting and joining are checked one at a time, so only one of them gets the last spot.
- **Who pays: the team's top-up covers his spot, and the venue never charges him. Never both.** He plays free and counts as an empty spot ("Short games"). He has no share, and offering, accepting, withdrawing or removing him moves no money. Example: a €60 5 v 5 with 8 app players and 1 venue player: €60 ÷ 8 = €7.50 each, a **€1.50 top-up** for each of the 8, exactly as without him. The 6-hour warning still says "You're 8 of 10…", with €1.50.
- **A booking with no match** (its match couldn't be made yet) keeps him with the booking only, and he's shown from there. A match made later doesn't add him.
- **Notifications:**
  - **To the booker:**
    - the offer: "[Venue] offered a player", "[name] for [day] at [time]. [name] plays free; the team's amounts don't change.", with Accept and Decline;
    - a withdrawal: "[Venue] withdrew [name] from [day] at [time]."
  - **To staff,** once each:
    - accepted: "[booker] accepted [name] for [day] at [time]. [name] plays free; the team's amounts don't change.";
    - declined: "[booker] declined [name] for [day] at [time].";
    - removed: "[booker] removed [name] from [day] at [time]."
  - Each kind can be turned off.
- **Who sees him:**
  - staff see every offer on the booking's roster;
  - the booker sees open and accepted offers;
  - the other players see accepted venue players by name.

## No-shows (decided 17 November, Anghelo and Dimitris; for Panos to confirm)

Spec 05 §10 and §12 item 7: the venue's no-show record. **No money moves:** a no-show still owes their share, as "Short games" says. Nothing here touches shares, the ledger, debts, credit or Stripe.

- **Who is a no-show (Anghelo, 17 November; closes match-record.md question 9):** a player who held a spot in the booking (their share is still in: pending, authorized, paid or covered, and they haven't left the match) and didn't check in (no `match_attendance` row: QR, ticked by their captain or ticked by the venue). An opposing squad member who held no spot never counts. Neither does a venue-offered player, who has no share. A cancelled (void) game has no no-shows.
- **When it's final:** until 1 hour after the end (QR check-in still open) the player hasn't checked in *yet*. From then until the result deadline (24 hours after the end, when the captain's ticking also closes) they **didn't check in**, and the venue can still tick them. At the deadline they're a final **no-show**. "Exactly at the deadline" counts as past it.
- **Staff can tick a player who came but didn't scan** ("Mark arrived"), from 60 minutes before kickoff until the result deadline, for players holding a spot only. A venue tick counts as a check-in like any other: form, stats, man of the match and ratings (match-record.md decision 1b.2). A player ticked while man-of-the-match voting is open is told once, as for a captain's tick.
- **Undo:** staff can undo only a venue tick, in the same window, and never a QR check-in or a captain's tick. An undo is refused once the player has used the check-in: they voted for man of the match (and, from A5, rated a player).
- **What staff see:**
  - each player on the booking's roster shows *Checked in*, *Ticked by venue*, *Not checked in yet*, *Didn't check in* or *No-show*;
  - each player shows how many final no-shows they have at this venue;
  - a customer's page shows their no-show count at this venue and marks each booking where they didn't show.

  A no-show at one venue is never shown to another venue.
- **No forfeit:** a whole side not showing isn't recorded as a forfeit here. Who may record a `no_show` forfeit stays open (match-record.md question 10.1), because in Gipedo Pano a forfeit decides who pays. The side that turned up can enter the result, and it stands at the deadline.
- **No notifications** about no-shows, to players or staff.

## Rules in one place (decided 15 November)

Every number in this document lives once, in `public.app_rules`: the service fees (€0.80, €0.55, Premium €0, Gipedo Pano €0.55), the booking windows (7 and 14 days), the free hour (60 minutes, which is also when a share is taken), the €1 kept, the 6-hour refund cutoff, the 48 hours to choose venue credit after the booker or the venue cancels, the 15-minute payment window, the guarantee hold (72 hours before kickoff, retried every 6 hours), collection (2 hours after the match), credit expiry (12 months), Gipedo Pano's limits (at most 5 days ahead, at least 24 hours before kickoff), the Premium price label (€3.99) and the weather thresholds. The database, the Edge Functions, the app and the Futty AI all read it; none keeps its own copy.

- **Only Futty changes a rule** (service role), and every change is kept with what it was before.
- **A change applies at once.** Rules are read when they're used, so a new cutoff also applies to bookings already made. What a booking already stored (its pitch price and its service fee per player) doesn't change, and neither does a deadline already set: when a held share is taken, when the guarantee hold is placed, the deadline to choose venue credit, and when credit expires keep the value in force when they were set. A quote the player saw is checked again when they confirm, so nobody is charged on an old rule.
- **The app keeps the last rules it fetched** for when it's offline; a phone that has never fetched them shows a placeholder, never a guessed number.
- **The Futty AI's answers come from the same rules (decided 16 November).** It describes only what players can do in the app today: 6 v 6 switching and weather forecasts are "coming soon" until P12 and P11 ship, and each adds its own lines to the prompt then.

## Server-side checks that make it airtight

The app can be tampered with, so every rule that involves money or availability is checked on Futty's server. The app only displays the result.
- **Prices come from the venue's data on the server,** never from the app.
- **Player numbers are checked:** 10 / 14 / 18 / 22 per format, and 12 only where the venue allows 6 v 6. *Today the server accepts any number, so a booking for "100 players" would cost €0.60 each.*
- **Booking windows:** 7 days for standard accounts and 14 for Premium. Premium status comes only from Apple's verified purchase.
- **Gipedo Pano** is refused more than 5 days (120 hours) ahead.
- **Cyprus time:** "in the past" and every cutoff are measured in Cyprus time. *Found 7 Nov: the code compared against UTC, so in winter a slot that started up to 2 hours ago could still be booked (3 hours in summer). Fixed in pull request \#20.*
- **A sensible slot:** the end is after the start, within opening hours; pitches between 1 and what the venue has; a format the venue offers.
- **Blocked pitches** are refused for new bookings; a game booked before the block can still be joined. **Unsigned venues (the live/not-live switch) and players in debt** are refused when booking, joining and choosing cash.
- **Only a venue's own staff** can tick cash, settle debt, block pitches, flag conditions or cancel that venue's bookings. Only the booker can cancel the whole team or switch 5 v 5 / 6 v 6; switching closes 6 hours before kickoff.
- **Every money movement happens once.** Each Stripe call carries an idempotency key, and each movement is written to a ledger with its reason.
- **The books always balance:** for every booking, venue + Futty + Stripe + refunds = what was taken. Credit isn't added in (decided 10 November): credit money is already in the venue's share when it's issued, and the credit rows only record what the venue holds for players. A daily check flags any booking where they don't. The check leaves out `cash_received`, `counter_paid` and `debt_cash_received` by name (decided 13 November): that money never went through Stripe.
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
