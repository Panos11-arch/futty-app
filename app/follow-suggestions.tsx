// S7: "See all" from "Start following some accounts": every player the
// server suggests, with matches in common, Follow and Dismiss.
import { router, Stack } from 'expo-router';
import { FlatList, RefreshControl, View } from 'react-native';
import { useState } from 'react';

import { FollowToggle } from '@/components/community/follow-toggle';
import { PersonRow, RowsSkeleton } from '@/components/community/person-row';
import { inCommonLabel } from '@/components/community/suggestion-card';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { space } from '@/constants/futty-theme';
import { avatarLook } from '@/lib/avatar';
import type { FollowSuggestion } from '@/lib/community';
import { profileHref } from '@/lib/messages';
import { makeStyles, useTheme } from '@/lib/theme';
import { useFollowSuggestions } from '@/lib/use-follow-suggestions';
import { useFollows } from '@/lib/use-follows';

/** The most the server returns at once. */
const ALL_SUGGESTIONS = 50;

export default function FollowSuggestionsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const suggestions = useFollowSuggestions(ALL_SUGGESTIONS);
  const follows = useFollows();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await suggestions.reload();
    setRefreshing(false);
  }

  function renderItem({ item }: { item: FollowSuggestion }) {
    return (
      <PersonRow
        testID={`suggestions-row-${item.id}`}
        name={item.full_name}
        subtitle={inCommonLabel(item.matches_in_common)}
        kit={avatarLook(item)}
        onPress={() => router.push(profileHref(item.id))}
        actions={
          <>
            <FollowToggle
              testID={`suggestions-follow-${item.id}`}
              targetType="player"
              targetId={item.id}
              name={item.full_name}
              follows={follows}
            />
            <IconButton
              testID={`suggestions-dismiss-${item.id}`}
              icon="xmark"
              size="small"
              tone="inkMuted"
              accessibilityLabel={`Dismiss ${item.full_name}`}
              onPress={() => void suggestions.dismiss(item.id)}
            />
          </>
        }
      />
    );
  }

  let empty = null;
  if (suggestions.status === 'loading') empty = <RowsSkeleton testID="suggestions-list-skeleton" />;
  else if (suggestions.status === 'error')
    empty = (
      <Banner
        tone="danger"
        message="Couldn't load suggestions."
        action={{ label: 'Try again', onPress: suggestions.reload }}
      />
    );
  else empty = <EmptyState icon="person.2.fill" message="No suggestions yet." action={{ label: 'Go back', onPress: () => router.back() }} />;

  return (
    <View testID="follow-suggestions-screen" style={styles.screen}>
      <Stack.Screen options={{ title: 'Suggestions' }} />
      <FlatList
        testID="follow-suggestions-list"
        data={suggestions.status === 'ready' ? suggestions.items : []}
        keyExtractor={(s) => s.id}
        renderItem={renderItem}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.inkMuted} />}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
}));
