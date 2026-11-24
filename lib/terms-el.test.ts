// The Greek Terms of use: the same sections as the English, every amount and
// time limit from app_rules, as lib/terms.test.ts checks for the English.
import { CHANGED_RULES, SPEC_RULES } from '@/lib/rules.fixtures';
import { termsSections } from '@/lib/terms';
import { daysTextEl, hoursTextEl, minutesTextEl, monthsTextEl, termsSectionsEl } from '@/lib/terms-el';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const text = (rules = SPEC_RULES, teamPremium = false) =>
  termsSectionsEl(rules, { teamPremium })
    .flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])
    .join('\n');

const shape = (sections: ReturnType<typeof termsSections>) =>
  sections.map((s) => [s.paragraphs?.length ?? 0, s.bullets?.length ?? 0]);

describe('Greek Terms of use', () => {
  it.each([false, true])('has the English sections, in order, with as many paragraphs and bullets (Team Premium %s)', (teamPremium) => {
    const en = termsSections(SPEC_RULES, { teamPremium });
    const el = termsSectionsEl(SPEC_RULES, { teamPremium });
    expect(el).toHaveLength(en.length);
    expect(shape(el)).toEqual(shape(en));
  });

  it('has a Greek heading for every section, each once', () => {
    const headings = termsSectionsEl(SPEC_RULES, { teamPremium: false }).map((s) => s.heading);
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings).toEqual(
      expect.arrayContaining(['Χρήματα που οφείλετε', 'Πίστωση στο γήπεδο', 'Check-in', 'Μη εμφάνιση', 'Παίκτες που προτείνει το γήπεδο', 'Βαθμολογίες και επίπεδα', 'Προσφορές μετά τον αγώνα']),
    );
  });

  it('spells out the debt block across every venue and the credit expiry', () => {
    const terms = text();
    expect(terms).toContain('σε κανένα γήπεδο, μέχρι να εξοφληθεί');
    expect(terms).toContain('Η πίστωση λήγει 12 μήνες μετά την έκδοσή της.');
  });

  it('gives spec 13’s fees and windows', () => {
    const terms = text();
    expect(terms).toContain('€0.80 όταν κάθε παίκτης πληρώνει το δικό του μερίδιο, €0.55 όταν ο διοργανωτής πληρώνει για όλους');
    expect(terms).toContain('Οι παίκτες Premium δεν πληρώνουν χρέωση υπηρεσίας για τη δική τους θέση.');
    expect(terms).toContain('Μέσα σε 1 ώρα από την πληρωμή, για αγώνα σε περισσότερες από 6 ώρες');
    expect(terms).toContain('κρατούνται €1.00 και το υπόλοιπο γίνεται πίστωση');
    expect(terms).toContain('Έχετε 48 ώρες για να επιλέξετε πίστωση');
    expect(terms).toContain('μέσα σε 15 λεπτά από την κράτηση');
    expect(terms).toContain('ολόκληρη η τιμή του γηπέδου 3 ημέρες πριν από την έναρξη');
    expect(terms).toContain('συν €0.55 για κάθε παίκτη της κράτησης');
    expect(terms).toContain('Το Gipedo Pano κλείνεται το πολύ 5 ημέρες νωρίτερα.');
    expect(terms).toContain('κοστίζει €4.99 τον μήνα');
    expect(terms).toContain('έως 14 ημέρες νωρίτερα αντί για 7 ημέρες');
    expect(terms).toContain('η διαφορά χρεώνεται 2 ώρες μετά τον αγώνα, όπως στο «Κράτηση και πληρωμή»');
  });

  it('follows the rules with no code change', () => {
    const terms = text(CHANGED_RULES);
    expect(terms).toContain('€0.90 όταν κάθε παίκτης πληρώνει');
    expect(terms).toContain('πληρώνουν χρέωση υπηρεσίας €0.10 για τη δική τους θέση');
    expect(terms).toContain('Μέσα σε 30 λεπτά από την πληρωμή, για αγώνα σε περισσότερες από 4 ώρες');
    expect(terms).toContain('Η πίστωση λήγει 6 μήνες');
    expect(terms).toContain('η διαφορά χρεώνεται 3 ώρες μετά τον αγώνα');
    expect(terms).not.toContain('€0.80');
    expect(terms).not.toContain('€4.99');
    expect(terms).not.toContain('6 ώρες');
  });

  it('mentions Team Premium only when it is on', () => {
    expect(text(SPEC_RULES, false)).not.toContain('Team Premium');
    expect(text(SPEC_RULES, true)).toContain('Το Team Premium είναι εφάπαξ αγορά ανά ομάδα');
  });

  it('has the Greek units, singular and plural', () => {
    expect([hoursTextEl(1), hoursTextEl(6)]).toEqual(['1 ώρα', '6 ώρες']);
    expect([minutesTextEl(1), minutesTextEl(15), minutesTextEl(120)]).toEqual(['1 λεπτό', '15 λεπτά', '2 ώρες']);
    expect([daysTextEl(1), daysTextEl(7)]).toEqual(['1 ημέρα', '7 ημέρες']);
    expect([monthsTextEl(1), monthsTextEl(12)]).toEqual(['1 μήνα', '12 μήνες']);
  });
});
