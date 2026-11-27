// S20: Community → Friends. Friend requests to me first (Accept / Decline),
// then my friends (Message), rows styled like image 18's cards. A row opens
// the player's sheet (components/friends/profile-sheet.tsx). Empty: one line
// and Scan. Everything comes from the server (my_friends).
//
// Not listed in app/_layout.tsx: like check-in.tsx, the route works on its
// own (shared files change only in S1, S2 and S16).
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, SectionList, View } from 'react-native';

import { PersonRow, RowsSkeleton } from '@/components/community/person-row';
import { ProfileSheet } from '@/components/friends/profile-sheet';
import { Banner, Button, EmptyState, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { friendSubtitle, SCAN_HREF, messageLabel, type FriendRow } from '@/lib/friends';
import { haptic } from '@/lib/haptics';
import { chatHref, describeMessageError, kitOf, openFriendConversation } from '@/lib/messages';
import { makeStyles, useTheme } from '@/lib/theme';
import { useFriends } from '@/lib/use-friends';

type Section = { key: 'requests' | 'friends'; title: string; data: FriendRow[] };

export function friendSections(rows: FriendRow[]): Section[] {
  const requests = rows.filter((r) => r.kind === 'request');
  const friends = rows.filter((r) => r.kind === 'friend');
  return [
    { key: 'requests' as const, title: 'Requests', data: requests },
    { key: 'friends' as const, title: 'Friends', data: friends },
  ].filter((s) => s.data.length > 0);
}

export default function FriendsScreen() {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const friends = useFriends();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);

  async function accept(row: FriendRow) {
    if (busy) return;
    setBusy(`accept:${row.profile_id}`);
    setProblem(null);
    const { error } = await friends.accept(row);
    setBusy(null);
    if (error) setProblem({ id: row.profile_id, text: error });
    else haptic.success();
  }

  async function decline(row: FriendRow) {
    if (busy) return;
    setBusy(`decline:${row.profile_id}`);
    setProblem(null);
    const error = await friends.decline(row);
    setBusy(null);
    if (error) setProblem({ id: row.profile_id, text: error });
  }

  async function message(row: FriendRow) {
    if (busy) return;
    setBusy(`message:${row.profile_id}`);
    setProblem(null);
    const { conversationId, error } = await openFriendConversation(row.profile_id);
    setBusy(null);
    if (error || !conversationId) setProblem({ id: row.profile_id, text: describeMessageError(error) });
    else router.push(chatHref(conversationId));
  }

  function renderRow(row: FriendRow) {
    const request = row.kind === 'request';
    return (
      <PersonRow
        testID={`friends-row-${row.profile_id}`}
        name={row.name}
        subtitle={friendSubtitle(row)}
        kit={kitOf(row)}
        onPress={() => setOpen(row.profile_id)}
        actions={
          request ? (
            <>
              <Button
                testID={`friends-accept-${row.profile_id}`}
                label="Accept"
                size="compact"
                onPress={() => void accept(row)}
                loading={busy === `accept:${row.profile_id}`}
              />
              <Button
                testID={`friends-decline-${row.profile_id}`}
                label="Decline"
                size="compact"
                variant="secondary"
                onPress={() => void decline(row)}
                loading={busy === `decline:${row.profile_id}`}
              />
            </>
          ) : (
            <Button
              testID={`friends-message-${row.profile_id}`}
              label="Message"
              size="compact"
              variant="secondary"
              accessibilityHint={messageLabel(row.first_name)}
              onPress={() => void message(row)}
              loading={busy === `message:${row.profile_id}`}
            />
          )
        }>
        {problem?.id === row.profile_id ? (
          <Text testID={`friends-problem-${row.profile_id}`} tone="danger" accessibilityRole="alert">
            {problem.text}
          </Text>
        ) : null}
      </PersonRow>
    );
  }

  const { state } = friends;
  return (
    <View style={styles.screen} testID="friends-screen">
      <Stack.Screen
        options={{
          title: 'Friends',
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: type.headline.fontFamily, color: colors.ink },
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      {state.status === 'loading' ? (
        <View style={styles.padded}>
          <RowsSkeleton testID="friends-skeleton" />
        </View>
      ) : null}
      {state.status === 'error' ? (
        <View style={styles.padded}>
          <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: () => void friends.reload() }} />
        </View>
      ) : null}
      {state.status === 'ready' ? (
        <SectionList
          testID="friends-list"
          sections={friendSections(state.rows)}
          keyExtractor={(row) => `${row.kind}:${row.profile_id}`}
          renderItem={({ item }) => renderRow(item)}
          renderSectionHeader={({ section }) => (
            <Text variant="headline" accessibilityRole="header" style={styles.header} testID={`friends-section-${section.key}`}>
              {section.title}
            </Text>
          )}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={friends.refreshing} onRefresh={() => void friends.refresh()} tintColor={colors.muted} />}
          contentContainerStyle={state.rows.length === 0 ? styles.emptyContent : styles.listContent}
          ListEmptyComponent={
            <View testID="friends-empty">
              <EmptyState icon="person.2.fill" message="No friends yet." action={{ label: 'Scan a card', onPress: () => router.push(SCAN_HREF) }} />
            </View>
          }
        />
      ) : null}
      <ProfileSheet
        visible={open !== null}
        who={open ? { profileId: open } : null}
        onClose={() => setOpen(null)}
        onChanged={() => void friends.refresh()}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  padded: { padding: space.lg },
  listContent: { padding: space.lg, paddingBottom: space.xxl },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  header: { paddingTop: space.md, paddingBottom: space.sm },
  gap: { height: space.md },
}));
