// S8 follow-up (Panos, 26 November): under This season on Profile, "People
// you play with most" and "Your venues". Each row names the top entry and
// opens the full list. A row with nothing in it is hidden, and so is the
// card while both are loading or empty. A failed read still shows its row,
// so the list (with Try again) stays reachable.
import { router } from 'expo-router';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { hairline, space } from '@/constants/futty-theme';
import { venueGamesLabel, type MyVenue } from '@/lib/match/profile-summary-api';
import type { NamedTeammate } from '@/lib/match/use-profile-matches';
import { makeStyles } from '@/lib/theme';

type ListState<K extends string, T> = { status: 'loading' } | { status: 'error'; message?: string } | ({ status: 'ready' } & Record<K, T[]>);

export type ProfilePeoplePlacesProps = {
  teammates: ListState<'teammates', NamedTeammate>;
  venues: ListState<'venues', MyVenue>;
};

type Row = { key: string; title: string; subtitle?: string; route: '/my-teammates' | '/my-venues'; testID: string };

export function ProfilePeoplePlaces({ teammates, venues }: ProfilePeoplePlacesProps) {
  const styles = useStyles();
  const rows: Row[] = [];

  if (teammates.status === 'error' || (teammates.status === 'ready' && teammates.teammates.length > 0)) {
    const top = teammates.status === 'ready' ? teammates.teammates[0] : null;
    rows.push({
      key: 'teammates',
      title: 'People you play with most',
      subtitle: top ? `${top.name} · ${venueGamesLabel(top.matches_together)}` : undefined,
      route: '/my-teammates',
      testID: 'profile-teammates',
    });
  }
  if (venues.status === 'error' || (venues.status === 'ready' && venues.venues.length > 0)) {
    const top = venues.status === 'ready' ? venues.venues[0] : null;
    rows.push({
      key: 'venues',
      title: 'Your venues',
      subtitle: top ? `${top.name} · ${venueGamesLabel(top.games)}` : undefined,
      route: '/my-venues',
      testID: 'profile-venues',
    });
  }

  if (rows.length === 0) return null;

  return (
    <Card padded={false} testID="profile-people">
      {rows.map((row, i) => (
        <View key={row.key}>
          {i > 0 ? <View style={styles.divider} /> : null}
          <ListRow
            testID={row.testID}
            title={row.title}
            subtitle={row.subtitle}
            chevron
            onPress={() => router.push(row.route)}
          />
        </View>
      ))}
    </Card>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
}));
