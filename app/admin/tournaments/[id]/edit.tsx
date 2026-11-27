// S10A admin: a tournament's details, changed (dates, deadline, match length,
// fee, venue). The format and subs lock once a team has signed up
// (format_locked, on the server).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminTournamentForm } from '@/components/competition/tournament/admin-tournament-form';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import { adminUpdateTournament } from '@/lib/match/tournament-api';
import { formFromTournament } from '@/lib/match/tournament-form';
import { useTournament } from '@/lib/match/use-tournament';
import { makeStyles } from '@/lib/theme';

export default function EditTournamentScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tournament = useTournament(id);
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']} testID="admin-tournament-edit">
      <Stack.Screen options={{ title: 'Edit details' }} />
      {tournament.status === 'loading' ? (
        <View style={styles.content}>
          <Card>
            <SkeletonText lines={6} />
          </Card>
        </View>
      ) : tournament.status === 'error' || !tournament.tournament ? (
        <View style={styles.content}>
          <Banner tone="danger" message="Couldn’t load this tournament." action={{ label: 'Try again', onPress: tournament.reload }} />
        </View>
      ) : (
        <AdminTournamentForm
          initial={formFromTournament(tournament.tournament)}
          submitLabel="Save"
          editing
          onSubmit={async (input) => {
            const { error } = await adminUpdateTournament(id, input);
            if (error) return error.message;
            router.back();
            return null;
          }}
        />
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg },
}));
