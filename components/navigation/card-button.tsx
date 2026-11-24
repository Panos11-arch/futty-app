import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { CARD_BUTTON, CARD_LOGO, MIN_TOUCH } from '@/components/ui/foundation';
import { hairline } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { makeStyles, useTheme } from '@/lib/theme';
import { usePremiumPlayer } from '@/lib/use-premium-player';

/** The Futty F with the football, from the website (site/img/logo.png). */
const LOGO = require('@/assets/images/logo-f.png');

/** The F's own width for its height (464 × 647). */
const LOGO_ASPECT = 464 / 647;

/**
 * The Card button in the middle of the tab bar (S2, spec 15 section 0.5): a
 * bigger circle level with the tabs, no label, the Futty F inside. Basic is
 * a mint circle with a dark F; Premium (from the server) is a black circle
 * with the neon F, and a thin mint ring in dark mode. It opens the player
 * card (a placeholder until S19).
 */
export function CardButton({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const premium = usePremiumPlayer();

  return (
    <Pressable
      testID="tab-card"
      accessibilityRole="button"
      accessibilityLabel="My card"
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <View testID="tab-card-circle" style={[styles.circle, premium ? styles.premium : styles.basic]}>
        <Image
          testID="tab-card-logo"
          source={LOGO}
          contentFit="contain"
          tintColor={premium ? undefined : colors.cardBasicLogo}
          style={styles.logo}
          accessible={false}
        />
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, scheme }) => ({
  button: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  circle: {
    width: CARD_BUTTON,
    height: CARD_BUTTON,
    borderRadius: CARD_BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  basic: { backgroundColor: colors.cardBasicBg },
  premium: {
    backgroundColor: colors.cardPremiumBg,
    ...(scheme === 'dark' ? { borderWidth: hairline * 2 + 1, borderColor: colors.cardButtonRing } : null),
  },
  logo: { height: CARD_LOGO, width: CARD_LOGO * LOGO_ASPECT },
}));
