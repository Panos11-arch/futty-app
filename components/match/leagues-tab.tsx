import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { CompetitionRow, DirectoryLabel } from '@/components/match/competition-row';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import {
  competitionBadge,
  groupBadge,
  type CompetitionEntry,
  type CompetitionGroup,
  type LeagueDirectory,
  type TournamentEntry,
} from '@/lib/match/league-directory';
import { leagueHref, tournamentHref } from '@/lib/match/league-routes';
import { tournamentBadge } from '@/lib/match/tournament-api';
import { makeStyles, useTheme } from '@/lib/theme';

type Item =
  | { type: 'label'; key: string; label: string; collapsible?: boolean }
  | { type: 'group'; key: string; group: CompetitionGroup }
  | { type: 'entry'; key: string; entry: CompetitionEntry; place: 'pinned' | 'child' }
  | { type: 'tournaments'; key: string; label: string; subtitle: string }
  | { type: 'tournament'; key: string; entry: TournamentEntry; place: 'pinned' | 'child' }
  | { type: 'matchmaking'; key: string };

export type LeaguesTabProps = {
  /** null while loading. */
  directory: LeagueDirectory | null;
  error: string | null;
  pinError: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onTogglePin: (entry: CompetitionEntry) => void;
  /** S10A: a tournament's Pin. */
  onToggleTournamentPin: (entry: TournamentEntry) => void;
};

/** The Tournaments group's key in `expanded`. */
const TOURNAMENTS = 'tournaments';

/** The LEAGUES tab (image 12, sofascore-06): Pinned, then the Cyprus Open
 *  League and every city, each opening to its five formats, then the
 *  Tournaments (S10A). EFEK joins once there's data for it. */
export function LeaguesTab({
  directory,
  error,
  pinError,
  refreshing,
  onRefresh,
  onRetry,
  onTogglePin,
  onToggleTournamentPin,
}: LeaguesTabProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pinnedOpen, setPinnedOpen] = useState(true);

  const items = useMemo<Item[]>(() => {
    if (!directory) return [];
    const out: Item[] = [];
    const pinnedCount = directory.pinned.length + directory.pinnedTournaments.length;
    if (pinnedCount > 0) {
      out.push({ type: 'label', key: 'label-pinned', label: `Pinned (${pinnedCount})`, collapsible: true });
      if (pinnedOpen) {
        for (const entry of directory.pinned) out.push({ type: 'entry', key: `pinned-${entry.key}`, entry, place: 'pinned' });
        for (const entry of directory.pinnedTournaments) {
          out.push({ type: 'tournament', key: `pinned-${entry.key}`, entry, place: 'pinned' });
        }
      }
    }
    out.push({ type: 'label', key: 'label-all', label: 'All' });
    for (const group of [directory.open, ...directory.cities]) {
      out.push({ type: 'group', key: `group-${group.scope}`, group });
      if (expanded.has(group.scope)) {
        for (const entry of group.entries) out.push({ type: 'entry', key: entry.key, entry, place: 'child' });
      }
    }
    if (directory.tournaments) {
      const { label, subtitle, entries } = directory.tournaments;
      out.push({ type: 'tournaments', key: 'group-tournaments', label, subtitle });
      if (expanded.has(TOURNAMENTS)) {
        for (const entry of entries) out.push({ type: 'tournament', key: entry.key, entry, place: 'child' });
      }
    }
    out.push({ type: 'matchmaking', key: 'matchmaking' });
    return out;
  }, [directory, expanded, pinnedOpen]);

  if (error) {
    return (
      <View style={styles.pad}>
        <Banner tone="danger" message="Could not load leagues." action={{ label: 'Try again', onPress: onRetry }} />
      </View>
    );
  }

  if (!directory) {
    return (
      <View style={styles.pad}>
        <Card testID="leagues-skeleton">
          <SkeletonText lines={6} />
        </Card>
      </View>
    );
  }

  const toggleGroup = (scope: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

  const renderItem = ({ item }: { item: Item }) => {
    switch (item.type) {
      case 'label':
        return item.collapsible ? (
          <DirectoryLabel
            label={item.label}
            expanded={pinnedOpen}
            onPress={() => setPinnedOpen((v) => !v)}
            testID="leagues-pinned-toggle"
          />
        ) : (
          <DirectoryLabel label={item.label} />
        );
      case 'group':
        return (
          <CompetitionRow
            testID={`leagues-group-${item.group.scope}`}
            title={item.group.label}
            subtitle={item.group.subtitle}
            badge={groupBadge(item.group.label)}
            expanded={expanded.has(item.group.scope)}
            onPress={() => toggleGroup(item.group.scope)}
          />
        );
      case 'entry': {
        const { entry } = item;
        const title = item.place === 'pinned' ? entry.name : entry.format;
        const subtitle =
          item.place === 'pinned' ? `${entry.format} · ${entry.stageLabel}` : `${entry.name} · ${entry.stageLabel}`;
        const id = `${item.place}-${entry.scope}-${entry.format}`;
        return (
          <CompetitionRow
            testID={`leagues-row-${id}`}
            title={title}
            subtitle={subtitle}
            badge={item.place === 'pinned' ? competitionBadge(entry.scope, entry.format) : undefined}
            pin={{ pinned: entry.pinned, name: entry.name, onPress: () => onTogglePin(entry), testID: `leagues-pin-${id}` }}
            onPress={() => router.push(leagueHref(entry))}
          />
        );
      }
      case 'tournaments':
        return (
          <CompetitionRow
            testID="leagues-group-tournaments"
            title={item.label}
            subtitle={item.subtitle}
            badge={groupBadge(item.label)}
            expanded={expanded.has(TOURNAMENTS)}
            onPress={() => toggleGroup(TOURNAMENTS)}
          />
        );
      case 'tournament': {
        const { entry } = item;
        const id = `${item.place}-tournament-${entry.tournament.id}`;
        return (
          <CompetitionRow
            testID={`leagues-row-${id}`}
            title={entry.name}
            subtitle={entry.subtitle}
            badge={item.place === 'pinned' ? tournamentBadge(entry.name) : undefined}
            pin={{
              pinned: entry.pinned,
              name: entry.name,
              onPress: () => onToggleTournamentPin(entry),
              testID: `leagues-pin-${id}`,
            }}
            onPress={() => router.push(tournamentHref(entry.tournament))}
          />
        );
      }
      case 'matchmaking':
        return (
          <View style={styles.pad}>
            <Card padded={false}>
              <ListRow
                testID="leagues-matchmaking"
                title="Matchmaking"
                leading={{ icon: 'calendar' }}
                chevron
                onPress={() => router.push('/matchmaking')}
              />
            </Card>
          </View>
        );
    }
  };

  return (
    <FlatList
      testID="leagues-list"
      data={items}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      ListHeaderComponent={
        pinError ? (
          <View style={styles.pad}>
            <Banner tone="danger" message={pinError} />
          </View>
        ) : null
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.inkMuted} />}
      contentContainerStyle={styles.content}
    />
  );
}

const useStyles = makeStyles(() => ({
  pad: { padding: space.lg },
  content: { paddingBottom: space.xxl },
}));
