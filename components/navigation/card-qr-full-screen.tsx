// S19: the player card's QR, full screen and as big as the phone allows,
// so another player can scan it across a table or a pitch. The brightness
// goes up while it shows and back down on close (lib/screen-brightness.ts).
import { useEffect } from 'react';
import { Modal, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { cardLink } from '@/lib/player-card';
import { raiseBrightness } from '@/lib/screen-brightness';
import { makeStyles, useTheme } from '@/lib/theme';

/** The QR fills the width, up to this. */
const MAX_QR = space.xxl * 12;

export function CardQrFullScreen({
  username,
  visible,
  onClose,
}: {
  username: string;
  visible: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.min(width - space.xl * 2, MAX_QR);

  useEffect(() => {
    if (!visible) return;
    let restore: (() => void) | null = null;
    let closed = false;
    void raiseBrightness().then((fn) => {
      if (closed) fn();
      else restore = fn;
    });
    return () => {
      closed = true;
      restore?.();
    };
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView testID="my-card-qr-full" style={styles.screen}>
        <View style={styles.body} accessible accessibilityLabel={`QR code for @${username}`}>
          <QRCode value={cardLink(username)} size={size} color={colors.night} backgroundColor={colors.onNight} />
          <Text variant="headline" style={{ color: colors.night }}>
            {`@${username}`}
          </Text>
        </View>
        <Button testID="my-card-qr-full-close" label="Close" variant="dark" fullWidth onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.onNight, padding: space.xl, justifyContent: 'space-between' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
}));
