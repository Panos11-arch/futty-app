// S10A Matches (SofaScore 11-14): chips By date | By group | By round |
// By team. Rows show AP with the shootout score after penalties. No bells.
import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, View } from 'react-native';

import { AdBanner } from '@/components/ads/ad-banner';
import { DropdownButton } from '@/components/competition/dropdown-button';
import { OptionSheet } from '@/components/competition/option-sheet';
import { FixtureRow } from '@/components/competition/tournament/fixture-row';
import { Banner } from '@/components/ui/banner';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import {
  groupFixturesByDate,
  groupFixturesByGroup,
  groupFixturesByRound,
  type TournamentTeam,
} from '@/lib/match/tournament-api';
import { useTournamentMatches } from '@/lib/match/use-tournament';
import { makeStyles } from '@/lib/theme';

type Mode = 'date' | 'group' | 'round' | 'team';

const MODES: { value: Mode; label: string }[] = [
  { value: 'date', label: 'By date' },
  { value: 'group', label: 'By group' },
  { value: 'round', label: 'By round' },
  { value: 'team', label: 'By team' },
];

export function TournamentMatchesTab({
  tournamentId,
  teams,
  onSeeStandings,
}: {
  tournamentId: string;
  /** The registered teams, for By team. */
  teams: TournamentTeam[];
  onSeeStandings: () => void;
}) {
  const styles = useStyles();
  const [mode, setMode] = useState<Mode>('date');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const matches = useTournamentMatches(tournamentId, mode === 'team' ? teamId : null);

  const sections = useMemo(() => {
    const rows = matches.status === 'ready' ? matches.matches : [];
    if (mode === 'group') return groupFixturesByGroup(rows);
    if (mode === 'round') return groupFixturesByRound(rows);
    if (mode === 'team' && !teamId) return [];
    return groupFixturesByDate(rows);
  }, [mode, matches, teamId]);

  const pickMode = (m: Mode) => {
    setMode(m);
    if (m === 'team') setPicking(true);
  };

  const refresh = async () => {
    setRefreshing(true);
    await matches.reload();
    setRefreshing(false);
  };

  const teamName = teams.find((t) => t.teamId === teamId)?.teamName;

  const header = (
    <View style={styles.header}>
      <View style={styles.chips}>
        {MODES.map((m) => (
          <Chip
            key={m.value}
            label={m.label}
            selected={mode === m.value}
            onPress={() => pickMode(m.value)}
            testID={`tournament-matches-${m.value}`}
          />
        ))}
      </View>
      {mode === 'team' ? (
        <DropdownButton
          bordered
          label={teamName ?? 'Select team'}
          accessibilityLabel="Select team"
          onPress={() => setPicking(true)}
          testID="tournament-matches-team-picker"
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      {matches.status === 'loading' ? (
        <View testID="tournament-matches-skeleton" style={styles.content}>
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
          testID="tournament-matches"
          sections={sections}
          keyExtractor={(f) => f.fixtureId}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={header}
          ListEmptyComponent={
            mode === 'team' && !teamId ? null : (
              <EmptyState icon="soccerball" message="No matches yet" action={{ label: 'See standings', onPress: onSeeStandings }} />
            )
          }
          renderSectionHeader={({ section }) => (
            <Text variant="callout" tone="inkMuted" style={styles.sectionTitle} accessibilityRole="header">
              {section.title}
            </Text>
          )}
          renderItem={({ item, index, section }) => (
            <View style={[styles.card, index === 0 && styles.cardFirst, index === section.data.length - 1 && styles.cardLast]}>
              <FixtureRow fixture={item} first={index === 0} />
            </View>
          )}
          ListFooterComponent={sections.length > 0 ? <AdBanner testID="tournament-matches-ad" /> : null}
        />
      )}
      <OptionSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Team"
        options={teams.map((t) => ({ key: t.teamId, label: t.teamName }))}
        selectedKey={teamId}
        onSelect={setTeamId}
        search
        testID="tournament-teams"
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { gap: space.md, paddingBottom: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sectionTitle: { paddingTop: space.md, paddingBottom: space.sm },
  card: { backgroundColor: colors.surface, borderLeftWidth: hairline, borderRightWidth: hairline, borderColor: colors.border },
  cardFirst: { borderTopWidth: hairline, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  cardLast: { borderBottomWidth: hairline, borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
}));
