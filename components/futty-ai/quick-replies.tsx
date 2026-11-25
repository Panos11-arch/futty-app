import { View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { FuttyLogo } from '@/components/ui/futty-logo';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { QUICK_REPLIES } from '@/lib/futty-ai';
import { makeStyles } from '@/lib/theme';

/** An empty chat: the logo, one line, and the quick replies; tapping one sends it. */
export function QuickReplies({ onPick, disabled = false }: { onPick: (text: string) => void; disabled?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.wrap} testID="ai-quick-replies">
      <FuttyLogo size={space.xxl * 1.5} />
      <Text variant="headline">Ask Futty AI</Text>
      <View style={styles.chips}>
        {QUICK_REPLIES.map((q) => (
          <Chip
            key={q}
            testID={`ai-quick-${q.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}`}
            label={q}
            disabled={disabled}
            onPress={() => onPick(q)}
          />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { alignItems: 'center', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
}));
