// S18: the sheet that opens from the initials in Edit avatar. "Use my
// initials", then the bundled illustrated avatars in a grid. Picking only
// changes the preview; the screen saves.
import { FlatList, Pressable, useWindowDimensions, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { Sheet } from '@/components/ui/sheet';
import { radius, space } from '@/constants/futty-theme';
import {
  AVATAR_ILLUSTRATION_IDS,
  avatarIllustrationLabel,
  type AvatarIllustrationId,
} from '@/lib/avatar-illustrations';
import { makeStyles } from '@/lib/theme';

const COLUMNS = 4;
/** The selected ring and the space inside it. */
const RING = 2;
/** The grid scrolls past this share of the screen height. */
const MAX_HEIGHT_SHARE = 0.55;
const IDS: AvatarIllustrationId[] = [...AVATAR_ILLUSTRATION_IDS];

export type IllustrationSheetProps = {
  visible: boolean;
  /** The illustration now in the preview, or null for initials. */
  selected: AvatarIllustrationId | null;
  onPick: (id: AvatarIllustrationId | null) => void;
  onClose: () => void;
};

/** Width of one grid cell: the sheet's inner width shared by 4 columns. */
export function cellSize(windowWidth: number): number {
  const inner = windowWidth - space.lg * 2 - space.sm * (COLUMNS - 1);
  return Math.max(MIN_TOUCH, Math.floor(inner / COLUMNS));
}

export function IllustrationSheet({ visible, selected, onPick, onClose }: IllustrationSheetProps) {
  const styles = useStyles();
  const { width, height } = useWindowDimensions();
  const cell = cellSize(width);
  const art = cell - RING * 4;

  return (
    <Sheet visible={visible} onClose={onClose} title="Choose avatar">
      <Button
        testID="avatar-sheet-use-initials"
        label="Use my initials"
        variant="secondary"
        onPress={() => onPick(null)}
        fullWidth
      />
      <FlatList
        testID="avatar-sheet-list"
        data={IDS}
        keyExtractor={(id) => id}
        numColumns={COLUMNS}
        style={{ maxHeight: height * MAX_HEIGHT_SHARE }}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        initialNumToRender={COLUMNS * 4}
        renderItem={({ item: id }) => {
          const isSelected = id === selected;
          return (
            <Pressable
              testID={`avatar-sheet-item-${id}`}
              accessibilityRole="button"
              accessibilityLabel={avatarIllustrationLabel(id)}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onPick(id)}
              style={[styles.cell, { width: cell, height: cell }, isSelected && styles.cellSelected]}>
              <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Avatar name={avatarIllustrationLabel(id)} kit={{ illustration: id }} size={art} />
              </View>
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  grid: { gap: space.sm },
  row: { gap: space.sm },
  cell: {
    borderRadius: radius.pill,
    borderWidth: RING,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: { borderColor: colors.positive },
}));
