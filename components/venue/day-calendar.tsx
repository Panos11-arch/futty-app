// The venue dashboard's day calendar per pitch (spec 05 section 12, item 1;
// spec 15 "Venue dashboard"): one column per pitch, one row per half hour,
// with every booking, walk-in, block and condition flag from
// venue_day_board. Tap a booking to open it; tap a free slot to add a
// walk-in or phone booking there; tap a flagged slot to flag from that pitch
// and half hour; tap a blocked slot to remove that block. A slot that has
// passed (Cyprus time), or that no game could start in and end by midnight,
// takes no tap. Rows grow with the text size. Amounts are the server's, only
// formatted.
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { EmptyState, Text } from '@/components/ui';
import { colors, hairline, radius, space } from '@/constants/futty-theme';
import {
  bookingSummary,
  bookingTitle,
  canStartGame,
  hhmm,
  kindLabel,
  pitchColumn,
  slotIsPast,
  SLOT_STARTS,
  type BoardBlock,
  type BoardBooking,
  type BoardPitch,
  type CalendarCell,
  type DayBoard,
} from '@/lib/venue-today';

/** A half hour at the default text size: a 44-point touch target. */
const ROW = 44;
const COLUMN = 148;
const GUTTER = 52;

/** Row height, column and gutter widths for the phone's text size, so large
 *  text makes rows taller instead of clipping. */
export function calendarSizes(fontScale: number) {
  const scale = Math.max(1, fontScale);
  return { row: Math.ceil(ROW * scale), column: Math.ceil(COLUMN * scale), gutter: Math.ceil(GUTTER * scale) };
}

type Sizes = ReturnType<typeof calendarSizes>;

/** Today's date and the time now, both in Cyprus. */
export type CalendarClock = { today: string; now: string };

export type DayCalendarProps = {
  board: DayBoard;
  clock: CalendarClock;
  onOpenBooking: (booking: BoardBooking) => void;
  onAddAt: (pitch: BoardPitch, start: string) => void;
  /** A flagged free slot: open Flag for that pitch and half hour. */
  onFlagAt: (pitch: BoardPitch, start: string) => void;
  /** A blocked slot: offer to remove that block. */
  onBlockAt: (block: BoardBlock) => void;
};

export function DayCalendar({ board, clock, ...handlers }: DayCalendarProps) {
  const { fontScale } = useWindowDimensions();
  const sizes = calendarSizes(fontScale);
  if (board.pitches.length === 0) {
    return <EmptyState icon="sportscourt.fill" message="No pitches are set up for this venue yet." />;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.grid}>
        <View style={{ width: sizes.gutter }}>
          <View style={[styles.header, { height: sizes.row }]} />
          {SLOT_STARTS.map((start) => (
            <View key={start} style={{ height: sizes.row }}>
              {start.endsWith(':00') ? (
                <Text variant="caption" tone="inkMuted" tabular>
                  {start}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
        {board.pitches.map((pitch) => (
          <PitchColumn key={pitch.id} board={board} clock={clock} pitch={pitch} sizes={sizes} {...handlers} />
        ))}
      </View>
    </ScrollView>
  );
}

type Handlers = Omit<DayCalendarProps, 'board' | 'clock'>;

function PitchColumn({
  board,
  clock,
  pitch,
  sizes,
  onOpenBooking,
  ...cellHandlers
}: { board: DayBoard; clock: CalendarClock; pitch: BoardPitch; sizes: Sizes } & Handlers) {
  const { bookings, cells } = pitchColumn(board, pitch.id);
  return (
    <View style={[styles.column, { width: sizes.column }]}>
      <View style={[styles.header, { height: sizes.row }]}>
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
          <Cell
            key={cell.start}
            pitch={pitch}
            cell={cell}
            past={slotIsPast(cell.start, board.day, clock.today, clock.now)}
            height={sizes.row}
            {...cellHandlers}
          />
        ))}
        {bookings.map(({ booking, row, span, flagged, earlier }) => (
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
              { top: row * sizes.row + space.xs / 2, height: span * sizes.row - space.xs },
              pressed && styles.pressed,
            ]}>
            <Text variant="caption" tone="inkMuted" numberOfLines={1}>
              {earlier ? 'Earlier start · ' : ''}
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
  past,
  height,
  onAddAt,
  onFlagAt,
  onBlockAt,
}: {
  pitch: BoardPitch;
  cell: CalendarCell;
  past: boolean;
  height: number;
} & Omit<Handlers, 'onOpenBooking'>) {
  const testID = `cell-${pitch.id}-${cell.start}`;
  const style = [styles.cell, { height }];
  if (!cell.free) return <View testID={testID} style={style} />;
  const flagged = cell.flagged ? ', conditions may be unsuitable' : '';
  if (past) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={`${pitch.name}, ${cell.start}, past`}
        style={[style, cell.blocked && styles.blocked]}
      />
    );
  }
  if (cell.blocked) {
    const block = cell.blocked;
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${pitch.name}, ${cell.start}, blocked${flagged}. Remove the block`}
        onPress={() => onBlockAt(block)}
        style={({ pressed }) => [style, styles.blocked, pressed && styles.cellPressed]}>
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
        style={[style, styles.blocked]}
      />
    );
  }
  if (!canStartGame(cell.start)) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={`${pitch.name}, ${cell.start}, too late to start a game`}
        style={style}
      />
    );
  }
  if (cell.flagged) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${pitch.name}, ${cell.start}, free${flagged}. Block or flag this slot, or add a walk-in`}
        onPress={() => onFlagAt(pitch, cell.start)}
        style={({ pressed }) => [style, pressed && styles.cellPressed]}>
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
      style={({ pressed }) => [style, pressed && styles.cellPressed]}
    />
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row' },
  header: { justifyContent: 'center', paddingHorizontal: space.sm },
  column: { borderLeftWidth: hairline, borderLeftColor: colors.border },
  cell: {
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
