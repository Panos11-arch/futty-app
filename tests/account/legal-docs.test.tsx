// The privacy policy and terms for launch: the privacy policy covers the
// camera, photos, match records, venues and venue-offered players; the
// contact email is support@futty.app; and both screens show Greek on a phone
// set to Greek. tests/site/site-matches-app.test.tsx checks the website says
// the same.
import './mocks';

import { render, screen } from '@testing-library/react-native';

import PrivacyPolicyScreen from '@/app/account/privacy-policy';
import TermsOfUseScreen from '@/app/account/terms';
import { CONTACT_EMAIL } from '@/lib/contact';

let mockLanguage: 'en' | 'el' = 'en';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/language', () => ({ deviceLanguage: () => mockLanguage }));
jest.mock('@/lib/use-rules', () => {
  const { SPEC_RULES: rules } = jest.requireActual<typeof import('@/lib/rules.fixtures')>('@/lib/rules.fixtures');
  return { useRules: () => ({ state: { status: 'ready', rules }, reload: jest.fn() }) };
});

const headings = () => screen.getAllByRole('header').map((h) => [h.props.children].flat().join(''));

beforeEach(() => {
  mockLanguage = 'en';
});

describe('Privacy policy screen', () => {
  it('covers the camera, photos, match records, venues and venue-offered players', async () => {
    await render(<PrivacyPolicyScreen />);
    expect(headings()).toHaveLength(19);
    expect(headings()).toEqual(
      expect.arrayContaining(['Camera', 'Photos', 'Match records', 'What venues see', 'Players offered by a venue', 'Calendar', 'Age and young players', 'Messages and friends']),
    );
    expect(screen.getByText(/The picture is read on your phone to find the code and is never saved or sent/)).toBeTruthy();
    expect(screen.getByText(/Futty never reads players' photo libraries\./)).toBeTruthy();
    expect(screen.getByText('A venue never sees your bookings, payments, debts or no-shows at another venue.')).toBeTruthy();
    expect(screen.getByText(/Staff type only that player's first name\./)).toBeTruthy();
  });

  it('keeps the AI chat, payment record and deleted-player disclosures', async () => {
    await render(<PrivacyPolicyScreen />);
    expect(screen.getByText(/Futty AI chat: messages you type into the in-app assistant/)).toBeTruthy();
    expect(screen.getByText(/We keep a record of what you paid for, how much, and its status \(held, charged, refunded\)\./)).toBeTruthy();
    expect(screen.getByText(/stay in league tables under "Deleted player" so other teams' records stay accurate/)).toBeTruthy();
  });

  it('is in Greek on a phone set to Greek, with the same sections', async () => {
    mockLanguage = 'el';
    await render(<PrivacyPolicyScreen />);
    expect(screen.getByText('Τελευταία ενημέρωση: Νοέμβριος 2026')).toBeTruthy();
    expect(headings()).toHaveLength(19); // as many sections as the English
    expect(headings()).toEqual(expect.arrayContaining(['Κάμερα', 'Στοιχεία αγώνων', 'Επικοινωνία', 'Ηλικία και νεαροί παίκτες', 'Μηνύματα και φίλοι']));
    expect(screen.queryByText('Camera')).toBeNull();
    expect(screen.getByText(CONTACT_EMAIL)).toBeTruthy();
  });
});

describe('Contact email', () => {
  it('is support@futty.app', async () => {
    expect(CONTACT_EMAIL).toBe('support@futty.app');
    await render(<PrivacyPolicyScreen />);
    expect(screen.getByText('support@futty.app')).toBeTruthy();
  });
});

describe('Terms of use screen', () => {
  it('is in English on a phone set to English', async () => {
    await render(<TermsOfUseScreen />);
    expect(screen.getByText('Last updated: November 2026')).toBeTruthy();
    expect(screen.getByText('No-shows')).toBeTruthy();
    expect(screen.getByText('Money you owe')).toBeTruthy();
    expect(screen.getByText('support@futty.app')).toBeTruthy();
  });

  it('is in Greek on a phone set to Greek, with the rules’ numbers', async () => {
    mockLanguage = 'el';
    await render(<TermsOfUseScreen />);
    expect(screen.getByText('Τελευταία ενημέρωση: Νοέμβριος 2026')).toBeTruthy();
    expect(screen.getByText('Μη εμφάνιση')).toBeTruthy();
    expect(screen.getByText('Χρήματα που οφείλετε')).toBeTruthy();
    expect(screen.getByText('Επικοινωνία')).toBeTruthy();
    expect(screen.getByText(/Η πίστωση λήγει 12 μήνες/)).toBeTruthy();
    expect(screen.queryByText('Money you owe')).toBeNull();
    expect(screen.getByText('support@futty.app')).toBeTruthy();
  });
});
