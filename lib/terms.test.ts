// P7: the Terms of Use from spec 13. The legal check asks for the debt block
// across all venues and the credit rules; every amount follows app_rules.
import { CHANGED_RULES, SPEC_RULES } from '@/lib/rules.fixtures';
import { termsSections } from '@/lib/terms';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const text = (rules = SPEC_RULES, teamPremium = false) =>
  termsSections(rules, { teamPremium })
    .flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])
    .join('\n');

const section = (heading: string, rules = SPEC_RULES) => {
  const found = termsSections(rules, { teamPremium: false }).find((s) => s.heading === heading);
  if (!found) throw new Error(`no section ${heading}`);
  return [...(found.paragraphs ?? []), ...(found.bullets ?? [])];
};

describe('Terms of Use', () => {
  it('spells out the debt block across every venue', () => {
    expect(section('Money you owe')).toContain(
      'While you owe any venue or Futty, you can’t book, join a booking or choose cash anywhere on Futty, at any venue, until it is paid.',
    );
  });

  it('spells out the credit rules, at spec 13’s numbers', () => {
    expect(section('Venue credit')).toEqual([
      'Credit can only be spent at the venue that issued it, and can’t be cashed out or moved to another venue.',
      'Credit expires 12 months after it is issued.',
      'Credit pays your part of the pitch with no service fee. If it doesn’t cover it all, the rest is paid by card with the normal service fee. Credit can’t be used with cash.',
      'Credit is held by the venue. Futty keeps the record of each player’s credit at each venue.',
    ]);
  });

  it('gives spec 13’s fees and cancellation windows', () => {
    const terms = text();
    expect(terms).toContain(
      'Futty adds a service fee for each player: €0.80 when each player pays their own share, €0.55 when the booker pays for everyone in one payment.',
    );
    expect(terms).toContain('Premium players pay no service fee on their own spot.');
    expect(terms).toContain('Within 1 hour of paying, for a game more than 6 hours away, you can cancel and get everything back.');
    expect(terms).toContain(
      'After that, until 6 hours before kickoff, €1.00 is kept and the rest becomes credit at that venue. Exactly 6 hours before kickoff still counts as before.',
    );
    expect(terms).toContain('Less than 6 hours before kickoff, nothing is given back, even if your spot is filled.');
    expect(terms).toContain('You have 48 hours to choose credit; otherwise it goes back to your card.');
    expect(terms).toContain('The booker must finish paying within 15 minutes of booking');
    expect(terms).toContain('their card is held for the full pitch price 3 days before kickoff');
    expect(terms).toContain('plus €0.55 for each player in the booking');
    expect(terms).toContain('Gipedo Pano can only be booked up to 5 days ahead.');
    expect(terms).toContain(
      'Personal Premium costs €4.99 a month, as an auto-renewing subscription through the App Store, under Apple’s terms as well as these. Premium players can book up to 14 days ahead instead of 7 days',
    );
  });

  it('follows the rules with no code change', () => {
    const terms = text(CHANGED_RULES);
    expect(terms).toContain('€0.90 when each player pays their own share, €0.60 when the booker pays for everyone');
    expect(terms).toContain('Premium players pay a €0.10 service fee on their own spot.');
    expect(terms).not.toContain('€0.80');
    expect(terms).not.toContain('€4.99');
  });

  it('has none of the old terms’ rules', () => {
    expect(text()).not.toMatch(/3 hours before kickoff|automatically cancelled/);
  });

  it('covers check-in, no-shows, venue players, ratings and post-match offers', () => {
    expect(section('Checking in')).toContain(
      'Only players who checked in count in the match’s stats, can vote for man of the match and can rate or be rated.',
    );
    expect(section('No-shows')).toEqual([
      'If you held a spot in a booking and didn’t check in by the time the result is final, the venue records a no-show for you. Only that venue sees its no-show record.',
      'A no-show doesn’t change what you pay: your share is handled as in “Booking and paying” and “Cancelling”, and less than 6 hours before kickoff nothing is given back. Futty adds no charge for a no-show.',
    ]);
    expect(section('Players offered by a venue')).toContain(
      'A player the venue offers plays free: they have no share and the venue never charges them. For what the team pays, their spot counts as empty, so the players who joined still split the full pitch price and the difference is charged 2 hours after the match, as in “Booking and paying”.',
    );
    expect(section('Ratings and levels')[0]).toContain('Individual ratings and votes are never shown to anyone else.');
    expect(section('Post-match offers')).toContain(
      'You pay the venue at the counter, not through Futty. A code can be used once, at that venue, until the end of the match day (Cyprus time).',
    );
  });

  it('words the new sections from the rules', () => {
    expect(section('No-shows', CHANGED_RULES)[1]).toContain('less than 4 hours before kickoff');
    expect(section('Players offered by a venue', CHANGED_RULES)[1]).toContain('charged 3 hours after the match');
  });

  it('leaves the debt and credit sections where they were', () => {
    const headings = termsSections(SPEC_RULES, { teamPremium: false }).map((s) => s.heading);
    expect(headings.slice(0, 7)).toEqual([
      'Your account',
      'Prices and the service fee',
      'Booking and paying',
      'Cancelling',
      'Venue credit',
      'Money you owe',
      'Gipedo Pano',
    ]);
    expect(section('Money you owe')).toHaveLength(3);
  });

  it('mentions Team Premium only when it is on', () => {
    expect(text(SPEC_RULES, false)).not.toContain('Team Premium');
    expect(text(SPEC_RULES, true)).toContain('Team Premium is a one-time purchase per team');
  });
});
