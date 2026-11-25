import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ChatHeader } from '@/components/messages/chat-header';
import { ChatView } from '@/components/messages/chat-view';
import { ReportSheet } from '@/components/messages/report-sheet';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { copyText } from '@/lib/clipboard';
import { haptic } from '@/lib/haptics';
import {
  bookTogetherHref,
  FORMER_PLAYER,
  kitOf,
  profileHref,
  refusalLine,
  teamHref,
  teamVsTeamHref,
  tickFor,
  type ChatMessage,
} from '@/lib/messages';
import { blockUser, submitReport, unblockUser } from '@/lib/moderation';
import { makeStyles } from '@/lib/theme';
import { useConversation } from '@/lib/use-messages';

type Reporting = { kind: 'conversation' } | { kind: 'message'; message: ChatMessage };

/** S13: one chat, captain to captain or friend to friend. */
export default function ChatScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const chat = useConversation(id);
  const [moreOpen, setMoreOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<Reporting | null>(null);

  const ready = chat.state.status === 'ready' ? chat.state : null;
  const header = ready?.header ?? null;
  const otherId = header?.other_profile_id ?? null;
  const former = header?.title === FORMER_PLAYER;
  const canOpenProfile = !!otherId && !former;

  function openTitle() {
    if (!header) return;
    if (canOpenProfile) router.push(profileHref(otherId as string));
    else if (header.other_team_id) router.push(teamHref(header.other_team_id));
  }

  async function setBlocked(block: boolean) {
    if (!user || !otherId) return;
    setBlockBusy(true);
    setBlockError(null);
    const { error } = block ? await blockUser(user.id, otherId) : await unblockUser(user.id, otherId);
    setBlockBusy(false);
    if (error) {
      setBlockError('Could not update. Try again.');
      return;
    }
    setBlockOpen(false);
    void chat.reloadHeader();
  }

  async function sendReport(reason: string): Promise<string | null> {
    if (!user || !id || !reporting) return null;
    const { error } =
      reporting.kind === 'message'
        ? await submitReport({
            reporterId: user.id,
            reportedUserId: reporting.message.sender_id ?? undefined,
            context: 'message',
            contextId: reporting.message.id,
            reason,
          })
        : await submitReport({
            reporterId: user.id,
            reportedUserId: otherId ?? undefined,
            context: 'conversation',
            contextId: id,
            reason,
          });
    return error ? 'Could not send. Try again.' : null;
  }

  const friendActions =
    header?.kind === 'friends' && otherId && !former ? (
      <View style={styles.actions}>
        <Button
          testID="chat-book-together"
          label="Book together"
          size="compact"
          onPress={() => router.push(bookTogetherHref(otherId))}
        />
        {header.friend_team_id && header.my_captain_team_id ? (
          <Button
            testID="chat-team-vs-team"
            label="Team vs team"
            variant="secondary"
            size="compact"
            onPress={() => router.push(teamVsTeamHref(header.friend_team_id as string))}
          />
        ) : null}
      </View>
    ) : null;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ChatView
        header={
          <>
            <ChatHeader
              title={header?.title ?? ''}
              subtitle={header?.subtitle}
              kit={kitOf(header)}
              onBack={() => (router.canGoBack() ? router.back() : router.replace('/messages'))}
              onOpenTitle={header ? openTitle : undefined}
              onOpenSubtitle={header?.other_team_id ? () => router.push(teamHref(header.other_team_id as string)) : undefined}
              onMore={header ? () => setMoreOpen(true) : undefined}
            />
            {friendActions}
          </>
        }
        messages={ready ? ready.messages : null}
        loadError={chat.state.status === 'error' ? chat.state.message : null}
        onRetryLoad={chat.reload}
        tickFor={(m) => (m.mine ? tickFor(m, header) : null)}
        onSend={chat.send}
        onRetrySend={(clientId) => void chat.retry(clientId)}
        sendError={chat.sendError}
        refusal={header ? refusalLine(header.send_refusal, header.blocked_by_me) : null}
        refusalAction={
          header?.send_refusal === 'blocked' && header.blocked_by_me ? { label: 'Unblock', onPress: () => void setBlocked(false) } : null
        }
        emptyLine="No messages yet. Say hello."
        hasOlder={ready?.hasOlder}
        loadingOlder={chat.loadingOlder}
        onLoadOlder={() => void chat.loadOlder()}
        unseen={chat.unseen}
        onAtBottomChange={chat.setAtBottom}
        onCopy={(m) => {
          copyText(m.body);
          haptic.tap();
        }}
        onReport={(m) => setReporting({ kind: 'message', message: m })}
      />

      <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={header?.title ?? 'Chat'}>
        <View style={styles.menu}>
          <ListRow
            testID="chat-report"
            title="Report"
            leading={{ icon: 'flag.fill' }}
            onPress={() => {
              setMoreOpen(false);
              setReporting({ kind: 'conversation' });
            }}
          />
          {otherId && !former ? (
            <ListRow
              testID="chat-block"
              title={header?.blocked_by_me ? 'Unblock' : 'Block'}
              leading={{ icon: 'exclamationmark.circle.fill' }}
              onPress={() => {
                setMoreOpen(false);
                if (header?.blocked_by_me) void setBlocked(false);
                else setBlockOpen(true);
              }}
            />
          ) : null}
        </View>
      </Sheet>

      <Sheet
        visible={blockOpen}
        onClose={() => setBlockOpen(false)}
        title={`Block ${header?.title ?? ''}?`}
        primaryAction={{ label: 'Block', onPress: () => void setBlocked(true), loading: blockBusy, testID: 'chat-block-confirm' }}
        secondaryAction={{ label: 'Cancel' }}>
        {blockError ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
            {blockError}
          </Text>
        ) : null}
      </Sheet>

      <ReportSheet visible={!!reporting} onClose={() => setReporting(null)} onSend={sendReport} />
    </>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  menu: { gap: space.xs },
}));
