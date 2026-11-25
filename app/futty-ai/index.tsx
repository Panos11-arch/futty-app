import { router, Stack } from 'expo-router';
import { FlatList, RefreshControl, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { hairline, space } from '@/constants/futty-theme';
import { chatDateLabel, futtyAiHref, NEW_CHAT } from '@/lib/futty-ai';
import { makeStyles, useTheme } from '@/lib/theme';
import { useAiChats } from '@/lib/use-futty-ai';

/**
 * S13A: Futty AI, from Account → Help → "Ask Futty AI". My past chats
 * (title = the first question, Cyprus date), newest first, and "New chat".
 * Chats are deleted 7 days after their last message.
 */
export default function FuttyAiChatsScreen() {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const { state, refreshing, refresh, retry } = useAiChats();
  const openNew = () => router.push(futtyAiHref(NEW_CHAT));

  return (
    <View style={styles.screen} testID="futty-ai-screen">
      <Stack.Screen
        options={{
          title: 'Futty AI',
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: type.headline.fontFamily, color: colors.ink },
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      {state.status === 'loading' ? (
        <View testID="futty-ai-skeleton" style={styles.skeleton}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonText key={i} lines={2} />
          ))}
        </View>
      ) : state.status === 'error' ? (
        <View style={styles.pad}>
          <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: retry }} />
        </View>
      ) : (
        <FlatList
          testID="futty-ai-chats"
          data={state.chats}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
          contentContainerStyle={state.chats.length === 0 ? styles.emptyContent : styles.content}
          ListHeaderComponent={
            state.chats.length > 0 ? (
              <View style={styles.newChat}>
                <Button testID="futty-ai-new-chat" label="New chat" onPress={openNew} fullWidth />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View testID="futty-ai-empty">
              <EmptyState icon="bubble.left.fill" message="No chats yet." action={{ label: 'New chat', onPress: openNew }} />
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <ListRow
              testID="futty-ai-chat-row"
              title={item.title}
              subtitle={chatDateLabel(item.last_message_at)}
              chevron
              onPress={() => router.push(futtyAiHref(item.id))}
            />
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  skeleton: { padding: space.lg, gap: space.lg },
  pad: { padding: space.lg },
  content: { paddingBottom: space.xl },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  newChat: { padding: space.lg },
  separator: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
}));
