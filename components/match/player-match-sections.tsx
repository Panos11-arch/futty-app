// The match sections of a player's profile (A3b-2b): form and recent
// matches for anyone, and "Players you play with most" on the viewer's own
// profile only (player_teammates returns the caller's own list).
import { StyleSheet, View } from 'react-native';

import { FormChips } from '@/components/match/form-chips';
import { RecentMatches } from '@/components/match/recent-matches';
import { TeammatesList } from '@/components/match/teammates-list';
import { SectionHeader } from '@/components/ui/section-header';
import { space } from '@/constants/futty-theme';
import { useMyTeammates, usePlayerForm, usePlayerRecentMatches } from '@/lib/match/use-profile-matches';

export function PlayerMatchSections({ profileId, own = false }: { profileId: string; own?: boolean }) {
  const form = usePlayerForm(profileId);
  const recent = usePlayerRecentMatches(profileId);
  return (
    <View style={styles.wrap}>
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
