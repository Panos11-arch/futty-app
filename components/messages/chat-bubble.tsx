import { Pressable, View } from 'react-native';

import { ICON } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { clockTime, TICK_LABELS, type Tick } from '@/lib/messages';
import { makeStyles, useTheme } from '@/lib/theme';

const TICK_ICONS: Record<Tick, IconSymbolName[]> = {
  sending: ['clock.fill'],
  failed: ['exclamationmark.circle.fill'],
  sent: ['checkmark'],
  delivered: ['checkmark', 'checkmark'],
  read: ['checkmark.circle.fill'],
};

export type ChatBubbleProps = {
  body: string;
  createdAt: string;
  mine: boolean;
  /** Mine only. */
  tick?: Tick | null;
  firstInGroup: boolean;
  /** The last of a run from one sender gets the tail. */
  lastInGroup: boolean;
  onLongPress?: () => void;
  /** A failed one of mine: tap to send again. */
  onRetry?: () => void;
  testID?: string;
};

/**
 * One message, WhatsApp-style: mine on the right on green with greenInk
 * text, theirs on the left on surface. The time (and my ticks) sit inside.
 * Ticks differ in shape, not only colour: one check sent, two delivered, a
 * filled check read.
 */
export function ChatBubble({
  body,
  createdAt,
  mine,
  tick,
  firstInGroup,
  lastInGroup,
  onLongPress,
  onRetry,
  testID,
}: ChatBubbleProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const time = clockTime(createdAt);
  const failed = tick === 'failed';
  const metaTone = mine ? 'greenInk' : 'inkMuted';
  const label = [mine ? 'You' : 'Them', body, time, tick ? TICK_LABELS[tick] : null].filter(Boolean).join(', ');

  return (
    <View style={[styles.row, mine && styles.rowMine, firstInGroup && styles.groupStart]}>
      <Pressable
        testID={testID ?? (mine ? 'bubble-mine' : 'bubble-theirs')}
        accessibilityRole={failed ? 'button' : undefined}
        accessibilityLabel={label}
        accessibilityHint={failed ? 'Tap to send again' : undefined}
        accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'Copy or report' }] : undefined}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'longpress') onLongPress?.();
        }}
        onPress={failed ? onRetry : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[
          styles.bubble,
          mine ? styles.mine : styles.theirs,
          lastInGroup && (mine ? styles.tailMine : styles.tailTheirs),
          tick === 'sending' && styles.sending,
        ]}>
        <Text variant="body" tone={mine ? 'greenInk' : 'ink'} selectable={false}>
          {body}
        </Text>
        <View style={styles.meta}>
          <Text variant="caption" tone={metaTone} tabular>
            {time}
          </Text>
          {mine && tick ? (
            <View testID={`tick-${tick}`} style={styles.ticks}>
              {TICK_ICONS[tick].map((icon, i) => (
                <IconSymbol
                  key={i}
                  name={icon}
                  size={ICON.small * 0.7}
                  color={failed ? colors.danger : colors.greenInk}
                  style={i > 0 ? styles.secondTick : undefined}
                />
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
      {failed ? (
        <Text variant="caption" tone="danger" style={styles.failedLine}>
          Not sent. Tap to retry.
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  row: { alignItems: 'flex-start', paddingHorizontal: space.md, paddingTop: space.xs / 2 },
  rowMine: { alignItems: 'flex-end' },
  groupStart: { paddingTop: space.sm },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.xs,
    gap: space.xs / 2,
  },
  mine: { backgroundColor: colors.green },
  theirs: { backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border },
  // The tail: the corner on the sender's side goes almost square.
  tailMine: { borderBottomRightRadius: space.xs },
  tailTheirs: { borderBottomLeftRadius: space.xs },
  sending: { opacity: 0.7 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.xs },
  ticks: { flexDirection: 'row', alignItems: 'center' },
  secondTick: { marginLeft: -space.sm },
  failedLine: { paddingTop: space.xs / 2 },
}));
