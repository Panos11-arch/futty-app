// Matches (SofaScore 11, 13, 14): chips By date | By round | By team, rows
// grouped under a day or "Matchday n" ("Not scheduled" last). A row: date
// and status (FT, FF, Cancelled or the kickoff time), both teams, the score, and,
// on my own team's fixture, a message button to the other captain. That
// button shows only when the chat would open (no block either way, no
// adult-minor pair: league_captain_contacts.can_message). No bells (decided
// by Panos, 26 November), no By group or penalties (S10A).
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, View } from 'react-native';

import { AdBanner } from '@/components/ads/ad-banner';
import { DropdownButton } from '@/components/competition/dropdown-button';
import { OptionSheet } from '@/components/competition/option-sheet';
import { TeamLink } from '@/components/competition/team-link';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import {
  canMessageFrom,
  groupMatchesByDate,
  groupMatchesByRound,
  matchDateLabel,
  matchStatusLabel,
  roundLabel,
  roundsOf,
  type CompetitionMatch,
} from '@/lib/match/competition-api';
import { useCaptainContacts, useCompetitionMatches } from '@/lib/match/use-competition';
import { chatHref, describeMessageError, openCaptainConversation, type CaptainContact } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';

type Mode = 'date' | 'round' | 'team';

const MODES: { value: Mode; label: string }[] = [
  { value: 'date', label: 'By date' },
  { value: 'round', label: 'By round' },
  { value: 'team', label: 'By team' },
];

export type SeasonTeam = { id: string; name: string };

const scoreText = (n: number | null) => (n == null ? '' : String(n));

function MatchRow({
  match,
  chat,
  onMessage,
  first,
}: {
  match: CompetitionMatch;
  chat: { myTeamId: string; otherTeamId: string } | null;
  onMessage: (chat: { myTeamId: string; otherTeamId: string }) => void;
  first: boolean;
}) {
  const styles = useStyles();
  const homeWon = match.home_score != null && match.away_score != null && match.home_score > match.away_score;
  const awayWon = match.home_score != null && match.away_score != null && match.away_score > match.home_score;
  const open = match.match_id ? () => router.push({ pathname: '/match/[id]', params: { id: match.match_id! } }) : undefined;
  const label = [
    matchDateLabel(match),
    matchStatusLabel(match),
    `${match.home_team_name} ${scoreText(match.home_score)}`,
    `${match.away_team_name} ${scoreText(match.away_score)}`,
  ]
    .filter((s) => s.trim())
    .join(', ');
  return (
    <View style={[styles.row, !first && styles.divider]}>
      <Pressable
        testID={`competition-match-${match.fixture_id}`}
        accessibilityRole={open ? 'button' : undefined}
        accessibilityLabel={open ? `${label}. Open the match` : label}
        disabled={!open}
        onPress={open}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        <View style={styles.when}>
          <Text variant="caption" tone="inkMuted" tabular>
            {matchDateLabel(match)}
          </Text>
          <Text variant="caption" tone="inkMuted">
            {matchStatusLabel(match)}
          </Text>
        </View>
        <View style={styles.teams}>
          <View style={styles.side}>
            <TeamLink teamId={match.home_team_id} name={match.home_team_name} bold={homeWon} tone={awayWon ? 'inkMuted' : 'ink'} />
            <Text variant="headline" tabular tone={awayWon ? 'inkMuted' : 'ink'}>
              {scoreText(match.home_score)}
            </Text>
          </View>
          <View style={styles.side}>
            <TeamLink teamId={match.away_team_id} name={match.away_team_name} bold={awayWon} tone={homeWon ? 'inkMuted' : 'ink'} />
            <Text variant="headline" tabular tone={homeWon ? 'inkMuted' : 'ink'}>
              {scoreText(match.away_score)}
            </Text>
          </View>
        </View>
      </Pressable>
      {chat ? (
        <IconButton
          icon="bubble.left.fill"
          accessibilityLabel={`Message the captain of ${chat.otherTeamId === match.home_team_id ? match.home_team_name : match.away_team_name}`}
          onPress={() => onMessage(chat)}
          testID={`league-message-captain-${match.fixture_id}`}
        />
      ) : null}
    </View>
  );
}

export function MatchesTab({
  seasonId,
  tableIds,
  teams,
}: {
  seasonId: string;
  /** The season's tables: the captain contacts are per table. */
  tableIds: string[];
  /** The season's teams, for By team. */
  teams: SeasonTeam[];
}) {
  const styles = useStyles();
  const [mode, setMode] = useState<Mode>('date');
  const [round, setRound] = useState<number | null | undefined>(undefined);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [picker, setPicker] = useState<'round' | 'team' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const matches = useCompetitionMatches(seasonId, mode === 'team' ? teamId : null);
  const contacts: CaptainContact[] = useCaptainContacts(tableIds);

  const sections = useMemo(() => {
    const rows = matches.status === 'ready' ? matches.matches : [];
    if (mode === 'round') return groupMatchesByRound(rows, round);
    if (mode === 'team' && !teamId) return [];
    return groupMatchesByDate(rows);
  }, [mode, matches, round, teamId]);
  const rounds = useMemo(() => roundsOf(matches.status === 'ready' ? matches.matches : []), [matches]);

  const pickMode = (m: Mode) => {
    setMode(m);
    if (m === 'round') setPicker('round');
    if (m === 'team') setPicker('team');
  };

  const refresh = async () => {
    setRefreshing(true);
    await matches.reload();
    setRefreshing(false);
  };

  const message = async ({ myTeamId, otherTeamId }: { myTeamId: string; otherTeamId: string }) => {
    setChatError(null);
    const { conversationId, error } = await openCaptainConversation(myTeamId, otherTeamId);
    if (error || !conversationId) {
      setChatError(describeMessageError(error));
      return;
    }
    router.push(chatHref(conversationId));
  };

  const teamName = teams.find((t) => t.id === teamId)?.name;

  const header = (
    <View style={styles.header}>
      <View style={styles.chips}>
        {MODES.map((m) => (
          <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => pickMode(m.value)} testID={`competition-matches-${m.value}`} />
        ))}
      </View>
      {mode === 'round' ? (
        <DropdownButton
          bordered
          label={round === undefined ? 'Select round' : roundLabel(round)}
          accessibilityLabel="Select round"
          onPress={() => setPicker('round')}
          testID="competition-matches-round-picker"
        />
      ) : null}
      {mode === 'team' ? (
        <DropdownButton
          bordered
          label={teamName ?? 'Select team'}
          accessibilityLabel="Select team"
          onPress={() => setPicker('team')}
          testID="competition-matches-team-picker"
        />
      ) : null}
      {chatError ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" testID="competition-matches-chat-error">
          {chatError}
        </Text>
      ) : null}
    </View>
  );

  const firstChatFixture = useMemo(() => {
    for (const s of sections) for (const m of s.data) if (canMessageFrom(m, contacts)) return m.fixture_id;
    return null;
  }, [sections, contacts]);

  return (
    <View style={styles.screen}>
      {matches.status === 'loading' ? (
        <View testID="competition-matches-skeleton" style={styles.content}>
          {header}
          {[0, 1, 2].map((i) => (
            <SkeletonBlock key={i} width="100%" height={72} />
          ))}
        </View>
      ) : matches.status === 'error' ? (
        <View style={styles.content}>
          {header}
          <Banner tone="danger" message="Couldn’t load the matches." action={{ label: 'Try again', onPress: matches.reload }} />
        </View>
      ) : (
        <SectionList
          testID="competition-matches"
          sections={sections}
          keyExtractor={(m) => m.fixture_id}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={header}
          ListEmptyComponent={
            mode === 'team' && !teamId ? null : (
              <EmptyState icon="soccerball" message="No matches yet" action={{ label: 'My fixtures', onPress: () => router.push('/upcoming-fixtures') }} />
            )
          }
          renderSectionHeader={({ section }) => (
            <Text variant="callout" tone="inkMuted" style={styles.sectionTitle} accessibilityRole="header">
              {section.title}
            </Text>
          )}
          renderItem={({ item, index, section }) => {
            const chat = canMessageFrom(item, contacts);
            return (
              <View
                style={[styles.card, index === 0 && styles.cardFirst, index === section.data.length - 1 && styles.cardLast]}
                testID={chat && item.fixture_id === firstChatFixture ? 'league-message-captain' : undefined}>
                <MatchRow match={item} chat={chat} onMessage={message} first={index === 0} />
              </View>
            );
          }}
          ListFooterComponent={
            <View style={styles.footer}>
              <Button label="My fixtures" variant="plain" onPress={() => router.push('/upcoming-fixtures')} testID="league-page-fixtures" />
              {/* G4a: the banner ad under the matches (none on Premium Plus). */}
              {sections.length > 0 ? <AdBanner testID="competition-matches-ad" /> : null}
            </View>
          }
        />
      )}
      <OptionSheet
        visible={picker === 'round'}
        onClose={() => setPicker(null)}
        title="Round"
        options={rounds.map((r) => ({ key: String(r), label: roundLabel(r) }))}
        selectedKey={round === undefined ? null : String(round)}
        onSelect={(key) => setRound(key === 'null' ? null : Number(key))}
        testID="competition-rounds"
      />
      <OptionSheet
        visible={picker === 'team'}
        onClose={() => setPicker(null)}
        title="Team"
        options={teams.map((t) => ({ key: t.id, label: t.name }))}
        selectedKey={teamId}
        onSelect={setTeamId}
        search
        testID="competition-teams"
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl, gap: 0 },
  header: { gap: space.md, paddingBottom: space.md },
  footer: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sectionTitle: { paddingTop: space.md, paddingBottom: space.sm },
  card: { backgroundColor: colors.surface, borderLeftWidth: hairline, borderRightWidth: hairline, borderColor: colors.border },
  cardFirst: { borderTopWidth: hairline, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  cardLast: { borderBottomWidth: hairline, borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: space.sm },
  divider: { borderTopWidth: hairline, borderTopColor: colors.border },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  pressed: { opacity: 0.7 },
  when: { width: space.xxl * 2, gap: space.xs },
  teams: { flex: 1 },
  side: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
}));
