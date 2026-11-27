// S20A: a team's badge. A circle in the team's kit colour with its initials
// in the kit's label colour (both from constants/futty-theme.ts kitColours,
// tested for contrast there); a team without a kit shows the neutral avatar.
import { View } from 'react-native';

import { Avatar, initials } from '@/components/ui/avatar';
import { Text, type TextVariant } from '@/components/ui/text';
import { hairline, kitColours, radius } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { teamKit } from '@/lib/team-kit';

function initialsVariant(size: number): TextVariant {
  if (size >= 56) return 'title';
  if (size >= 40) return 'callout';
  return 'caption';
}

export function TeamBadge({ name, kitColour, size = 40 }: { name: string; kitColour?: string | null; size?: number }) {
  const styles = useStyles();
  const kit = teamKit({ kit_colour: kitColour });
  if (!kit) return <Avatar name={name} size={size} />;
  const { shirt, label } = kitColours[kit];
  return (
    <View
      testID="team-badge"
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[styles.circle, kit === 'kitWhite' && styles.outlined, { width: size, height: size, backgroundColor: shirt }]}>
      <Text variant={initialsVariant(size)} numberOfLines={1} style={{ color: label }}>
        {initials(name)}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  circle: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  // A white kit needs an outline to show on the canvas.
  outlined: { borderWidth: hairline, borderColor: colors.border },
}));
