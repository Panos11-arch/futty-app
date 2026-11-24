import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { space } from '@/constants/futty-theme';
import { useTheme } from '@/lib/theme';
import { useProfile } from '@/lib/use-profile';

/** The same corner as the rounded square in logo-premium.png (scripts/logo/logo.ts). */
const LOGO_CORNER_RATIO = 0.225;

const BASIC = require('@/assets/images/icon.png');
const PREMIUM = require('@/assets/images/logo-premium.png');

/**
 * The Futty logo for the signed-in player (U9): the Premium logo (neon F on
 * black) for a Premium player, the basic logo (mint F on white) otherwise and
 * while the profile first loads. It refetches the profile whenever its screen
 * comes back into focus, so the logo changes right after a Premium purchase,
 * and keeps the last logo it showed while that refetch loads.
 */
export function FuttyLogo({ size = space.xxl }: { size?: number }) {
  const { colors } = useTheme();
  const profile = useProfile();
  const { reload } = profile;
  const [lastPremium, setLastPremium] = useState(false);
  const readyPremium = profile.status === 'ready' ? profile.profile.is_premium : null;
  if (readyPremium !== null && readyPremium !== lastPremium) setLastPremium(readyPremium);
  const premium = readyPremium ?? lastPremium;

  // useProfile already loads on mount; refetch only when the screen comes back.
  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) reload();
      mounted.current = true;
    }, [reload])
  );

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
