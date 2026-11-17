// A game's check-in QR for venue staff (spec 05 section 12, item 7;
// docs/specs/match-record.md decisions 1a.1 and 1a.4). The QR holds
// futtyapp://check-in?match=<id>&code=<code> (agreed with Anghelo, 17
// November), drawn large so a player can scan it off the manager's phone.
// The code is printed underneath in fours, in IBM Plex Mono (15 Design), for
// a player whose camera won't scan, with the window it's open in Cyprus time.
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Text } from '@/components/ui';
import { colors, FuttyFonts, radius, space } from '@/constants/futty-theme';
import { checkInLink, groupCode, windowLabel } from '@/lib/check-in';

/** The QR fills the sheet's width, up to this. */
const MAX_QR = 320;

export type CheckInCodeProps = { matchId: string; code: string; kickoffAt: string; endsAt: string };

export function CheckInCode({ matchId, code, kickoffAt, endsAt }: CheckInCodeProps) {
  const { width } = useWindowDimensions();
  const size = Math.max(Math.min(width - space.xxl * 3, MAX_QR), space.xxl * 7);
  const grouped = groupCode(code);
  return (
    <View style={styles.box}>
      <Text variant="headline">Check-in QR</Text>
      <View style={styles.qr} accessible accessibilityLabel="Check-in QR code for players to scan">
        <QRCode value={checkInLink(matchId, code)} size={size} color={colors.ink} backgroundColor={colors.surface} />
      </View>
      <View accessible accessibilityLabel={`Check-in code ${code.split('').join(' ')}`} style={styles.codeBox}>
        <Text variant="caption" tone="inkMuted">
          Or type this code
        </Text>
        <Text testID="check-in-code" variant="headline" selectable style={styles.code}>
          {grouped}
        </Text>
      </View>
      <Text tone="inkMuted">{windowLabel({ kickoff_at: kickoffAt, ends_at: endsAt })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.canvas, borderRadius: radius.control, padding: space.md, gap: space.md },
  qr: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    padding: space.lg,
    borderRadius: radius.control,
  },
  codeBox: { gap: space.xs, alignItems: 'center' },
  code: { fontFamily: FuttyFonts.mono, textAlign: 'center' },
});
