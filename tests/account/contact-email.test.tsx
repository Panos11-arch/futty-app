import './mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import HelpScreen from '@/app/account/help';
import PrivacyPolicyScreen from '@/app/account/privacy-policy';
import TermsOfUseScreen from '@/app/account/terms';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-rules', () => {
  const { SPEC_RULES: rules } = jest.requireActual<typeof import('@/lib/rules.fixtures')>('@/lib/rules.fixtures');
  return { useRules: () => ({ state: { status: 'ready', rules, fresh: true }, reload: jest.fn() }) };
});

const SUPPORT_EMAIL = 'support@futty.app';
const OLD_EMAIL = 'palepis@icloud.com';

let openURL: jest.SpyInstance;

beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  openURL.mockRestore();
});

describe('Contact email', () => {
  it('Help shows the support address and opens a mail with the subject', async () => {
    await render(<HelpScreen />);
    expect(screen.queryByText(OLD_EMAIL)).toBeNull();
    fireEvent.press(screen.getByText(SUPPORT_EMAIL));
    expect(openURL).toHaveBeenCalledWith('mailto:support@futty.app?subject=Futty%20Support');
  });

  it('Privacy policy shows the support address and opens a mail', async () => {
    await render(<PrivacyPolicyScreen />);
    expect(screen.queryByText(OLD_EMAIL)).toBeNull();
    fireEvent.press(screen.getByText(SUPPORT_EMAIL));
    expect(openURL).toHaveBeenCalledWith('mailto:support@futty.app');
  });

  it('Terms of use shows the support address and opens a mail', async () => {
    await render(<TermsOfUseScreen />);
    expect(screen.queryByText(OLD_EMAIL)).toBeNull();
    fireEvent.press(screen.getByText(SUPPORT_EMAIL));
    expect(openURL).toHaveBeenCalledWith('mailto:support@futty.app');
  });
});
