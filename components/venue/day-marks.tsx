// The day's blocks and condition flags as a list above the calendar, each
// with Remove (spec 13 "Weather, condition warnings and blocking pitches";
// removing a block only reopens the slot to new bookings, decided 14
// November). One tap: removing changes no booking and no money.
import { StyleSheet, View } from 'react-native';

import { Button, ListRow } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { markLabel, type BoardBlock, type BoardFlag, type DayBoard } from '@/lib/venue-today';

export type DayMarksProps = {
  board: DayBoard;
  busy: string | null;
  onRemoveBlock: (block: BoardBlock) => void;
  onClearFlag: (flag: BoardFlag) => void;
};

export function DayMarks({ board, busy, onRemoveBlock, onClearFlag }: DayMarksProps) {
  if (board.blocks.length === 0 && board.flags.length === 0) return null;
  return (
    <View style={styles.list}>
      {board.blocks.map((block) => (
        <View key={block.id} testID={`block-${block.id}`}>
          <ListRow
            leading={{ icon: 'lock.fill' }}
            title="Closed to new bookings"
            subtitle={[markLabel(board, block), block.reason].filter(Boolean).join(' · ')}
            trailing={
              <Button
                label="Remove"
                variant="plain"
                loading={busy === block.id}
                onPress={() => onRemoveBlock(block)}
                accessibilityHint="Reopens these slots to new bookings"
              />
            }
          />
        </View>
      ))}
      {board.flags.map((flag) => (
        <View key={flag.id} testID={`flag-${flag.id}`}>
          <ListRow
            leading={{ icon: 'exclamationmark.triangle.fill' }}
            title="Conditions may be unsuitable"
            subtitle={[markLabel(board, flag), flag.note].filter(Boolean).join(' · ')}
            trailing={
              <Button label="Remove" variant="plain" loading={busy === flag.id} onPress={() => onClearFlag(flag)} />
            }
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
});
