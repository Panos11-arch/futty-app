import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
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

function MessageBubble({ message, mine }: { message: FixtureMessage; mine: boolean }) {
  const time = new Date(message.created_at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!mine ? <ThemedText style={styles.bubbleSender}>{message.sender_team?.name ?? 'Them'}</ThemedText> : null}
        <ThemedText style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.message}</ThemedText>
        <ThemedText style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{time}</ThemedText>
      </View>
    </View>
  );
}

export default function FixtureChatScreen() {
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
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        {fixture ? (
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <ThemedText type="defaultSemiBold">
                {fixture.home_team?.name ?? 'Unknown team'} vs {fixture.away_team?.name ?? 'Unknown team'}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Report this chat"
                onPress={() => setReportOpen((v) => !v)}
                hitSlop={8}>
                <IconSymbol name="flag.fill" size={16} color={FuttyColors.stone400} />
              </Pressable>
            </View>

            {reportOpen ? (
              <View style={styles.reportPanel}>
                <AuthField
                  value={reportReason}
                  onChangeText={setReportReason}
                  placeholder="What's wrong with this chat?"
                  multiline
                />
                {reportError ? <AuthError>{reportError}</AuthError> : null}
                <View style={styles.reportRow}>
                  <View style={styles.reportButton}>
                    <AuthButton
                      label="Submit report"
                      onPress={sendChatReport}
                      disabled={!reportReason.trim()}
                      busy={reportBusy}
                    />
                  </View>
                  <View style={styles.reportButton}>
                    <AuthButton
                      label="Cancel"
                      variant="secondary"
                      onPress={() => setReportOpen(false)}
                      disabled={reportBusy}
                    />
                  </View>
                </View>
              </View>
            ) : reported ? (
              <IconLabel icon="exclamationmark.triangle.fill" style={styles.reportedNote} iconColor={FuttyColors.stone500} iconSize={11}>
                Report submitted — thanks.
              </IconLabel>
            ) : null}
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled">
          {!messages ? <ActivityIndicator style={styles.loading} /> : null}
          {messages && messages.length === 0 ? (
            <IconLabel
              icon="bubble.left.fill"
              style={styles.emptyNote}
              iconColor={FuttyColors.stone400}
              iconSize={12}
              containerStyle={styles.emptyRow}>
              No messages yet — say hello.
            </IconLabel>
          ) : null}
          {messages?.map((message) => (
            <MessageBubble key={message.id} message={message} mine={message.sender_team_id === myTeamId} />
          ))}
        </ScrollView>

        {error ? (
          <View style={styles.errorRow}>
            <AuthError>{error}</AuthError>
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <AuthField
            value={input}
            onChangeText={setInput}
            placeholder="Message the other captain…"
            style={styles.input}
            onSubmitEditing={send}
            returnKeyType="send"
            multiline
          />
          <AuthButton label="Send" onPress={send} disabled={!input.trim()} busy={sending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: FuttyColors.stone50,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: FuttyColors.stone200,
    backgroundColor: FuttyColors.white,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reportPanel: {
    gap: 8,
  },
  reportRow: {
    flexDirection: 'row',
    gap: 8,
  },
  reportButton: {
    flex: 1,
  },
  reportedNote: {
    fontSize: 11,
    opacity: 0.7,
  },
  messages: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  loading: {
    marginTop: 24,
  },
  emptyRow: {
    justifyContent: 'center',
    marginTop: 24,
  },
  emptyNote: {
    fontSize: 12,
    opacity: 0.6,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 2,
  },
  bubbleTheirs: {
    backgroundColor: FuttyColors.white,
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    borderBottomLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor: FuttyColors.emerald950,
    borderBottomRightRadius: 4,
  },
  bubbleSender: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 10,
    color: FuttyColors.emerald700,
  },
  bubbleText: {
    fontFamily: FuttyFonts.sans,
    fontSize: 14,
    color: FuttyColors.stone700,
  },
  bubbleTextMine: {
    color: FuttyColors.white,
  },
  bubbleTime: {
    fontFamily: FuttyFonts.sans,
    fontSize: 9,
    color: FuttyColors.stone400,
    alignSelf: 'flex-end',
  },
  bubbleTimeMine: {
    color: FuttyColors.emerald200,
  },
  errorRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: FuttyColors.stone200,
    backgroundColor: FuttyColors.white,
  },
  input: {
    flex: 1,
    maxHeight: 100,
  },
});
