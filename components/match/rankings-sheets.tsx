// The Rankings tab's two "how" sheets (images 14 and 15). Each line is a rule
// from match-record.md: "How it's picked" from decision 1k (Team of the
// Week), "How it works" from decision 1m (Power ranking). Labels only, no
// paragraphs (UX rules); the full rules live in Help.
import { View } from 'react-native';

import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/** Decision 1k: items 2 (Premium), 4.1 (best average rating), 4 (no positions), 1 (Friendly games never count). */
export const HOW_ITS_PICKED = [
  'Only Futty Premium players can be picked',
  'Best average rating that week',
  'Places come from goals, not positions',
  'Friendly games don’t count',
] as const;

/** Decision 1m: items 1 (start at 1000), 2 (We and K), 8 (listed after 3), 4 (a Friendly game counts for nothing). */
export const HOW_IT_WORKS = [
  'Everyone starts at 1000',
  'Beating a stronger team earns more',
  'Leagues and tournaments count more than non-league games',
  'A team appears after 3 matches',
  'Friendly games don’t count',
] as const;

function Points({ lines, testID }: { lines: readonly string[]; testID: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.list}>
      {lines.map((line, i) => (
        <View key={line} style={styles.point}>
          <Text variant="headline" tabular style={styles.number}>
            {`${i + 1}`}
          </Text>
          <Text variant="body" style={styles.line}>
            {line}
          </Text>
        </View>
      ))}
    </View>
  );
}

type SheetProps = { visible: boolean; onClose: () => void };

export function HowItsPickedSheet({ visible, onClose }: SheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose} title="How it’s picked">
      <Points lines={HOW_ITS_PICKED} testID="how-its-picked-sheet" />
    </Sheet>
  );
}

export function HowItWorksSheet({ visible, onClose }: SheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose} title="How it works">
      <Points lines={HOW_IT_WORKS} testID="how-it-works-sheet" />
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  list: { gap: space.md, paddingBottom: space.md },
  point: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  number: { minWidth: space.lg },
  line: { flex: 1 },
}));
