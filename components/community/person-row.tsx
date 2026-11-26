import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import type { AvatarLook } from '@/lib/avatar';
import { makeStyles } from '@/lib/theme';

/** One person or team: avatar, name, a line under it, then one row of
 *  actions. The name side opens the profile when `onPress` is set.
 *  (Moved from app/(tabs)/community.tsx in S7.) */
export function PersonRow({
  name,
  subtitle,
  kit,
  onPress,
  actions,
  children,
  testID,
}: {
  name: string;
  subtitle?: string | null;
  kit?: AvatarLook | null;
  onPress?: () => void;
  actions: ReactNode;
  children?: ReactNode;
  testID?: string;
}) {
  const styles = useStyles();
  const main = (
    <>
      <Avatar name={name} kit={kit} />
      <View style={styles.flex}>
        <Text variant="headline">{name}</Text>
        {subtitle ? (
          <Text variant="callout" tone="inkMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <Card testID={testID} style={styles.personCard}>
      <View style={styles.row}>
        {onPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={subtitle ? `${name}, ${subtitle}` : name}
            onPress={onPress}
            style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
            {main}
          </Pressable>
        ) : (
          <View style={styles.rowMain}>{main}</View>
        )}
        <View style={styles.rowActions}>{actions}</View>
      </View>
      {children}
    </Card>
  );
}

export function RowsSkeleton({ testID }: { testID: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.list}>
      {[0, 1, 2].map((i) => (
        <Card key={i} style={styles.row}>
          <SkeletonBlock width={MIN_TOUCH - space.xs} height={MIN_TOUCH - space.xs} rounded="pill" />
          <View style={styles.flex}>
            <SkeletonText lines={2} />
          </View>
        </Card>
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  flex: { flex: 1 },
  list: { gap: space.md },
  personCard: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pressed: { opacity: 0.8 },
}));
