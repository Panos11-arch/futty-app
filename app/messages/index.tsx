import { router, Stack } from 'expo-router';
import { FlatList, RefreshControl, View } from 'react-native';

import { InboxRow } from '@/components/messages/inbox-row';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { hairline, space } from '@/constants/futty-theme';
import { chatHref, FORMER_PLAYER, profileHref, teamHref } from '@/lib/messages';
import { makeStyles, useTheme } from '@/lib/theme';
import { useInbox } from '@/lib/use-messages';

/**
 * S13: Messages. Every chat the player is in (captain and friend chats),
 * newest first, with unread counts. Opened from Account and Community.
 */
export default function InboxScreen() {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const inbox = useInbox();

  return (
    <View style={styles.screen} testID="messages-screen">
      <Stack.Screen
        options={{
          title: 'Messages',
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: type.headline.fontFamily, color: colors.ink },
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      {inbox.state.status === 'loading' ? (
        <View testID="messages-skeleton" style={styles.skeleton}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <SkeletonBlock width={space.xxl + space.sm} height={space.xxl + space.sm} />
              <View style={styles.flex}>
                <SkeletonText lines={2} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {inbox.state.status === 'error' ? (
        <View style={styles.padded}>
          <Banner tone="danger" message={inbox.state.message} action={{ label: 'Try again', onPress: inbox.retry }} />
        </View>
      ) : null}

      {inbox.state.status === 'ready' ? (
        <FlatList
          testID="messages-list"
          data={inbox.state.rows}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => (
            <InboxRow
              row={item}
              onOpen={() => router.push(chatHref(item.id))}
              onOpenProfile={
                item.other_profile_id && item.title !== FORMER_PLAYER
                  ? () => router.push(profileHref(item.other_profile_id as string))
                  : item.other_team_id
                    ? () => router.push(teamHref(item.other_team_id as string))
                    : undefined
              }
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={<RefreshControl refreshing={inbox.refreshing} onRefresh={inbox.refresh} tintColor={colors.muted} />}
          contentContainerStyle={inbox.state.rows.length === 0 ? styles.emptyContent : styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="bubble.left.fill"
              message="No messages yet."
              action={{ label: 'Open leagues', onPress: () => router.push('/leagues') }}
            />
          }
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  padded: { padding: space.lg },
  skeleton: { padding: space.lg, gap: space.lg },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  listContent: { paddingVertical: space.sm },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  separator: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg + space.xxl + space.xl },
}));
