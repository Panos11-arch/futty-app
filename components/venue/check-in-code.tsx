// A game's check-in code for venue staff (spec 05 section 12, item 7), as
// get_match_check_in_code returns it. Shown as text in IBM Plex Mono for
// now; the QR comes once its content and library are agreed.
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, FuttyFonts, radius, space } from '@/constants/futty-theme';

export function CheckInCode({ code }: { code: string }) {
  return (
    <View style={styles.box} accessible accessibilityLabel={`Check-in code ${code.split('').join(' ')}`}>
      <Text variant="caption" tone="inkMuted">
        Check-in code
      </Text>
      <Text testID="check-in-code" variant="headline" selectable style={styles.code}>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.canvas, borderRadius: radius.control, padding: space.md, gap: space.xs },
  code: { fontFamily: FuttyFonts.mono },
});
