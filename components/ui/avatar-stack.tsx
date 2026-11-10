import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { colors, radius, space } from '@/constants/futty-theme';

export type AvatarStackPerson = { id: string; name: string; photoUrl?: string | null };

export type AvatarStackProps = {
  people: AvatarStackPerson[];
  /** How many avatars to show before "+N". */
  max?: number;
  size?: number;
};

export function AvatarStack({ people, max = 4, size = 32 }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;
  const label = `${people.length} ${people.length === 1 ? 'player' : 'players'}`;
  return (
    <View accessible accessibilityLabel={label} style={styles.row}>
      {shown.map((person, i) => (
        <View key={person.id} style={i > 0 && styles.overlap}>
          <Avatar name={person.name} photoUrl={person.photoUrl} size={size} ringed />
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

const styles = StyleSheet.create({
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
});
