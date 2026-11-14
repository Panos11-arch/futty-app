// The venue dashboard's day calendar per pitch (spec 05 section 12, item 1;
// spec 15 "Venue dashboard"): one column per pitch, one row per half hour,
// with every booking, walk-in, block and condition flag from
// venue_day_board. Tap a booking to open it; tap a free slot to add a
// walk-in or phone booking there; tap a blocked or flagged slot to block or
// flag from that pitch and half hour. Amounts are the server's, only formatted.
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { EmptyState, Text } from '@/components/ui';
import { colors, hairline, radius, space } from '@/constants/futty-theme';
import {
  bookingSummary,
  bookingTitle,
  hhmm,
  kindLabel,
  pitchColumn,
  SLOT_STARTS,
  type BoardBooking,
  type BoardPitch,
  type CalendarCell,
  type DayBoard,
} from '@/lib/venue-today';

/** A half hour: tall enough to be a 44-point touch target. */
const ROW = 44;
const COLUMN = 148;
const GUTTER = 52;

export type DayCalendarProps = {
  board: DayBoard;
  onOpenBooking: (booking: BoardBooking) => void;
  onAddAt: (pitch: BoardPitch, start: string) => void;
  /** A blocked or flagged slot: open Block or Flag for that pitch and time. */
  onMarkAt: (pitch: BoardPitch, start: string, mode: 'block' | 'flag') => void;
};

export function DayCalendar({ board, onOpenBooking, onAddAt, onMarkAt }: DayCalendarProps) {
  if (board.pitches.length === 0) {
    return <EmptyState icon="sportscourt.fill" message="No pitches are set up for this venue yet." />;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.grid}>
        <View style={styles.gutter}>
          <View style={styles.header} />
          {SLOT_STARTS.map((start) => (
            <View key={start} style={styles.timeCell}>
              {start.endsWith(':00') ? (
                <Text variant="caption" tone="inkMuted" tabular>
                  {start}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
        {board.pitches.map((pitch) => (
          <PitchColumn
            key={pitch.id}
            board={board}
            pitch={pitch}
            onOpenBooking={onOpenBooking}
            onAddAt={onAddAt}
            onMarkAt={onMarkAt}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function PitchColumn({
  board,
  pitch,
  onOpenBooking,
  onAddAt,
  onMarkAt,
}: { board: DayBoard; pitch: BoardPitch } & Omit<DayCalendarProps, 'board'>) {
  const { bookings, cells } = pitchColumn(board, pitch.id);
  return (
    <View style={styles.column}>
      <View style={styles.header}>
        <Text variant="callout" numberOfLines={1}>
          {pitch.name}
        </Text>
        {!pitch.is_open ? (
          <Text variant="caption" tone="inkMuted">
            Closed
          </Text>
        ) : null}
      </View>
      <View>
        {cells.map((cell) => (
          <Cell key={cell.start} pitch={pitch} cell={cell} onAddAt={onAddAt} onMarkAt={onMarkAt} />
        ))}
        {bookings.map(({ booking, row, span, flagged }) => (
          <Pressable
            key={booking.id}
            testID={`booking-${booking.id}`}
            accessibilityRole="button"
            accessibilityLabel={[
              kindLabel(booking),
              bookingTitle(booking),
              `${hhmm(booking.start_time)} to ${hhmm(booking.end_time)}`,
              bookingSummary(booking),
              flagged ? 'conditions may be unsuitable' : '',
            ]
              .filter(Boolean)
              .join(', ')}
            onPress={() => onOpenBooking(booking)}
            style={({ pressed }) => [
              styles.booking,
              { top: row * ROW + space.xs / 2, height: span * ROW - space.xs },
              pressed && styles.pressed,
            ]}>
            <Text variant="caption" tone="inkMuted" numberOfLines={1}>
              {kindLabel(booking)} · {hhmm(booking.start_time)}–{hhmm(booking.end_time)}
            </Text>
            <Text variant="callout" numberOfLines={1}>
              {bookingTitle(booking)}
            </Text>
            {bookingSummary(booking) ? (
              <Text variant="caption" tone="inkMuted" tabular numberOfLines={span > 1 ? 2 : 1}>
                {bookingSummary(booking)}
              </Text>
            ) : null}
            {flagged ? (
              <Text variant="caption" tone="warning" numberOfLines={1}>
                Conditions may be unsuitable
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Cell({
  pitch,
  cell,
  onAddAt,
  onMarkAt,
}: {
  pitch: BoardPitch;
  cell: CalendarCell;
  onAddAt: DayCalendarProps['onAddAt'];
  onMarkAt: DayCalendarProps['onMarkAt'];
}) {
  const testID = `cell-${pitch.id}-${cell.start}`;
  if (!cell.free) return <View testID={testID} style={styles.cell} />;
  const flagged = cell.flagged ? ', conditions may be unsuitable' : '';
  if (cell.blocked) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${pitch.name}, ${cell.start}, blocked${flagged}. Block or flag this slot`}
        onPress={() => onMarkAt(pitch, cell.start, 'block')}
        style={({ pressed }) => [styles.cell, styles.blocked, pressed && styles.cellPressed]}>
        <Text variant="caption" tone="inkMuted">
          Blocked
        </Text>
      </Pressable>
    );
  }
  if (!pitch.is_open) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={`${pitch.name}, ${cell.start}, closed${flagged}`}
        style={[styles.cell, styles.blocked]}
      />
    );
  }
  if (cell.flagged) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${pitch.name}, ${cell.start}, free${flagged}. Block or flag this slot, or add a walk-in`}
        onPress={() => onMarkAt(pitch, cell.start, 'flag')}
        style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}>
        <Text variant="caption" tone="warning">
          Flagged
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${pitch.name}, ${cell.start}, free. Add a walk-in or phone booking`}
      onPress={() => onAddAt(pitch, cell.start)}
      style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
    />
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row' },
  gutter: { width: GUTTER },
  header: { height: ROW, justifyContent: 'center', paddingHorizontal: space.sm },
  timeCell: { height: ROW, justifyContent: 'flex-start' },
  column: { width: COLUMN, borderLeftWidth: hairline, borderLeftColor: colors.border },
  cell: {
    height: ROW,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    paddingHorizontal: space.sm,
    justifyContent: 'center',
  },
  cellPressed: { backgroundColor: colors.brandSoft },
  blocked: { backgroundColor: colors.canvas },
  booking: {
    position: 'absolute',
    left: space.xs,
    right: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: colors.border,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.8 },
});
