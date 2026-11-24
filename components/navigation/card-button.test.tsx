// S2 (spec 15 section 0.5): the Card button in the middle of the tab bar.
// Four versions, Basic or Premium (from the server) times light or dark:
//   Basic, light:   mint circle, dark F
//   Basic, dark:    mint circle, dark F
//   Premium, light: black circle, neon F
//   Premium, dark:  black circle with a thin mint ring, neon F
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { processColor } from 'react-native';

import { CardButton } from '@/components/navigation/card-button';
import { CARD_BUTTON, CARD_LOGO, TAB_BAR_HEIGHT } from '@/components/ui/foundation';
import { flatStyle, loadWithFile, withTheme } from '@/components/ui/test-utils';
import { darkPalette, lightPalette } from '@/constants/futty-theme';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

let mockProfile: Record<string, unknown>;
const mockReload = jest.fn();
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ ...mockProfile, reload: mockReload }) }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (effect: () => void) => useEffect(() => effect(), [effect]) };
});
const mockTap = jest.fn();
jest.mock('@/lib/haptics', () => ({ haptic: { tap: () => mockTap(), success: jest.fn(), error: jest.fn() } }));

loadWithFile(Image);

const basic = { status: 'ready', profile: { is_premium: false } };
const premium = { status: 'ready', profile: { is_premium: true } };

async function draw(profile: Record<string, unknown>, appearance: 'light' | 'dark', onPress = jest.fn()) {
  mockProfile = profile;
  await render(withTheme(<CardButton onPress={onPress} />, { appearance }));
  return {
    button: screen.getByTestId('tab-card'),
    circle: flatStyle(screen.getByTestId('tab-card-circle')),
    logo: screen.getByTestId('tab-card-logo'),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('the four versions', () => {
  it.each([
    ['light', lightPalette],
    ['dark', darkPalette],
  ] as const)('Basic, %s: mint circle, dark F, no ring', async (appearance, palette) => {
    const { circle, logo } = await draw(basic, appearance);
    expect(circle.backgroundColor).toBe(palette.cardBasicBg);
    expect(circle.backgroundColor).toBe(palette.green);
    expect(logo.props.tintColor).toBe(processColor(palette.cardBasicLogo));
    expect(circle.borderWidth ?? 0).toBe(0);
    expect(screen.getByTestId('tab-card').props.accessibilityHint).toBeUndefined();
  });

  it('Premium, light: black circle, the neon F as it is, no ring', async () => {
    const { circle, logo } = await draw(premium, 'light');
    expect(circle.backgroundColor).toBe(lightPalette.cardPremiumBg);
    expect(logo.props.tintColor).toBeUndefined();
    expect(circle.borderWidth ?? 0).toBe(0);
  });

  it('Premium, dark: black circle with a thin mint ring, the neon F as it is', async () => {
    const { circle, logo } = await draw(premium, 'dark');
    expect(circle.backgroundColor).toBe(darkPalette.cardPremiumBg);
    expect(logo.props.tintColor).toBeUndefined();
    expect(circle.borderWidth).toBeGreaterThan(0);
    expect(circle.borderColor).toBe(darkPalette.cardButtonRing);
    expect(circle.borderColor).toBe(darkPalette.green);
  });

  it('uses the real logo file (the F with the football), never a drawing', async () => {
    const { logo } = await draw(basic, 'light');
    expect(logo.props.source).toEqual(expect.anything());
    expect(screen.queryByText('F')).toBeNull();
  });
});

describe('Premium comes from the server', () => {
  it('shows Basic while the profile loads', async () => {
    const { circle } = await draw({ status: 'loading' }, 'light');
    expect(circle.backgroundColor).toBe(lightPalette.cardBasicBg);
  });

  it('shows Basic when the profile fails to load', async () => {
    const { circle } = await draw({ status: 'error', message: 'offline' }, 'dark');
    expect(circle.backgroundColor).toBe(darkPalette.cardBasicBg);
  });

});

describe('size and place: level with the tabs, not raised', () => {
  it('is a bigger circle that still fits inside the bar', async () => {
    const { circle } = await draw(basic, 'light');
    expect(circle).toMatchObject({ width: CARD_BUTTON, height: CARD_BUTTON, borderRadius: CARD_BUTTON / 2 });
    expect(CARD_BUTTON).toBeLessThanOrEqual(TAB_BAR_HEIGHT);
    expect(flatStyle(screen.getByTestId('tab-card-logo'))).toMatchObject({ height: CARD_LOGO });
  });

  it('sits in the row like a tab: centred, no offset, no absolute position', async () => {
    const { button } = await draw(premium, 'dark');
    for (const style of [flatStyle(button), flatStyle(screen.getByTestId('tab-card-circle'))]) {
      expect(style.position).not.toBe('absolute');
      expect(style.top).toBeUndefined();
      expect(style.bottom).toBeUndefined();
      expect(style.marginTop ?? 0).toBe(0);
      expect(style.marginBottom ?? 0).toBe(0);
      expect(style.transform).toBeUndefined();
    }
    expect(flatStyle(button)).toMatchObject({ alignItems: 'center', justifyContent: 'center' });
  });
});

describe('tapping', () => {
  it('has no label but tells screen readers what it is', async () => {
    const { button } = await draw(basic, 'light');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('My card');
    expect(screen.queryByText('My card')).toBeNull();
  });

  it('opens the card with a light haptic', async () => {
    const onPress = jest.fn();
    const { button } = await draw(basic, 'light', onPress);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockTap).toHaveBeenCalledTimes(1);
  });
});
