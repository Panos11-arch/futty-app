// The Terms of Use (app/account/terms.tsx), written from spec 13
// (docs/specs/13-payments-bookings.md) for the release (P7). Spec 13's
// "Legal check before real money": the terms must spell out the debt block
// across all venues and the credit rules. Every amount and time limit comes
// from public.app_rules, so the terms follow the rules with no code change.
// The founders read this wording before release; the decisions doc (#16)
// still asks for legal advice on venue credit. The Greek text the screen
// shows on a phone set to Greek is lib/terms-el.ts: change both together.
import { type AppRules, daysText, eurosText, hoursText, minutesText, monthsText } from '@/lib/rules';

export type TermsSection = { heading: string; paragraphs?: string[]; bullets?: string[] };

export const TERMS_UPDATED = 'November 2026';

/** 72 -> "3 days", 6 -> "6 hours". */
function hoursOrDays(hours: number): string {
  return hours > 0 && hours % 24 === 0 ? daysText(hours / 24) : hoursText(hours);
}

function premiumOwnSpot(r: AppRules): string {
  return r.fee_premium_cents === 0
    ? 'pay no service fee on their own spot'
    : `pay a ${eurosText(r.fee_premium_cents)} service fee on their own spot`;
}

export function termsSections(r: AppRules, { teamPremium }: { teamPremium: boolean }): TermsSection[] {
  const cutoff = hoursText(r.refund_cutoff_hours);
  const fee = eurosText(r.cancel_fee_cents);
  const collection = hoursText(r.collection_delay_hours);

  return [
    {
      heading: 'Your account',
      bullets: [
        'You must be at least 16 years old to use Futty.',
        "You're responsible for the activity on your account and for keeping your login secure.",
        'Information you provide (name, username, profile details) must be accurate.',
      ],
    },
    {
      heading: 'Prices and the service fee',
      bullets: [
        'Each venue sets its pitch prices. The pitch price is split equally between the players the booking is for (10 for 5 v 5); any cents left over from the split go on the booker’s share.',
        `Futty adds a service fee for each player: ${eurosText(r.fee_each_pays_cents)} when each player pays their own share, ${eurosText(r.fee_pay_all_cents)} when the booker pays for everyone in one payment. It is the same whatever the payment method.`,
        `Premium players ${premiumOwnSpot(r)}.`,
        'The app shows what you pay, worked out by Futty from the venue’s prices, before you pay.',
      ],
    },
    {
      heading: 'Booking and paying',
      bullets: [
        'When booking, the booker chooses how the game is paid: the booker pays for everyone; each player pays their own share with the booker responsible for any spot left unpaid; or each player pays their own share and is responsible only for their own spot.',
        `The booker must finish paying within ${minutesText(r.payment_window_minutes)} of booking, or the booking is cancelled and its pitches released.`,
        `When you pay, your payment is held on your card and taken ${minutesText(r.capture_delay_minutes)} later, or ${cutoff} before kickoff if that comes first. A payment made less than ${cutoff} before kickoff is taken straight away and can’t be refunded; the app asks you to accept that first.`,
        'Everyone who pays in the app saves a card, so that top-ups and anything you owe can be charged to it later.',
        `When the booker is responsible, their card is held for the full pitch price ${hoursOrDays(r.guarantee_hold_lead_hours)} before kickoff (at booking if the game is sooner). ${collection} after the match, anything still unpaid, service fee included, is taken from that hold and the rest released. If the hold can’t be placed, the game still goes ahead, and whatever it would have covered becomes the booker’s debt.`,
        `Whatever happens, the full pitch price is paid. If fewer players join than the booking is for, the players who joined split the full price, and the difference is charged to their saved cards ${collection} after the match. This doesn’t apply when the booker paid for everyone.`,
        'If you choose to pay cash at the venue, you pay the service fee by card when you join and your part of the pitch to the venue. If the venue hasn’t recorded your cash by collection, it is treated as unpaid.',
      ],
    },
    {
      heading: 'Cancelling',
      bullets: [
        `Within ${minutesText(r.free_cancel_minutes)} of paying, for a game more than ${cutoff} away, you can cancel and get everything back.`,
        `After that, until ${cutoff} before kickoff, ${fee} is kept and the rest becomes credit at that venue. Exactly ${cutoff} before kickoff still counts as before.`,
        `Less than ${cutoff} before kickoff, nothing is given back, even if your spot is filled.`,
        `A booker who cancels the whole team (each player paying) pays ${fee} for each other player whose payment was already taken, shown before they confirm; the other players get their whole share back. Less than ${cutoff} before kickoff nobody gets money back and there is no such charge.`,
        `A booker who paid for everyone can cancel only the whole booking. Until ${cutoff} before kickoff, ${fee} per player is kept and the rest becomes credit at that venue.`,
        `If the venue cancels, every player gets their whole share back, as a card refund or as credit at that venue. You have ${hoursText(r.refund_choice_hours)} to choose credit; otherwise it goes back to your card. The same choice applies when the booker cancels the whole team.`,
        'Nothing can be cancelled once the game has started. A player who cancels can’t rejoin the same booking.',
      ],
    },
    {
      heading: 'Venue credit',
      bullets: [
        'Credit can only be spent at the venue that issued it, and can’t be cashed out or moved to another venue.',
        `Credit expires ${monthsText(r.credit_expiry_months)} after it is issued.`,
        `Credit pays your part of the pitch with no service fee. If it doesn’t cover it all, the rest is paid by card with the normal service fee. Credit can’t be used with cash.`,
        'Credit is held by the venue. Futty keeps the record of each player’s credit at each venue.',
      ],
    },
    {
      heading: 'Money you owe',
      bullets: [
        'You owe a venue when a share you were responsible for is left unpaid, for example cash you didn’t pay at the venue or a top-up your card refused. You owe Futty when a charge for cancelling the whole team can’t be taken.',
        'While you owe any venue or Futty, you can’t book, join a booking or choose cash anywhere on Futty, at any venue, until it is paid.',
        'You can always pay what you owe in the app by card, with no extra fee, or settle it with the venue in person, which the venue then records.',
      ],
    },
    {
      heading: 'Gipedo Pano',
      bullets: [
        `In Gipedo Pano the losing team pays for the pitch. Each team’s captain has their card held for the pitch price plus ${eurosText(r.gipedo_fee_cents)} for each player in the booking.`,
        'After the match, the losing team’s hold is taken in full and the winning team’s released. A draw or a disputed result splits it: half of each hold is taken and the rest released.',
        `Gipedo Pano can only be booked up to ${daysText(r.gipedo_max_days)} ahead. A team that pulls out ${cutoff} or more before kickoff pays ${fee} per player from its hold; less than ${cutoff} before, it counts as the losing team.`,
      ],
    },
    {
      heading: 'Checking in',
      bullets: [
        'At the venue, check in by scanning the venue’s QR code in the app or typing its code, while check-in is open; the app shows when it opens and closes. Your captain or the venue’s staff can also mark you as arrived.',
        'Only players who checked in count in the match’s stats, can vote for man of the match and can rate or be rated.',
        'The venue can undo only its own tick, and not once you’ve voted or rated in that match.',
      ],
    },
    {
      heading: 'No-shows',
      bullets: [
        'If you held a spot in a booking and didn’t check in by the time the result is final, the venue records a no-show for you. Only that venue sees its no-show record.',
        `A no-show doesn’t change what you pay: your share is handled as in “Booking and paying” and “Cancelling”, and less than ${cutoff} before kickoff nothing is given back. Futty adds no charge for a no-show.`,
      ],
    },
    {
      heading: 'Players offered by a venue',
      bullets: [
        'When a booking is short, the venue may offer a player who isn’t on Futty. Only the booker can accept or decline, until kickoff; an offer not answered by kickoff lapses. The venue can withdraw the player, and the booker can remove them, until kickoff.',
        `A player the venue offers plays free: they have no share and the venue never charges them. For what the team pays, their spot counts as empty, so the players who joined still split the full pitch price and the difference is charged ${collection} after the match, as in “Booking and paying”.`,
        'While accepted, they take a spot, so fewer app players can join.',
      ],
    },
    {
      heading: 'Ratings and levels',
      bullets: [
        'After a confirmed match, players who checked in can rate the other players who checked in, from 1 to 10, and vote for man of the match. Individual ratings and votes are never shown to anyone else.',
        'Your level is worked out by Futty from results and ratings in competitive matches.',
        'Rate and vote honestly. Don’t trade or arrange ratings or votes.',
      ],
    },
    {
      heading: 'Post-match offers',
      bullets: [
        'After a match, players in it may see food and drink offers from the venue. Opening an offer gives you a code to show at the venue’s counter.',
        'You pay the venue at the counter, not through Futty. A code can be used once, at that venue, until the end of the match day (Cyprus time).',
        'Offers, prices and what’s served are the venue’s. Futty isn’t a party to the sale.',
      ],
    },
    {
      heading: 'Premium',
      paragraphs: [
        `Personal Premium costs ${r.premium_price_label} a month, as an auto-renewing subscription through the App Store, under Apple’s terms as well as these. Premium players can book up to ${daysText(r.window_premium_days)} ahead instead of ${daysText(r.window_standard_days)}, and ${premiumOwnSpot(r)}. Cancel it in your Apple account’s subscription settings; Premium lasts until the end of the period you paid for.`,
        ...(teamPremium
          ? ['Team Premium is a one-time purchase per team, through the App Store, needed to register that team for 9-a-side or 11-a-side leagues.']
          : []),
      ],
    },
    {
      heading: 'Conduct',
      bullets: [
        'Treat other players, captains, and venue staff with respect.',
        'Don’t post false availability, impersonate another person or team, or abuse the reporting and blocking tools.',
        'We can suspend or remove an account for behaviour that harms other users or the app.',
      ],
    },
    {
      heading: 'Content you post',
      paragraphs: [
        'You’re responsible for squad posts, chat messages and profile content you submit. Don’t post anything illegal, abusive, or that infringes someone else’s rights.',
      ],
    },
    {
      heading: 'Disclaimer',
      paragraphs: [
        'Futty connects players, teams and venues. The venue provides the pitch and Futty isn’t a party to the game itself. We’re not liable for injuries, disputes or losses arising from a match arranged through the app.',
      ],
    },
    {
      heading: 'Changes',
      paragraphs: ['If these terms change materially, we’ll update the date above. The amounts and time limits here are always the ones the app uses.'],
    },
  ];
}
