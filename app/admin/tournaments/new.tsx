// S10A admin: Create a tournament. Without dates it shows "Coming soon"
// everywhere until an admin opens sign-up.
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminTournamentForm } from '@/components/competition/tournament/admin-tournament-form';
import { adminCreateTournament, type TournamentInput } from '@/lib/match/tournament-api';
import { EMPTY_FORM } from '@/lib/match/tournament-form';
import { makeStyles } from '@/lib/theme';

export default function NewTournamentScreen() {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']} testID="admin-tournament-new">
      <Stack.Screen options={{ title: 'New tournament' }} />
      <AdminTournamentForm
        initial={EMPTY_FORM}
        submitLabel="Create"
        onSubmit={async (input) => {
          const { id, error } = await adminCreateTournament(input as TournamentInput);
          if (error || !id) return error?.message ?? 'invalid_tournament';
          router.replace({ pathname: '/admin/tournaments/[id]', params: { id } });
          return null;
        }}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
}));
