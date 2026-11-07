# Futty – Payments & Fees

As of 6 November 2026 · Owners: Panos (build, coding track P) · Anghelo (fee review) · Dimitris (processor quotes)

**Two ways to pay. Futty keeps at least €0.30 per player on any EEA card after every Stripe cost, and the venue always receives its full pitch price.** Proposed fees: €0.55 per player when the booker pays for everyone, €0.80 per player when each player pays their own share. Fees, cancellation and Gipedo Pano rules here are proposals: decisions D, E and F in 01, for Anghelo and Panos.

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

Show both prices on the payment screen: "Pay for everyone: €65.50" and "Split: €6.80 each". The cheaper per-head price nudges bookers to pay for everyone, which is also cheaper for Futty to run.

The current code (merged 6 November) charges €0.80 per player and only supports splitting. The booker-pays option at €0.55 still needs building (06 Coding, P4).

## Why the venue earns more through Futty

- **At its terminal** the venue's provider (Stripe, Viva or JCC: check each venue) keeps roughly 1–2%, so a €60 booking nets about €58.80–€59.40.  
- **Through Futty** the venue receives the full €60: Futty pays every card fee out of its own fee.  
- **No-shows still pay:** the booker is charged for unpaid spots after the match.  
- **Empty slots get filled** by "Need players", "Need opposition" and open games.

Say "you get your full price, and no-shows still pay you" in the venue pitch.

## How the money moves

1. **Booker pays for everyone:** one payment at booking. Teammates can pay the booker back in the app. Revolut links are fine: that's between friends, not through Stripe.  
2. **Each pays their own share:** the booker pays their share at booking and their card is saved. Each player pays when they join. **Two hours after the match, any unpaid spots are charged to the booker** in one payment, at the booker-pays rate. If that fails, the booker is notified and can't book again until it's paid.  
3. **The game is never cancelled for money.** The 3-hour auto-cancel is removed.  
4. Payments run through Futty's Stripe account and the venue's share goes to the venue's own Stripe account automatically (Connect destination charges). Stripe pays each venue's bank on its normal schedule.

## Cancellation and refunds (founders' rules, 6 November)

| When the booker or player cancels | What happens |
| :---- | :---- |
| Within 1 hour of booking | Full refund to the card. If the card was only held, the hold is released. If it was charged, Stripe keeps about €1.20 on a €60 booking, at Futty's cost (decision C in 01\) |
| From 1 hour after booking until 6 hours before kickoff | €1 fee. The player chooses: refund to the card minus €1, or move the booking to another slot at the same venue within 30 days, free |
| Within 6 hours of kickoff | No refund |
| No-show | No refund |
| Venue cancels (weather, maintenance) | Full refund including Futty's fee |
| Futty error | Full refund |

Booker choices when cancelling:

- **Cancel their own spot:** it becomes an open spot and the other players are notified to fill it. Unfilled, it's charged to the booker after the match.  
- **Cancel for the whole team:** the booker pays the fee for every spot under the rules above.

**Why "move the booking" instead of venue credit:** a credit balance means Futty holds players' money, which can count as e-money and needs legal advice first (01, \#16). Moving an existing booking to a new slot keeps the money and the customer with the venue, without Futty holding a balance. Revisit venue credit after legal advice.

## Gipedo Pano

- Each team's captain authorises a hold for the **full** pitch price plus their team's fees.  
- After the game, the players confirm the result. Stripe captures the **loser's** hold in full and releases the winner's.  
- **Draw or dispute:** each hold is captured for half (Stripe allows capturing less than the amount held).  
- Only offered for games within 6 days, because Stripe holds expire after 7 days ([Stripe support](https://support.stripe.com/questions/does-stripe-support-holding-an-authorization-for-more-than-7-days-before-capture)).  
- A cost for disputing is left to the venue's and players' discretion for now.

## Cash at the venue

To be decided by Anghelo and Panos (01, decision A): how Futty's fee is collected on cash spots, and who covers a cash no-show.

## Processor

Stay on Stripe for launch. Dimitris is collecting quotes from JCC and Viva (01, 5 November).

## Actions

- [ ] Panos and Anghelo: confirm €0.55 and €0.80 in 01  
- [ ] Panos (Claude Code, P4): booker-pays option, after-match charge, remove the 3-hour cancel, new cancellation rules, Gipedo Pano holds  
- [ ] Panos: add Revolut Pay to the payment sheet  
- [ ] Dimitris: payment screen and refund wording; refund table in the terms  
- [ ] Anghelo: after the first month, check the real card mix in Stripe; adjust fees if Futty's take drops under €0.30