import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { ChatHeader } from '@/components/messages/chat-header';
import { ChatView } from '@/components/messages/chat-view';
import { ReportSheet } from '@/components/messages/report-sheet';
import { useAuth } from '@/lib/auth';
import {
  getFixture,
  listFixtureMessages,
  sendFixtureMessage,
  type Fixture,
  type FixtureMessage,
} from '@/lib/fixtures';
import { describeLeagueError } from '@/lib/league-errors';
import type { ChatMessage } from '@/lib/messages';
import { submitReport } from '@/lib/moderation';
import { useRealtimeChannelName } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import { useMyCaptainTeamIds } from '@/lib/use-fixtures';

/** A fixture message in the shared chat's shape: messages here are from a
 *  team, not a person, so "mine" is my team's. Newest first. */
export function fixtureChatMessages(messages: FixtureMessage[], myTeamId: string | null): ChatMessage[] {
  return [...messages]
    .map((m) => ({
      id: m.id,
      sender_id: m.sender_team_id,
      sender_name: m.sender_team?.name ?? '',
      mine: !!myTeamId && m.sender_team_id === myTeamId,
      body: m.message,
      client_id: null,
      created_at: m.created_at,
    }))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/**
 * The fixture chat between the two captains of a league fixture (S13:
 * restyled with the messages components). Free text is refused when either
 * captain is a minor (A6); the server says so and the text stays.
 */
export default function FixtureChatScreen() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const myCaptainTeamIds = useMyCaptainTeamIds();
  const { user } = useAuth();

  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [messages, setMessages] = useState<FixtureMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const channelName = useRealtimeChannelName(`fixture-messages-${fixtureId ?? 'none'}`);

  const loadMessages = useCallback(async () => {
    if (!fixtureId) return;
    const { data, error } = await listFixtureMessages(fixtureId);
    if (error) setLoadError(error.message);
    else {
      setLoadError(null);
      setMessages((data ?? []) as unknown as FixtureMessage[]);
    }
  }, [fixtureId]);

  useEffect(() => {
    if (!fixtureId) return;
    getFixture(fixtureId).then(({ data }) => setFixture(data));
    loadMessages();
  }, [fixtureId, loadMessages]);

  // Live for both captains. A realtime row has no team name (no joins), so
  // this reloads the list rather than append it.
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

  async function send(body: string) {
    if (!fixtureId) return false;
    setSendError(null);
    const { error } = await sendFixtureMessage(fixtureId, body);
    if (error) {
      setSendError(describeLeagueError(error));
      return false;
    }
    loadMessages();
    return true;
  }

  async function sendReport(reason: string): Promise<string | null> {
    if (!user || !fixtureId) return null;
    const { error } = await submitReport({ reporterId: user.id, context: 'fixture_chat', contextId: fixtureId, reason });
    return error ? 'Could not send. Try again.' : null;
  }

  const myTeamId = fixture
    ? myCaptainTeamIds.has(fixture.home_team_id)
      ? fixture.home_team_id
      : fixture.away_team_id
    : null;
  const title = fixture ? `${fixture.home_team?.name ?? 'Unknown team'} vs ${fixture.away_team?.name ?? 'Unknown team'}` : '';

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ChatView
        header={
          <ChatHeader
            title={title}
            onBack={() => (router.canGoBack() ? router.back() : router.replace('/upcoming-fixtures'))}
            onMore={fixture ? () => setReportOpen(true) : undefined}
          />
        }
        messages={messages ? fixtureChatMessages(messages, myTeamId) : null}
        loadError={loadError}
        onRetryLoad={loadMessages}
        onSend={send}
        sendError={sendError}
        emptyLine="No messages yet. Say hello."
        keepOnFailure
      />
      <ReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} onSend={sendReport} />
    </>
  );
}
