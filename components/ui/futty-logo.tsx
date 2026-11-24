import { Image } from 'expo-image';

import { space } from '@/constants/futty-theme';
import { useTheme } from '@/lib/theme';
import { usePremiumPlayer } from '@/lib/use-premium-player';

/** The same corner as the rounded square in logo-premium.png (scripts/logo/logo.ts). */
const LOGO_CORNER_RATIO = 0.225;

const BASIC = require('@/assets/images/icon.png');
const PREMIUM = require('@/assets/images/logo-premium.png');

/**
 * The Futty logo for the signed-in player (U9): the Premium logo (neon F on
 * black) for a Premium player, the basic logo (mint F on white) otherwise and
 * while the profile first loads. Premium comes from the server
 * (usePremiumPlayer, shared with the tab bar's Card button), refetched
 * whenever the screen comes back into focus, keeping the last logo it showed
 * while that refetch loads.
 */
export function FuttyLogo({ size = space.xxl }: { size?: number }) {
  const { colors } = useTheme();
  const premium = usePremiumPlayer();

  return (
    <Image
      testID={premium ? 'futty-logo-premium' : 'futty-logo-basic'}
      accessibilityLabel={premium ? 'Futty Premium' : 'Futty'}
      accessibilityRole="image"
      source={premium ? PREMIUM : BASIC}
      contentFit="contain"
      style={{
        width: size,
        height: size,
        borderRadius: size * LOGO_CORNER_RATIO,
        backgroundColor: premium ? colors.logoBlack : colors.surface,
      }}
    />
  );
}
