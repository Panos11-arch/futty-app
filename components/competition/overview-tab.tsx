// Overview (image 13; SofaScore 07-10), top to bottom: the season card (with
// the join flow while sign-up is open), Player of the season, Power
// rankings top 4, Team of the season, the featured match and Titles. No
// Discussion (S7b), no ads (G4a), no Media. Empty sections are hidden;
// Player of the season shows image 13's placeholder until someone has 3
// matches.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { DropdownButton } from '@/components/competition/dropdown-button';
import { InfoLine } from '@/components/competition/info-line';
import { OptionSheet } from '@/components/competition/option-sheet';
import { openPlayer, TeamLink } from '@/components/competition/team-link';
import { CompetitionJoin } from '@/components/match/league-sections';
import { RatingBadge } from '@/components/match/rating-badge';
import { TotwPitch } from '@/components/match/totw-pitch';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text, type TextTone } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { cyprusDateKey } from '@/lib/days';
import type { League } from '@/lib/leagues';
import {
  competitionPlayerLook,
  matchDateLabel,
  matchStatusLabel,
  progressDateLabel,
  roundLabel,
  seasonProgress,
  toTotwPlayers,
  type Competition,
  type FeaturedMatch,
} from '@/lib/match/competition-api';
import { formatPoints, rankMove } from '@/lib/match/power-ranking-api';
import { useCompetitionAwards, useCompetitionPowerRanking } from '@/lib/match/use-competition';
import { makeStyles } from '@/lib/theme';

/** Player of the season needs this many matches (match-record.md 1n item 5,
 *  app_rules.competition_player_min_matches; the server applies it). */
export const PLAYER_MIN_MATCHES = 3;

const MOVE_TONE: Record<'up' | 'down' | 'none', TextTone> = { up: 'positive', down: 'danger', none: 'inkMuted' };

/** "Upcoming", "In progress" or "Finished", from the server's dates. */
export function seasonStatus(season: Competition['season'], today: string): string {
  if (season.finished) return 'Finished';
  if (season.startDate && today < season.startDate) return 'Upcoming';
  if (season.startDate) return 'In progress';
  return 'Sign-up open';
}

function SeasonCard({
  competition,
  hub,
  leagues,
  onChanged,
}: {
  competition: Competition;
  hub: League | null;
  leagues: League[];
  onChanged: () => void;
}) {
  const styles = useStyles();
  const today = cyprusDateKey(new Date());
  const { season } = competition;
  const progress = seasonProgress(season.startDate, season.endDate, today);
  return (
    <Card testID="competition-season-card">
      <View style={styles.cardHead}>
        <Text variant="title" style={styles.flex}>
          {season.name}
        </Text>
        <Text variant="callout" tone="inkMuted">
          {seasonStatus(season, today)}
        </Text>
      </View>
      {progress != null ? (
        <View
          testID="competition-progress"
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Season progress"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(progress, 0.04) * 100}%` }]} />
          </View>
          <View style={styles.dates}>
            <Text variant="caption" tone="inkMuted">
              {progressDateLabel(season.startDate!)}
            </Text>
            <Text variant="caption" tone="inkMuted">
              {progressDateLabel(season.endDate!)}
            </Text>
          </View>
        </View>
      ) : null}
      {hub ? <CompetitionJoin hub={hub} leagues={leagues} onChanged={onChanged} /> : null}
    </Card>
  );
}

function PlayerOfTheSeason({ awards, onSeeMore }: { awards: ReturnType<typeof useCompetitionAwards>; onSeeMore: () => void }) {
  const styles = useStyles();
  if (awards.status === 'loading') return <SkeletonBlock width="100%" height={120} />;
  if (awards.status === 'error') return null;
  const player = awards.awards?.player ?? null;
  return (
    <Card testID="competition-player-of-season">
      <Text variant="title">Player of the season</Text>
      {player ? (
        <>
          <View style={styles.playerRow}>
            <Pressable
              testID={`competition-player-${player.profileId}`}
              accessibilityRole="link"
              accessibilityLabel={`Open ${player.name}`}
              onPress={() => openPlayer(player.profileId)}
              style={styles.playerMain}>
              <Avatar name={player.name} kit={competitionPlayerLook(player)} size={56} />
              <Text variant="headline" numberOfLines={1} style={styles.flex}>
                {player.name}
              </Text>
            </Pressable>
            <RatingBadge rating={player.rating} size="regular" />
          </View>
          {player.teamId && player.teamName ? <TeamLink teamId={player.teamId} name={player.teamName} /> : null}
          <Button label="See more" variant="plain" onPress={onSeeMore} testID="competition-player-see-more" />
        </>
      ) : (
        <View style={styles.playerRow}>
          <Avatar name="" size={56} />
          <View style={styles.flex}>
            <Text variant="headline">{`Shown after ${PLAYER_MIN_MATCHES} matches`}</Text>
            <Text variant="callout" tone="inkMuted">
              Highest average rating
            </Text>
          </View>
        </View>
      )}
    </Card>
  );
}

function PowerTop({ seasonId, onGo }: { seasonId: string; onGo: () => void }) {
  const styles = useStyles();
  const power = useCompetitionPowerRanking(seasonId);
  if (power.status === 'loading') return <SkeletonBlock width="100%" height={200} />;
  if (power.status === 'error' || power.rows.length === 0) return null;
  return (
    <Card testID="competition-power-top">
      <Text variant="title">Power rankings</Text>
      {power.rows.slice(0, 4).map((r) => {
        const move = rankMove(r.position_change);
        return (
          <View key={r.team_id} style={styles.powerRow} testID={`competition-power-top-${r.team_id}`}>
            <Text variant="headline" tabular style={styles.rank}>
              {String(r.position)}
            </Text>
            <Text variant="callout" tabular tone={MOVE_TONE[move.direction]} style={styles.move} accessibilityLabel={move.spoken}>
              {move.label}
            </Text>
            <View style={styles.flex}>
              <TeamLink teamId={r.team_id} name={r.team_name} size={32} />
            </View>
            <Text variant="number" tabular>
              {formatPoints(r.points)}
            </Text>
          </View>
        );
      })}
      <Button label="Go to power rankings" variant="plain" onPress={onGo} testID="competition-power-go" />
    </Card>
  );
}

function TeamOfTheSeason({
  awards,
  matchday,
  onMatchday,
}: {
  awards: ReturnType<typeof useCompetitionAwards>;
  matchday: number | null;
  onMatchday: (m: number | null) => void;
}) {
  const styles = useStyles();
  const [picking, setPicking] = useState(false);
  if (awards.status !== 'ready' || !awards.awards) return null;
  const { team, matchdays } = awards.awards;
  if (matchday == null && (!team || team.players.length === 0)) return null;
  const label = matchday == null ? 'Whole season' : roundLabel(matchday);
  const options = [{ key: 'season', label: 'Whole season' }, ...matchdays.map((m) => ({ key: String(m), label: roundLabel(m) }))];
  const pitch = team ? toTotwPlayers(team) : null;
  return (
    <Card testID="competition-team-of-season">
      <View style={styles.cardHead}>
        <Text variant="title" style={styles.flex}>
          Team of the season
        </Text>
        <DropdownButton
          label={label}
          accessibilityLabel={`${label}. Change period`}
          onPress={() => setPicking(true)}
          testID="competition-team-matchday"
        />
      </View>
      <InfoLine text="Best rated players, placed by goals and assists." testID="competition-team-info" />
      {pitch ? <TotwPitch players={pitch.players} shape={pitch.shape} testID="competition-team-pitch" /> : null}
      <OptionSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Period"
        options={options}
        selectedKey={matchday == null ? 'season' : String(matchday)}
        onSelect={(key) => onMatchday(key === 'season' ? null : Number(key))}
        testID="competition-team-matchdays"
      />
    </Card>
  );
}

function Featured({ featured }: { featured: FeaturedMatch }) {
  const styles = useStyles();
  const result = featured.kind === 'result';
  const middle = result
    ? `${featured.home.score ?? 0} - ${featured.away.score ?? 0}`
    : matchStatusLabel({ status: 'agreed', forfeit_result: null, kickoff_at: featured.kickoffAt });
  const day = result ? null : matchDateLabel({ kickoff_at: featured.kickoffAt });
  const open = featured.matchId ? () => router.push({ pathname: '/match/[id]', params: { id: featured.matchId! } }) : undefined;
  return (
    <Card testID="competition-featured" onPress={open} accessibilityLabel={open ? `Open ${featured.home.name} v ${featured.away.name}` : undefined}>
      <Text variant="title" style={styles.center}>
        Featured
      </Text>
      <View style={styles.featuredRow}>
        <View style={styles.featuredSide}>
          <TeamLink teamId={featured.home.teamId} name={featured.home.name} size={48} />
        </View>
        <View style={styles.featuredMiddle}>
          <Text variant="display" tabular>
            {middle}
          </Text>
          {day ? (
            <Text variant="caption" tone="inkMuted">
              {day}
            </Text>
          ) : null}
        </View>
        <View style={[styles.featuredSide, styles.featuredAway]}>
          <TeamLink teamId={featured.away.teamId} name={featured.away.name} size={48} />
        </View>
      </View>
    </Card>
  );
}

function Titles({ titles }: { titles: Competition['titles'] }) {
  const styles = useStyles();
  if (titles.length === 0) return null;
  return (
    <Card testID="competition-titles">
      <Text variant="title">Titles</Text>
      {titles.map((t) => (
        <View key={t.seasonId} style={styles.titleRow} testID={`competition-title-${t.seasonId}`}>
          <View style={styles.flex}>
            <Text variant="caption" tone="inkMuted">
              {t.year != null ? String(t.year) : t.name}
            </Text>
            <TeamLink teamId={t.teamId} name={t.teamName} size={32} />
          </View>
          {t.holder ? (
            <View style={styles.holder}>
              <Text variant="caption">Title holder</Text>
            </View>
          ) : null}
        </View>
      ))}
    </Card>
  );
}

export function OverviewTab({
  competition,
  hub,
  leagues,
  onChanged,
  onRefresh,
  onGoTab,
}: {
  competition: Competition;
  /** The league row (for the join flow); null while loading. */
  hub: League | null;
  leagues: League[];
  onChanged: () => void;
  onRefresh: () => Promise<void>;
  onGoTab: (tab: 'stats' | 'power') => void;
}) {
  const styles = useStyles();
  const seasonId = competition.season.id;
  const [matchday, setMatchday] = useState<number | null>(null);
  const awards = useCompetitionAwards(seasonId, matchday);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([onRefresh(), awards.reload()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      testID="competition-overview"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <SeasonCard competition={competition} hub={hub} leagues={leagues} onChanged={onChanged} />
      <PlayerOfTheSeason awards={awards} onSeeMore={() => onGoTab('stats')} />
      <PowerTop seasonId={seasonId} onGo={() => onGoTab('power')} />
      <TeamOfTheSeason awards={awards} matchday={matchday} onMatchday={setMatchday} />
      {awards.status === 'error' ? (
        <Banner tone="danger" message="Couldn’t load the awards." action={{ label: 'Try again', onPress: awards.reload }} />
      ) : null}
      {competition.featured ? <Featured featured={competition.featured} /> : null}
      <Titles titles={competition.titles} />
    </ScrollView>
  );
}

/** The Overview's shape while the competition loads. */
export function OverviewSkeleton() {
  const styles = useStyles();
  return (
    <View testID="league-page-skeleton" style={styles.content}>
      <Card>
        <SkeletonText lines={2} />
      </Card>
      <SkeletonBlock width="100%" height={120} />
      <SkeletonBlock width="100%" height={200} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  content: { gap: space.lg, padding: space.lg, paddingBottom: space.xxl },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: { height: space.sm, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.green },
  dates: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.xs },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  playerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  powerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rank: { minWidth: space.xl },
  move: { minWidth: space.xl + space.sm },
  featuredRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  featuredSide: { flex: 1 },
  featuredAway: { alignItems: 'flex-end' },
  featuredMiddle: { alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  holder: { paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: colors.greenSoft },
}));
