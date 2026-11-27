// S10A admin: the tournaments, for Futty admins (Account → Tournaments).
// Create, then open one to run it. Every admin call is checked on the
// server (is_app_admin); a non-admin who opens this sees the list only.
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import { tournamentDates, tournamentStatusLabel } from '@/lib/match/tournament-api';
import { useTournaments } from '@/lib/match/use-tournament';
import { makeStyles } from '@/lib/theme';

export default function AdminTournamentsScreen() {
  const styles = useStyles();
  const tournaments = useTournaments();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await tournaments.reload();
    setRefreshing(false);
  };
  const create = () => router.push('/admin/tournaments/new');

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']} testID="admin-tournaments">
      <Stack.Screen options={{ title: 'Tournaments' }} />
      {tournaments.status === 'loading' ? (
        <View style={styles.content} testID="admin-tournaments-skeleton">
          <Card>
            <SkeletonText lines={4} />
          </Card>
        </View>
      ) : tournaments.status === 'error' ? (
        <View style={styles.content}>
          <Banner tone="danger" message="Couldn’t load the tournaments." action={{ label: 'Try again', onPress: tournaments.reload }} />
        </View>
      ) : (
        <FlatList
          testID="admin-tournaments-list"
          data={tournaments.tournaments}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListHeaderComponent={
            tournaments.tournaments.length > 0 ? (
              <Button label="Create" onPress={create} fullWidth testID="admin-tournaments-create" />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState icon="trophy.fill" message="No tournaments yet" action={{ label: 'Create', onPress: create }} />
          }
          renderItem={({ item }) => (
            <Card padded={false}>
              <ListRow
                testID={`admin-tournament-${item.id}`}
                title={item.name}
                subtitle={`${tournamentStatusLabel(item.status)} · ${tournamentDates(item)} · ${item.teamsCount} of ${item.maxTeams} teams`}
                chevron
                onPress={() => router.push({ pathname: '/admin/tournaments/[id]', params: { id: item.id } })}
              />
            </Card>
          )}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
        />
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  gap: { height: space.md },
}));
