# Futty – Payments & Fees

As of 7 November 2026 · Owners: Panos (build, coding track P) · Anghelo (fee review) · Dimitris (processor quotes)

**Futty keeps at least €0.30 per player on any EEA card after every Stripe cost, and the venue always receives its full pitch price.** Decided 7 November: €0.55 per player when the booker pays for everyone, €0.80 per player when each player pays their own share, €0 for a Premium player's own spot. The full rules (three booking modes, payment timing, cancellations, venue credit, cash and debt, short games, 6 v 6, Gipedo Pano, weather) are in **13 Payments & Bookings Spec**, which wins wherever this doc disagrees.

## Stripe's costs for a Cyprus business

- Standard EEA cards: 1.5% \+ €0.25 per payment. Premium EEA cards: 2.8% \+ €0.25. UK: 2.5% \+ €0.25. International: 3.15% \+ €0.25. ([Stripe Cyprus pricing](https://stripe.com/en-cy/pricing))  
- Apple Pay, Google Pay and Revolut Pay cost the same as the card behind them. Apple and Google charge merchants nothing, but they aren't processors: Stripe still processes the payment. ([Google Pay API](https://developers.google.com/pay/api))  
- Stripe Connect, with Futty handling pricing: \$2 per active venue a month, plus 0.25% \+ 25¢ per payout. ([Connect pricing](https://stripe.com/fr-us/connect/pricing)) About €0.015 per player per booking; included below.  
- Refunds: Stripe keeps its original processing fee. ([Stripe pricing](https://stripe.com/pricing))

The €0.25 is charged per payment, which is why splitting into 10 payments needs a higher fee than one payment.

## The fee structure

Example: 5-a-side, €60 pitch, 10 players (5 v 5), €6.00 each.

|  | Booker pays for everyone | Each pays their own share |
| :---- | :---- | :---- |
| Futty fee | €0.55 per player | €0.80 per player |
| What players pay | Booker pays €65.50 in one payment | Each pays €6.80 |
| Stripe payments | 1 | 10 |
| Futty keeps, standard EEA card | about €0.41 per player | about €0.43 per player |
| Futty keeps, premium EEA card | about €0.33 per player | about €0.34 per player |
| Futty keeps, international card | about €0.30 per player | about €0.32 per player |
| Venue receives | €60.00 | €60.00 |

Show both prices on the payment screen: "Pay for everyone: €65.50" and "Each pays: €6.80 each". The cheaper per-head price nudges bookers to pay for everyone, which is also cheaper for Futty to run.

The current code (merged 6 November) charges €0.80 per player and only supports splitting. The booker-pays option at €0.55, Premium at €0 and the other modes are built in 14 Claude Code Prompts, P4a.

## Why the venue earns more through Futty

- **At its terminal** the venue's provider (Stripe, Viva or JCC: check each venue) keeps roughly 1–2%, so a €60 booking nets about €58.80–€59.40.  
- **Through Futty** the venue receives the full €60: Futty pays every card fee out of its own fee.  
- **No-shows still pay:** a no-show's share was already taken; anything unpaid is covered by the booker's guarantee or becomes the player's debt to the venue, which blocks them from booking anywhere on Futty until paid.  
- **Empty slots get filled** by "Need players", "Need opposition" and open games.

Say "you get your full price, and no-shows still pay you" in the venue pitch.

## How the money moves (decided 7 November; details in 13)

1. **Three booking modes**, chosen by the booker: *booker pays for everyone* (one payment, €0.55 per player); *each pays, booker responsible* (each player pays their share by card or cash, and the booker's card guarantees the rest); *each pays, just my spot* (each player pays; anyone who doesn't pay owes the venue).
2. **Timing:** each payment is held when made and taken 1 hour later. A booking made less than 6 hours before kickoff is taken at once and is non-refundable. The booker's guarantee is held for the full pitch price 3 days before kickoff.
3. **Collection 2 hours after the match:** short games are topped up (the players who joined split the full pitch price; Futty absorbs Stripe's fee on top-ups); unpaid amounts come from the booker's guarantee (responsible mode) or become that player's debt to the venue (just my spot). **The game is never cancelled for money.** The 3-hour auto-cancel is removed.
4. **Debt** is owed to the venue and blocks booking, joining and paying cash anywhere on Futty until paid in the app or marked settled by the venue.
5. **Payouts (decided 7 November):** Stripe Connect with separate charges and transfers (not destination charges), so cancellations, venue credit and the venue's Stripe fee on venue cancellations never need money pulled back from a venue (14, P4d).

## Cancellation and refunds (decided 7 November)

| When a player cancels their own spot | What happens (€6.80 share) |
| :---- | :---- |
| Within 1 hour of paying (booked more than 6 hours before kickoff) | The hold is cancelled: everything back, no cost to Futty |
| From 1 hour after paying until 6 hours before kickoff | €1 kept by Futty (about €0.65 after Stripe); €5.80 becomes credit at that venue |
| Less than 6 hours before kickoff, or booked less than 6 hours before | No refund |
| No-show | No refund |
| Venue cancels (weather, maintenance) | Whole share back, by card refund or venue credit (player's choice); the venue pays Stripe's fee (about €0.35 per player) from its next payout |

- **Booker cancels their own spot:** it becomes an open spot and the other players are notified to fill it.
- **Booker cancels the whole team (each pays):** the other players get their full share back (card or credit, their choice); the booker pays €1 for every player who had paid.
- **Booker paid for everyone:** in the middle window €1 per player is kept and the rest becomes credit.
- **Less than 6 hours before kickoff** the whole team can still be cancelled, with no refunds, and the slot is released for others to book.
- **A late-cancelled spot that gets filled:** the venue keeps both payments.

**Venue credit** is spent only at the venue that issued it, can't be cashed out and expires after 12 months. It pays the pitch part with no service fee; a shortfall is paid by card plus €0.80. Legal advice on stored value (01, #16) is still needed before real money flows.

## Gipedo Pano (decided 7 November)

- Each team's captain authorises a hold for the **full** pitch price plus €0.55 for each of the 10 players (€65.50 on a €60 pitch).
- After the game, captains confirm the result. The **loser's** hold is captured in full and the winner's released. **Draw or dispute:** half of each hold is captured.
- If only one captain enters a result, it stands after 24 hours; if nobody does, 50/50.
- Only for games within 6 days, because Stripe holds expire after 7 days ([Stripe support](https://support.stripe.com/questions/does-stripe-support-holding-an-authorization-for-more-than-7-days-before-capture)).
- No opponent 24 hours before kickoff: play as a normal booking or cancel free. A team that pulls out more than 6 hours before pays €1 per player; less than 6 hours before, it counts as the loser.
- A cost for disputing is left to the venue's and players' discretion for now.

## Cash at the venue (decided 7 November)

- A cash player pays Futty's €0.80 fee by card when joining.
- The venue dashboard lists every player's payment choice; staff tick cash players as they pay.
- After the match an unticked cash player is asked to pay by card or remain in debt to the venue. Unpaid at collection: the booker's guarantee pays (responsible mode) or the player owes the venue (just my spot).

## Processor

Stay on Stripe for launch. Dimitris is collecting quotes from JCC and Viva (01, 5 November).

## Actions

- [x] Panos and Anghelo: confirm €0.55 and €0.80 (7 November)  
- [ ] Panos (Claude Code, 14: P4a–P4d, P8): booking modes, payment timing, cancellations and credit, collection and debt, payouts, Gipedo Pano  
- [ ] Panos and Anghelo: decide whether to add Revolut Pay (not in the 7 November decisions; Apple Pay and Google Pay are live)  
- [ ] Dimitris: payment screen and refund wording; refund table in the terms  
- [ ] Anghelo: after the first month, check the real card mix in Stripe; adjust fees if Futty's take drops under €0.30