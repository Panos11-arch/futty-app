// Standings (SofaScore 15): "Standings appearance" Short | Full | Form, one
// table per season table (or division), computed on the server
// (get_competition_standings: points, goal difference, goals scored,
// head-to-head, team name). A coloured line marks a row's zone (promotion,
// Division 1 or 2, relegation) with a legend, and an expandable "Rules" shows
// the server's tiebreaker text. My own teams' rows sit on greenSoft.
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { TeamLink } from '@/components/competition/team-link';
import { WaitingPool } from '@/components/match/league-sections';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormBadge } from '@/components/ui/form-badge';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space, type ColorName } from '@/constants/futty-theme';
import { standingsColumns, type StandingRow, type StandingsView, type StandingZone } from '@/lib/match/competition-api';
import { spokenResult } from '@/lib/match/power-ranking-api';
import type { useCompetitionStandings } from '@/lib/match/use-competition';
import { makeStyles, useTheme } from '@/lib/theme';

export const ZONE_LOOK: Record<Exclude<StandingZone, null>, { label: string; colour: ColorName }> = {
  promotion: { label: 'Promotion', colour: 'positive' },
  division_1: { label: 'Division 1', colour: 'positive' },
  division_2: { label: 'Division 2', colour: 'info' },
  relegation: { label: 'Relegation', colour: 'danger' },
};

const VIEWS: { value: StandingsView; label: string; testID: string }[] = [
  { value: 'short', label: 'Short', testID: 'standings-view-short' },
  { value: 'full', label: 'Full', testID: 'standings-view-full' },
  { value: 'form', label: 'Form', testID: 'standings-view-form' },
];

function rowLabel(r: StandingRow, view: StandingsView): string {
  const cols = standingsColumns(view).map((c) => `${c.spoken} ${c.value(r)}`);
  const form = view === 'form' && r.form.length > 0 ? [`form ${r.form.map(spokenResult).join(', ')}`] : [];
  const zone = r.zone ? [ZONE_LOOK[r.zone].label] : [];
  return [`${r.pos}`, r.teamName, ...cols, ...form, ...zone].join(', ');
}

function Table({ name, rows, view, myTeamIds, showName }: { name: string; rows: StandingRow[]; view: StandingsView; myTeamIds: Set<string>; showName: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const columns = standingsColumns(view);
  const zones = [...new Set(rows.map((r) => r.zone).filter((z): z is Exclude<StandingZone, null> => !!z))];
  return (
    <Card testID="standings-table" padded={false}>
      {showName ? (
        <Text variant="headline" style={styles.tableName}>
          {name}
        </Text>
      ) : null}
      <View style={styles.headRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text variant="caption" tone="inkMuted" style={styles.pos}>
          #
        </Text>
        <Text variant="caption" tone="inkMuted" style={styles.team}>
          Team
        </Text>
        {view === 'form' ? (
          <Text variant="caption" tone="inkMuted" style={styles.formHead}>
            Form
          </Text>
        ) : null}
        {columns.map((c) => (
          <Text key={c.label} variant="caption" tone="inkMuted" style={styles.stat}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.length === 0 ? (
        <Text variant="callout" tone="inkMuted" style={styles.tableName}>
          No teams yet
        </Text>
      ) : null}
      {rows.map((r) => {
        const mine = myTeamIds.has(r.teamId);
        return (
          <View
            key={r.teamId}
            testID={mine ? 'standings-row-mine' : 'standings-row'}
            accessible
            accessibilityLabel={rowLabel(r, view)}
            style={[styles.row, mine && styles.mine]}>
            <View style={[styles.zone, r.zone ? { backgroundColor: colors[ZONE_LOOK[r.zone].colour] } : null]} />
            <Text variant="callout" tabular style={styles.pos}>
              {String(r.pos)}
            </Text>
            <View style={styles.team}>
              <TeamLink teamId={r.teamId} name={r.teamName} />
            </View>
            {view === 'form' ? (
              <View style={styles.form}>
                {r.form.map((f, i) => (
                  <FormBadge key={i} result={f} label={f} accessibilityLabel={spokenResult(f)} />
                ))}
              </View>
            ) : null}
            {columns.map((c) => (
              <Text key={c.label} variant="callout" tabular style={[styles.stat, c.label === 'Pts' && styles.pts]}>
                {c.value(r)}
              </Text>
            ))}
          </View>
        );
      })}
      {zones.length > 0 ? (
        <View style={styles.legend}>
          {zones.map((z) => (
            <View key={z} style={styles.legendItem} testID={`standings-zone-${z}`}>
              <View style={[styles.legendSwatch, { backgroundColor: colors[ZONE_LOOK[z].colour] }]} />
              <Text variant="caption" tone="inkMuted">
                {ZONE_LOOK[z].label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function Rules({ text }: { text: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <Card padded={false}>
      <Pressable
        testID="standings-rules"
        accessibilityRole="button"
        accessibilityLabel="Rules"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.rulesHead}>
        <Text variant="headline" style={styles.flex}>
          Rules
        </Text>
        <View style={open ? styles.flip : undefined}>
          <IconSymbol name="chevron.down" size={ICON.small} color={colors.ink} />
        </View>
      </Pressable>
      {open ? (
        <Text variant="callout" tone="inkMuted" style={styles.rulesText} testID="standings-rules-text">
          {text}
        </Text>
      ) : null}
    </Card>
  );
}

export function StandingsTab({
  standings,
  myTeamIds,
  waitingPoolHubId,
  onSeeMatches,
}: {
  /** The page loads the standings once (By team and the team filter use its teams too). */
  standings: ReturnType<typeof useCompetitionStandings>;
  myTeamIds: Set<string>;
  /** A city league in divisions: its waiting pool under the tables. */
  waitingPoolHubId: string | null;
  onSeeMatches: () => void;
}) {
  const styles = useStyles();
  const [view, setView] = useState<StandingsView>('short');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await standings.reload();
    setRefreshing(false);
  };

  return (
    <ScrollView
      testID="competition-standings"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <SegmentedControl options={VIEWS} value={view} onChange={setView} accessibilityLabel="Standings appearance" />
      {standings.status === 'loading' ? (
        <View testID="competition-standings-skeleton" style={styles.content}>
          <SkeletonBlock width="100%" height={240} />
        </View>
      ) : null}
      {standings.status === 'error' ? (
        <Banner tone="danger" message="Couldn’t load the standings." action={{ label: 'Try again', onPress: standings.reload }} />
      ) : null}
      {standings.status === 'ready' && standings.standings.tables.length === 0 ? (
        <EmptyState icon="trophy.fill" message="No standings yet" action={{ label: 'See matches', onPress: onSeeMatches }} />
      ) : null}
      {standings.status === 'ready'
        ? standings.standings.tables.map((t) => (
            <Table key={t.id} name={t.name} rows={t.rows} view={view} myTeamIds={myTeamIds} showName={standings.standings.tables.length > 1} />
          ))
        : null}
      {standings.status === 'ready' && standings.standings.tables.length > 0 ? <Rules text={standings.standings.rules} /> : null}
      {waitingPoolHubId ? <WaitingPool hubId={waitingPoolHubId} /> : null}
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  content: { gap: space.lg, padding: space.lg, paddingBottom: space.xxl },
  flex: { flex: 1 },
  tableName: { paddingHorizontal: space.lg, paddingTop: space.md },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingRight: space.md,
    minHeight: MIN_TOUCH,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
  mine: { backgroundColor: colors.brandSoft },
  zone: { width: space.xs, alignSelf: 'stretch', marginRight: space.sm },
  pos: { minWidth: space.lg + space.xs },
  team: { flex: 1 },
  form: { flexDirection: 'row', gap: space.xs / 2 },
  formHead: { minWidth: space.xxl * 2 },
  stat: { minWidth: space.xl + space.xs, textAlign: 'right' },
  pts: { fontFamily: type.title.fontFamily },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, padding: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  legendSwatch: { width: space.md, height: space.xs, borderRadius: radius.pill },
  flip: { transform: [{ rotate: '180deg' }] },
  rulesHead: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH, paddingHorizontal: space.lg },
  rulesText: { paddingHorizontal: space.lg, paddingBottom: space.md },
}));
