import { View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import type { AvatarLook } from '@/lib/avatar';

export type AvatarStackPerson = { id: string; name: string; photoUrl?: string | null; kit?: AvatarLook | null };

export type AvatarStackProps = {
  people: AvatarStackPerson[];
  /** How many avatars to show before "+N". */
  max?: number;
  size?: number;
};

export function AvatarStack({ people, max = 4, size = 32 }: AvatarStackProps) {
  const styles = useStyles();
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;
  const label = `${people.length} ${people.length === 1 ? 'player' : 'players'}`;
  return (
    <View accessible accessibilityLabel={label} style={styles.row}>
      {shown.map((person, i) => (
        <View key={person.id} style={i > 0 && styles.overlap}>
          <Avatar name={person.name} photoUrl={person.photoUrl} kit={person.kit} size={size} ringed />
        </View>
      ))}
      {overflow > 0 ? (
        <View style={[styles.overflow, styles.overlap, { minWidth: size, height: size }]}>
          <Text variant="caption" tone="inkMuted" tabular allowFontScaling={false}>
            {`+${overflow}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginLeft: -space.sm },
  overflow: {
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.canvas,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
