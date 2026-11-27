// S10A admin: run one tournament (match-record.md 1o). One main action for
// its stage: Open sign-up, then Draw groups (or Set groups), then Close once
// the final is played. Groups that only the organiser's draw can separate
// come first, then matches that need a result, then every match by round:
// tap one to set its kick-off or enter, decide or correct its result. The
// server checks every call (is_app_admin) and every rule.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminDrawSheet } from '@/components/competition/tournament/admin-draw-sheet';
import { AdminFixtureSheet } from '@/components/competition/tournament/admin-fixture-sheet';
import { AdminGroupsSheet } from '@/components/competition/tournament/admin-groups-sheet';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import {
  adminCloseTournament,
  adminDrawGroups,
  adminOpenRegistration,
  fixtureDateLabel,
  fixtureStatusLabel,
  groupFixturesByRound,
  shootoutText,
  tournamentDates,
  tournamentStatusLabel,
  type GroupStandings,
  type Tournament,
  type TournamentFixture,
} from '@/lib/match/tournament-api';
import { describeTournamentError } from '@/lib/match/tournament-errors';
import { useTournament, useTournamentMatches, useTournamentStandings } from '@/lib/match/use-tournament';
import { makeStyles } from '@/lib/theme';

type MainAction = { label: string; testID: string; run: () => Promise<{ error: { message: string } | null }> };

/** The stage's one main action, if any. */
export function mainAction(t: Tournament, fixtures: TournamentFixture[]): MainAction | null {
  if (t.status === 'coming_soon') return { label: 'Open sign-up', testID: 'admin-open-registration', run: () => adminOpenRegistration(t.id) };
  if (t.status === 'registration') return { label: 'Draw groups', testID: 'admin-draw-groups', run: () => adminDrawGroups(t.id) };
  const final = fixtures.find((f) => f.stage === 'final');
  if (t.status === 'knockout' && final?.status === 'completed') {
    return { label: 'Close', testID: 'admin-close', run: () => adminCloseTournament(t.id) };
  }
  return null;
}

/** Played (kick-off passed), both teams known, no result yet. */
export function needsResult(f: TournamentFixture, now: Date): boolean {
  return f.status === 'scheduled' && !!f.homeTeamId && !!f.awayTeamId && !!f.kickoffAt && new Date(f.kickoffAt) <= now;
}

function fixtureSubtitle(f: TournamentFixture): string {
  const score = f.homeScore != null && f.awayScore != null ? `${f.homeScore}–${f.awayScore}` : null;
  return [fixtureDateLabel(f), fixtureStatusLabel(f), score, shootoutText(f), f.decidedBy === 'organiser' ? 'Organiser' : null]
    .filter(Boolean)
    .join(' · ') || 'No kick-off yet';
}

export default function AdminTournamentScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tournament = useTournament(id);
  const matches = useTournamentMatches(id, null);
  const standings = useTournamentStandings(id);
  const [fixture, setFixture] = useState<TournamentFixture | null>(null);
  const [settingGroups, setSettingGroups] = useState(false);
  const [drawGroup, setDrawGroup] = useState<GroupStandings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const t = tournament.status === 'ready' ? tournament.tournament : null;
  const fixtures = useMemo(() => (matches.status === 'ready' ? matches.matches : []), [matches]);
  const draws = standings.status === 'ready' ? standings.standings.groups.filter((g) => g.needsDraw) : [];
  const sections = useMemo(() => {
    const now = new Date();
    const pending = fixtures.filter((f) => needsResult(f, now));
    return [
      ...(pending.length > 0 ? [{ key: 'pending', title: 'Needs a result', data: pending }] : []),
      ...groupFixturesByRound(fixtures),
    ];
  }, [fixtures]);

  const reloadAll = async () => {
    await Promise.all([tournament.reload(), matches.reload(), standings.reload()]);
  };
  const refresh = async () => {
    setRefreshing(true);
    await reloadAll();
    setRefreshing(false);
  };

  async function runMain(action: MainAction) {
    setBusy(true);
    setError(null);
    const { error: callError } = await action.run();
    setBusy(false);
    if (callError) {
      haptic.error();
      setError(describeTournamentError(callError));
      return;
    }
    haptic.success();
    void reloadAll();
  }

  if (!t) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']} testID="admin-tournament">
        <Stack.Screen options={{ title: 'Tournament' }} />
        <View style={styles.content}>
          {tournament.status === 'loading' ? (
            <Card testID="admin-tournament-skeleton">
              <SkeletonText lines={4} />
            </Card>
          ) : (
            <Banner tone="danger" message="Couldn’t load this tournament." action={{ label: 'Try again', onPress: tournament.reload }} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const main = mainAction(t, fixtures);

  const header = (
    <View style={styles.header}>
      <Card testID="admin-tournament-summary">
        <Text variant="title">{t.name}</Text>
        <Text variant="callout" tone="inkMuted">
          {`${tournamentStatusLabel(t.status)} · ${tournamentDates(t)} · ${t.teamsCount} of ${t.maxTeams} teams`}
        </Text>
      </Card>
      {main ? <Button label={main.label} onPress={() => void runMain(main)} loading={busy} fullWidth testID={main.testID} /> : null}
      {t.status === 'registration' ? (
        <Button label="Set groups" variant="secondary" onPress={() => setSettingGroups(true)} fullWidth testID="admin-set-groups" />
      ) : null}
      <Button
        label="Edit details"
        variant="plain"
        onPress={() => router.push({ pathname: '/admin/tournaments/[id]/edit', params: { id: t.id } })}
        testID="admin-edit-details"
      />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" testID="admin-tournament-error">
          {error}
        </Text>
      ) : null}
      {draws.map((g) => (
        <Card key={g.group} padded={false}>
          <ListRow
            testID={`admin-needs-draw-${g.group}`}
            title={`Group ${g.group}`}
            subtitle="Needs the organiser’s draw"
            chevron
            onPress={() => setDrawGroup(g)}
          />
        </Card>
      ))}
      {matches.status === 'error' ? (
        <Banner tone="danger" message="Couldn’t load the matches." action={{ label: 'Try again', onPress: matches.reload }} />
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']} testID="admin-tournament">
      <Stack.Screen options={{ title: t.name }} />
      <SectionList
        testID="admin-fixtures"
        sections={sections}
        keyExtractor={(f, i) => `${f.fixtureId}-${i}`}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <Text variant="callout" tone="inkMuted" style={styles.sectionTitle} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        renderItem={({ item, index, section }) => (
          <View style={[styles.card, index === 0 && styles.cardFirst, index === section.data.length - 1 && styles.cardLast]}>
            <ListRow
              testID={`admin-fixture-${section.key === 'pending' ? 'pending-' : ''}${item.fixtureId}`}
              title={`${item.homeTeamName ?? 'To be decided'} v ${item.awayTeamName ?? 'To be decided'}`}
              subtitle={`${item.slot} · ${fixtureSubtitle(item)}`}
              chevron
              onPress={() => setFixture(item)}
            />
          </View>
        )}
      />
      <AdminFixtureSheet fixture={fixture} onClose={() => setFixture(null)} onDone={() => void reloadAll()} />
      <AdminGroupsSheet
        visible={settingGroups}
        tournamentId={t.id}
        teams={t.teams ?? []}
        onClose={() => setSettingGroups(false)}
        onDone={() => void reloadAll()}
      />
      <AdminDrawSheet tournamentId={t.id} group={drawGroup} onClose={() => setDrawGroup(null)} onDone={() => void reloadAll()} />
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { gap: space.md, paddingBottom: space.md },
  sectionTitle: { paddingTop: space.md, paddingBottom: space.sm },
  card: { backgroundColor: colors.surface, borderLeftWidth: hairline, borderRightWidth: hairline, borderColor: colors.border },
  cardFirst: { borderTopWidth: hairline, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  cardLast: { borderBottomWidth: hairline, borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
}));
