// The match sections of a player's profile (A3b-2b): form and recent
// matches for anyone, and "Players you play with most" on the viewer's own
// profile only (player_teammates returns the caller's own list). A7 adds the
// season stats (this year in Cyprus time, or all time) with a link to the
// leaderboards.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormChips } from '@/components/match/form-chips';
import { RecentMatches } from '@/components/match/recent-matches';
import { PlayerSeasonStatsView, SeasonPicker, type SeasonPick } from '@/components/match/season-stats';
import { TeammatesList } from '@/components/match/teammates-list';
import { SectionHeader } from '@/components/ui/section-header';
import { space } from '@/constants/futty-theme';
import { cyprusYear } from '@/lib/match/stats-api';
import { useMyTeammates, usePlayerForm, usePlayerRecentMatches } from '@/lib/match/use-profile-matches';
import { usePlayerSeasonStats } from '@/lib/match/use-stats';

export function PlayerMatchSections({ profileId, own = false }: { profileId: string; own?: boolean }) {
  const form = usePlayerForm(profileId);
  const recent = usePlayerRecentMatches(profileId);
  return (
    <View style={styles.wrap}>
      <PlayerSeason profileId={profileId} />
      <View style={styles.section}>
        <SectionHeader title="Form" />
        <FormChips
          form={form.status === 'ready' ? form.form : []}
          loading={form.status === 'loading'}
          error={form.status === 'error'}
          onRetry={form.reload}
        />
      </View>
      <View style={styles.section}>
        <SectionHeader title="Recent matches" />
        <RecentMatches state={recent} onRetry={recent.reload} />
      </View>
      {own ? <MyTeammates /> : null}
    </View>
  );
}

function PlayerSeason({ profileId }: { profileId: string }) {
  const [pick, setPick] = useState<SeasonPick>('year');
  const stats = usePlayerSeasonStats(profileId, pick === 'year' ? { kind: 'year', year: cyprusYear() } : { kind: 'all' });
  return (
    <View style={styles.section} testID="player-season">
      <SectionHeader title="Season" action={{ label: 'Leaderboards', onPress: () => router.push('/match/leaderboards') }} />
      <SeasonPicker value={pick} onChange={setPick} />
      <PlayerSeasonStatsView
        state={stats.status === 'ready' ? { status: 'ready', stats: stats.stats } : stats}
        pick={pick}
        onRetry={stats.reload}
      />
    </View>
  );
}

function MyTeammates() {
  const teammates = useMyTeammates();
  return (
    <View style={styles.section}>
      <SectionHeader title="Players you play with most" />
      <TeammatesList state={teammates} onRetry={teammates.reload} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  section: { gap: space.sm },
});
