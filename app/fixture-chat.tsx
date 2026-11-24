import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthField } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useAuth } from '@/lib/auth';
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import {
  getFixture,
  listFixtureMessages,
  sendFixtureMessage,
  type Fixture,
  type FixtureMessage,
} from '@/lib/fixtures';
import { describeLeagueError } from '@/lib/league-errors';
import { submitReport } from '@/lib/moderation';
import { useRealtimeChannelName } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import { useMyCaptainTeamIds } from '@/lib/use-fixtures';

/** Standard bubble: surface for the other captain, brandSoft for mine. */
function MessageBubble({ message, mine }: { message: FixtureMessage; mine: boolean }) {
  // Cyprus time, whatever zone the phone is in.
  const styles = useStyles();
  const time = new Date(message.created_at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: CYPRUS_TIME_ZONE,
  });

  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      <View testID={mine ? 'bubble-mine' : 'bubble-theirs'} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine ? (
          <Text variant="caption" tone="inkMuted">
            {message.sender_team?.name ?? 'Them'}
          </Text>
        ) : null}
        <Text variant="body">{message.message}</Text>
        <Text variant="caption" tone="inkMuted" tabular style={styles.bubbleTime}>
          {time}
        </Text>
      </View>
    </View>
  );
}

export default function FixtureChatScreen() {
  const styles = useStyles();
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const myCaptainTeamIds = useMyCaptainTeamIds();
  const { user } = useAuth();

  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [messages, setMessages] = useState<FixtureMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const channelName = useRealtimeChannelName(`fixture-messages-${fixtureId ?? 'none'}`);

  // Reporting a chat can't point at "the other person" the way blocking a
  // player can — messages are attributed to a team, not a specific captain
  // (see send_fixture_message), so this just logs the fixture + a reason for
  // manual follow-up rather than trying to force a per-person block here.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!fixtureId) return;
    const { data, error: loadError } = await listFixtureMessages(fixtureId);
    if (loadError) setError(loadError.message);
    else setMessages((data ?? []) as unknown as FixtureMessage[]);
  }, [fixtureId]);

  useEffect(() => {
    if (!fixtureId) return;
    getFixture(fixtureId).then(({ data }) => setFixture(data));
    loadMessages();
  }, [fixtureId, loadMessages]);

  // Live for both captains — a fresh row here has no embedded sender_team
  // name (postgres_changes only ever gives the raw table row, no joins), so
  // this reloads the properly-embedded list rather than trying to append
  // the bare payload and show "Them" forever for a message from a team
  // whose name was never fetched.
  useEffect(() => {
    if (!fixtureId) return;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'fixture_messages', filter: `fixture_id=eq.${fixtureId}` },
        () => loadMessages()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, fixtureId, loadMessages]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || !fixtureId || sending) return;

    setSending(true);
    setError(null);
    const { error: sendError } = await sendFixtureMessage(fixtureId, trimmed);
    setSending(false);

    if (sendError) {
      setError(describeLeagueError(sendError));
    } else {
      setInput('');
      loadMessages();
    }
  }

  async function sendChatReport() {
    if (!user || !fixtureId || !reportReason.trim() || reportBusy) return;

    setReportBusy(true);
    setReportError(null);
    const { error: reportSendError } = await submitReport({
      reporterId: user.id,
      context: 'fixture_chat',
      contextId: fixtureId,
      reason: reportReason.trim(),
    });
    setReportBusy(false);

    if (reportSendError) {
      setReportError(reportSendError.message);
    } else {
      setReported(true);
      setReportOpen(false);
      setReportReason('');
    }
  }

  const myTeamId = fixture
    ? myCaptainTeamIds.has(fixture.home_team_id)
      ? fixture.home_team_id
      : fixture.away_team_id
    : null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        {fixture ? (
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text variant="headline" style={styles.flex}>
                {fixture.home_team?.name ?? 'Unknown team'} vs {fixture.away_team?.name ?? 'Unknown team'}
              </Text>
              <IconButton
                icon="flag.fill"
                tone="inkMuted"
                size="small"
                accessibilityLabel="Report this chat"
                onPress={() => setReportOpen((v) => !v)}
              />
            </View>

            {reportOpen ? (
              <View style={styles.reportPanel}>
                <TextField
                  label="Reason for reporting"
                  value={reportReason}
                  onChangeText={setReportReason}
                  placeholder="What's wrong with this chat?"
                  multiline
                />
                {reportError ? (
                  <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
                    {reportError}
                  </Text>
                ) : null}
                <View style={styles.buttonRow}>
                  <Button
                    label="Send report"
                    onPress={sendChatReport}
                    disabled={!reportReason.trim()}
                    loading={reportBusy}
                  />
                  <Button
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setReportOpen(false)}
                    disabled={reportBusy}
                  />
                </View>
              </View>
            ) : reported ? (
              <Text variant="caption" tone="inkMuted">
                Report submitted — thanks.
              </Text>
            ) : null}
          </View>
        ) : null}

        <ScrollView contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled">
          {!messages ? (
            <View testID="chat-skeleton" style={styles.skeleton}>
              <SkeletonBlock width="60%" height={space.xxl + space.lg} />
              <View style={styles.bubbleRowMine}>
                <SkeletonBlock width="50%" height={space.xxl + space.lg} />
              </View>
            </View>
          ) : null}
          {messages && messages.length === 0 ? (
            <EmptyState icon="bubble.left.fill" message="No messages yet — say hello." />
          ) : null}
          {messages?.map((message) => (
            <MessageBubble key={message.id} message={message} mine={message.sender_team_id === myTeamId} />
          ))}
        </ScrollView>

        {error ? (
          <View style={styles.errorRow}>
            <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <AuthField
            value={input}
            onChangeText={setInput}
            placeholder="Message the other captain…"
            accessibilityLabel="Message"
            style={styles.input}
            onSubmitEditing={send}
            returnKeyType="send"
            multiline
          />
          <Button label="Send" onPress={send} disabled={!input.trim()} loading={sending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: space.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  reportPanel: { gap: space.sm },
  buttonRow: { flexDirection: 'row', gap: space.sm },
  messages: { padding: space.lg, gap: space.sm, flexGrow: 1, justifyContent: 'flex-end' },
  skeleton: { gap: space.sm },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { flexDirection: 'row', justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 2,
  },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border },
  bubbleMine: { backgroundColor: colors.brandSoft },
  bubbleTime: { alignSelf: 'flex-end' },
  errorRow: { paddingHorizontal: space.lg, paddingBottom: space.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, maxHeight: 100 },
}));
