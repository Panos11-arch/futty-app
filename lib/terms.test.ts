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
      'Personal Premium costs €3.99 a month, as an auto-renewing subscription through the App Store, under Apple’s terms as well as these. Premium players can book up to 14 days ahead instead of 7 days',
    );
  });

  it('follows the rules with no code change', () => {
    const terms = text(CHANGED_RULES);
    expect(terms).toContain('€0.90 when each player pays their own share, €0.60 when the booker pays for everyone');
    expect(terms).toContain('Premium players pay a €0.10 service fee on their own spot.');
    expect(terms).not.toContain('€0.80');
    expect(terms).not.toContain('€3.99');
  });

  it('has none of the old terms’ rules', () => {
    expect(text()).not.toMatch(/3 hours before kickoff|automatically cancelled/);
  });

  it('mentions Team Premium only when it is on', () => {
    expect(text(SPEC_RULES, false)).not.toContain('Team Premium');
    expect(text(SPEC_RULES, true)).toContain('Team Premium is a one-time purchase per team');
  });
});
