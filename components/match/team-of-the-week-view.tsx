// Rankings → Team of the Week (images 15 and 27; match-record.md decision
// 1k): the week (‹ 16–22 Nov ›) and what it counts, the kind (General or
// League) and area pickers, the team on a pitch, then the Player of the week.
// Opens on General · the viewer's city, else All Cyprus. A non-Premium viewer
// sees "Get Premium to be eligible". Everything shown is as the server
// picked and placed it.
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { AdBanner } from '@/components/ads/ad-banner';
import { PlayerOfTheWeekCard } from '@/components/match/player-of-the-week-card';
import { TotwPitch } from '@/components/match/totw-pitch';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Sheet } from '@/components/ui/sheet';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import {
  areaOptions,
  cityKey,
  kindLabel,
  pickDefaultTeam,
  scopeCaption,
  weekRangeLabel,
  type TeamOfTheWeek,
} from '@/lib/match/stats-api';
import { useTeamOfTheWeekPlayers, useTeamOfTheWeekWeeks, useTeamsOfTheWeek } from '@/lib/match/use-stats';
import { makeStyles, useTheme } from '@/lib/theme';
import { useProfile } from '@/lib/use-profile';

export type TeamOfTheWeekViewProps = {
  format: string;
  /** A team to open on (a notification or the Home card named it), in this format. */
  initialTeam?: TeamOfTheWeek | null;
  /** The empty state's button. */
  onSeePowerRanking: () => void;
};

type Picker = 'kind' | 'area' | null;

function PickerButton({ label, onPress, testID, accessibilityLabel }: { label: string; onPress: () => void; testID: string; accessibilityLabel: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
      <Text variant="callout" numberOfLines={1}>
        {label}
      </Text>
      <IconSymbol name="chevron.down" size={ICON.small} color={colors.ink} />
    </Pressable>
  );
}

function OptionRow({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}>
      <Text variant="body" style={styles.optionLabel}>
        {label}
      </Text>
      {selected ? <IconSymbol name="checkmark" size={ICON.small} color={colors.ink} /> : null}
    </Pressable>
  );
}

function TeamBody({ team }: { team: TeamOfTheWeek }) {
  const players = useTeamOfTheWeekPlayers(team);
  if (players.status === 'loading') {
    return (
      <View testID="totw-team-skeleton">
        <SkeletonBlock width="100%" height={420} />
      </View>
    );
  }
  if (players.status === 'error') {
    return <Banner tone="danger" message="Couldn’t load this team." action={{ label: 'Try again', onPress: players.reload }} />;
  }
  if (!players.shape) return <EmptyState icon="trophy.fill" message="No team yet" />;
  const potw = players.players.find((p) => p.player_of_the_week) ?? null;
  return (
    <>
      <TotwPitch players={players.players} shape={players.shape} />
      {potw ? <PlayerOfTheWeekCard player={potw} /> : null}
    </>
  );
}

export function TeamOfTheWeekView({ format, initialTeam, onSeePowerRanking }: TeamOfTheWeekViewProps) {
  const styles = useStyles();
  const profile = useProfile();
  const myCity = profile.status === 'ready' ? cityKey(profile.profile.city) : null;
  const notPremium = profile.status === 'ready' && !profile.profile.is_premium;

  const weeks = useTeamOfTheWeekWeeks(format);
  const weekList = useMemo(() => (weeks.status === 'ready' ? weeks.weeks : []), [weeks]);
  const [weekIndex, setWeekIndex] = useState(0);
  useEffect(() => {
    if (!initialTeam) return;
    const i = weekList.indexOf(initialTeam.week_start);
    if (i >= 0) setWeekIndex(i);
  }, [initialTeam, weekList]);
  const week = weekList[weekIndex] ?? null;

  const teams = useTeamsOfTheWeek(week, format);
  const teamList = useMemo(() => (teams.status === 'ready' ? teams.teams : []), [teams]);
  const [chosenId, setChosenId] = useState<string | null>(initialTeam?.id ?? null);
  const team = teamList.find((t) => t.id === chosenId) ?? pickDefaultTeam(teamList, myCity);
  const kinds = (['general', 'league'] as const).filter((k) => teamList.some((t) => t.kind === k));
  const [picker, setPicker] = useState<Picker>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([weeks.reload(), teams.reload()]);
    setRefreshing(false);
  };

  const goToWeek = (i: number) => {
    setWeekIndex(i);
    setChosenId(null);
  };
  const chooseKind = (kind: TeamOfTheWeek['kind']) => {
    const first = kind === 'general' ? pickDefaultTeam(areaOptions(teamList, 'general'), myCity) : areaOptions(teamList, 'league')[0];
    setChosenId(first?.id ?? null);
    setPicker(null);
  };
  const chooseArea = (t: TeamOfTheWeek) => {
    setChosenId(t.id);
    setPicker(null);
  };

  return (
    <ScrollView
      testID="totw-view"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {weeks.status === 'loading' ? (
        <View testID="totw-skeleton" style={styles.skeleton}>
          <SkeletonText lines={2} variant="title" />
          <SkeletonBlock width="100%" height={420} />
        </View>
      ) : null}
      {weeks.status === 'error' ? (
        <Banner tone="danger" message="Couldn’t load the Team of the Week." action={{ label: 'Try again', onPress: weeks.reload }} />
      ) : null}
      {weeks.status === 'ready' && weekList.length === 0 ? (
        <EmptyState icon="trophy.fill" message="No team yet" action={{ label: 'See Power ranking', onPress: onSeePowerRanking }} />
      ) : null}

      {week ? (
        <>
          <View style={styles.weekRow}>
            <IconButton
              icon="chevron.left"
              accessibilityLabel="Previous week"
              onPress={() => goToWeek(weekIndex + 1)}
              disabled={weekIndex >= weekList.length - 1}
              testID="totw-week-prev"
            />
            <View style={styles.weekText}>
              <Text variant="title" tabular testID="totw-week">
                {weekRangeLabel(week)}
              </Text>
              {team ? (
                <Text variant="callout" tone="inkMuted">
                  {scopeCaption(team)}
                </Text>
              ) : null}
            </View>
            <IconButton
              icon="chevron.right"
              accessibilityLabel="Next week"
              onPress={() => goToWeek(weekIndex - 1)}
              disabled={weekIndex === 0}
              testID="totw-week-next"
            />
          </View>

          {teams.status === 'loading' ? (
            <View testID="totw-teams-skeleton">
              <SkeletonBlock width="100%" height={420} />
            </View>
          ) : null}
          {teams.status === 'error' ? (
            <Banner tone="danger" message="Couldn’t load the Team of the Week." action={{ label: 'Try again', onPress: teams.reload }} />
          ) : null}
          {teams.status === 'ready' && team ? (
            <>
              <View style={styles.pickers}>
                <PickerButton
                  testID="totw-kind"
                  label={kindLabel(team.kind)}
                  accessibilityLabel={`Team: ${kindLabel(team.kind)}`}
                  onPress={() => setPicker('kind')}
                />
                <PickerButton
                  testID="totw-area"
                  label={team.area_name}
                  accessibilityLabel={`Area: ${team.area_name}`}
                  onPress={() => setPicker('area')}
                />
              </View>
              <TeamBody key={team.id} team={team} />
            </>
          ) : null}
          {teams.status === 'ready' && !team ? <EmptyState icon="trophy.fill" message="No team yet" /> : null}
        </>
      ) : null}

      {notPremium ? (
        <View testID="totw-premium-banner">
          <Banner
            tone="info"
            message="Get Premium to be eligible"
            action={{ label: 'See plans', onPress: () => router.push('/account/premium') }}
          />
        </View>
      ) : null}

      {/* G4a: the banner ad, once a team shows (none on Premium Plus). */}
      {week && teams.status === 'ready' && team ? <AdBanner testID="rankings-totw-ad" /> : null}

      <Sheet visible={picker === 'kind'} onClose={() => setPicker(null)} title="Team">
        <View style={styles.options}>
          {kinds.map((k) => (
            <OptionRow
              key={k}
              testID={`totw-kind-option-${k}`}
              label={kindLabel(k)}
              selected={team?.kind === k}
              onPress={() => chooseKind(k)}
            />
          ))}
        </View>
      </Sheet>
      <Sheet visible={picker === 'area'} onClose={() => setPicker(null)} title="Area">
        <View style={styles.options}>
          {team
            ? areaOptions(teamList, team.kind).map((t) => (
                <OptionRow
                  key={t.id}
                  testID={`totw-area-option-${t.id}`}
                  label={t.area_name}
                  selected={t.id === team.id}
                  onPress={() => chooseArea(t)}
                />
              ))
            : null}
        </View>
      </Sheet>
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  skeleton: { gap: space.lg },
  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekText: { flex: 1, alignItems: 'center', gap: space.xs },
  pickers: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  picker: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
  options: { gap: space.xs, paddingBottom: space.md },
  option: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.control,
  },
  optionSelected: { backgroundColor: colors.brandSoft },
  optionLabel: { flex: 1 },
}));
