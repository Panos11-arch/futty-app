// S7: "Start following some accounts": a row of cards and "See all".
// Hidden when the server has no suggestions.
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { SuggestionCard } from '@/components/community/suggestion-card';
import { Banner } from '@/components/ui/banner';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import type { useFollows } from '@/lib/use-follows';
import { useFollowSuggestions } from '@/lib/use-follow-suggestions';

/** How many cards the row shows; "See all" lists the rest. */
export const SUGGESTIONS_IN_ROW = 8;

export function FollowSuggestions({ follows }: { follows: ReturnType<typeof useFollows> }) {
  const styles = useStyles();
  const suggestions = useFollowSuggestions(SUGGESTIONS_IN_ROW);

  if (suggestions.status === 'loading') {
    return (
      <View testID="suggestions-skeleton" style={styles.row}>
        {[0, 1].map((i) => (
          <SkeletonBlock key={i} width={MIN_TOUCH * 3} height={MIN_TOUCH * 4} />
        ))}
      </View>
    );
  }
  if (suggestions.status === 'error') {
    return (
      <Banner
        tone="danger"
        message="Couldn't load suggestions."
        action={{ label: 'Try again', onPress: suggestions.reload }}
      />
    );
  }
  if (suggestions.items.length === 0) return null;

  return (
    <View testID="community-suggestions" style={styles.section}>
      <SectionHeader
        title="Start following some accounts"
        action={{ label: 'See all', onPress: () => router.push('/follow-suggestions') }}
      />
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={suggestions.items}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <SuggestionCard suggestion={item} follows={follows} onDismiss={(id) => void suggestions.dismiss(id)} />
        )}
        contentContainerStyle={styles.row}
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  section: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.md },
}));
