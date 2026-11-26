// "Your venues" (Panos, 26 November): the venues of the signed-in player's
// own confirmed games, most games first (my_venues). Each opens its page.
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { hairline, space } from '@/constants/futty-theme';
import { venueGamesLabel, type MyVenue } from '@/lib/match/profile-summary-api';
import { makeStyles } from '@/lib/theme';

export type VenuesState = { status: 'loading' } | { status: 'error'; message?: string } | { status: 'ready'; venues: MyVenue[] };

export function VenuesList({ state, onRetry }: { state: VenuesState; onRetry: () => void }) {
  const styles = useStyles();
  if (state.status === 'loading') {
    return (
      <Card>
        <View testID="venues-skeleton">
          <SkeletonText lines={3} />
        </View>
      </Card>
    );
  }
  if (state.status === 'error') {
    return <Banner tone="danger" message="Couldn’t load your venues." action={{ label: 'Try again', onPress: onRetry }} />;
  }
  if (state.venues.length === 0) {
    return <EmptyState icon="sportscourt.fill" message="Play a confirmed match to see your venues" />;
  }
  return (
    <Card padded={false}>
      <FlatList
        scrollEnabled={false}
        data={state.venues}
        keyExtractor={(v) => v.venue_id}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        renderItem={({ item }) => (
          <ListRow
            testID={`my-venue-row-${item.venue_id}`}
            title={item.name}
            subtitle={[item.city, venueGamesLabel(item.games)].filter(Boolean).join(' · ')}
            leading={{ icon: 'sportscourt.fill' }}
            chevron
            onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.venue_id } })}
          />
        )}
      />
    </Card>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
}));
