// Component gallery: every components/ui component in every state, to check
// the look on a phone. Dev builds only: open futtyapp://dev/components.
import { Redirect, Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  AvatarStack,
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  ListRow,
  PriceBreakdown,
  SectionHeader,
  SegmentedControl,
  Sheet,
  SkeletonBlock,
  SkeletonText,
  StatusPill,
  StickyActionBar,
  Text,
  TextField,
  VenueCard,
  type Status,
} from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';

const statuses: Status[] = [
  'paid',
  'cash',
  'unpaid',
  'debt',
  'confirmed',
  'pending',
  'held',
  'charged',
  'released',
  'refunded',
];

const people = ['Andreas Georgiou', 'Bella Kyriakou', 'Chris Pavlou', 'Dina Michael', 'Elias Nicolaou', 'Fotis Orphanides', 'Georgia Savva'].map(
  (name, i) => ({ id: String(i), name }),
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      <View style={styles.stack}>{children}</View>
    </View>
  );
}

const noop = () => {};

export default function ComponentGallery() {
  const [payMode, setPayMode] = useState<'everyone' | 'each'>('everyone');
  const [chip, setChip] = useState('18:00');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bareSheetOpen, setBareSheetOpen] = useState(false);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Components' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Text">
          <Text variant="display">Display</Text>
          <Text variant="title">Title</Text>
          <Text variant="headline">Headline</Text>
          <Text>Body</Text>
          <Text variant="callout" tone="inkMuted">
            Callout, muted
          </Text>
          <Text variant="caption" tone="inkMuted">
            Caption, muted
          </Text>
          <Text tabular>Tabular €12.50 · 18:00</Text>
        </Section>

        <Section title="Button">
          <Button label="Pay €6.80" onPress={noop} />
          <Button label="Invite players" variant="secondary" onPress={noop} />
          <Button label="Cancel my spot" variant="destructive" onPress={noop} />
          <Button label="See all" variant="plain" onPress={noop} />
          <Button label="Pay €6.80" loading onPress={noop} />
          <Button label="Pay €6.80" disabled onPress={noop} />
          <Button label="Book" fullWidth onPress={noop} />
        </Section>

        <Section title="IconButton">
          <View style={styles.row}>
            <IconButton icon="bell.fill" accessibilityLabel="Notifications" onPress={noop} />
            <IconButton icon="square.and.arrow.up" accessibilityLabel="Share" size="small" onPress={noop} />
            <IconButton icon="trash.fill" accessibilityLabel="Remove" tone="danger" onPress={noop} />
            <IconButton icon="xmark" accessibilityLabel="Close" disabled onPress={noop} />
          </View>
        </Section>

        <Section title="TextField">
          <TextField label="Team name" placeholder="Larnaca Lions" helper="Shown to other players" />
          <TextField label="Email" defaultValue="andreas@" error="Enter a valid email" />
          <TextField label="Venue" defaultValue="Nicosia Five" editable={false} />
        </Section>

        <Section title="ListRow">
          <Card padded={false}>
            <ListRow title="Payment methods" subtitle="Visa ending 4242" leading={{ icon: 'creditcard.fill' }} chevron onPress={noop} />
            <ListRow
              title="Andreas Georgiou"
              subtitle="Joined Tuesday"
              leading={{ avatar: { name: 'Andreas Georgiou' } }}
              trailing={<StatusPill status="paid" />}
            />
            <ListRow title="Plain row" />
          </Card>
        </Section>

        <Section title="SegmentedControl">
          <SegmentedControl
            accessibilityLabel="Who pays"
            options={[
              { value: 'everyone', label: 'Pay for everyone' },
              { value: 'each', label: 'Each pays' },
            ]}
            value={payMode}
            onChange={setPayMode}
          />
        </Section>

        <Section title="Chip">
          <View style={styles.wrap}>
            {['18:00', '19:00', '20:30'].map((time) => (
              <Chip key={time} label={time} tabular selected={chip === time} onPress={() => setChip(time)} />
            ))}
            <Chip label="21:30" tabular disabled onPress={noop} />
          </View>
        </Section>

        <Section title="Card">
          <Card>
            <Text variant="headline">Plain card</Text>
            <Text tone="inkMuted">Surface with the one soft shadow.</Text>
          </Card>
          <Card onPress={noop} accessibilityLabel="Pressable card">
            <Text variant="headline">Pressable card</Text>
          </Card>
        </Section>

        <Section title="VenueCard">
          <VenueCard
            name="Nicosia Five"
            area="Strovolos"
            pricePerPlayerCents={680}
            nextTimes={['18:00', '19:00', '20:30']}
            onPress={noop}
          />
          <VenueCard
            name="Limassol Arena"
            area="Germasogeia"
            pricePerPlayerCents={750}
            photoUrl="https://picsum.photos/seed/futty/800/450"
            nextTimes={[]}
            onPress={noop}
          />
        </Section>

        <Section title="StatusPill">
          <View style={styles.wrap}>
            {statuses.map((status) => (
              <StatusPill key={status} status={status} />
            ))}
          </View>
        </Section>

        <Section title="AvatarStack">
          <AvatarStack people={people} />
          <AvatarStack people={people.slice(0, 3)} />
        </Section>

        <Section title="PriceBreakdown">
          <Card>
            <PriceBreakdown
              lines={[
                { label: 'Pitch', cents: 600 },
                { label: 'Service fee', cents: 80 },
              ]}
              totalCents={680}
            />
          </Card>
        </Section>

        <Section title="Banner">
          <Banner tone="info" message="Booking opens at 09:00" />
          <Banner tone="warning" title="Rain expected" message="Showers likely around kickoff." />
          <Banner
            tone="danger"
            title="You owe €6.80"
            message="To Nicosia Five, for Thursday's game."
            action={{ label: 'Pay what I owe', onPress: noop }}
          />
        </Section>

        <Section title="EmptyState">
          <Card>
            <EmptyState icon="calendar" message="No games booked yet" action={{ label: 'Book a pitch', onPress: noop }} />
          </Card>
          <Card>
            <EmptyState icon="bell.fill" message="No notifications" />
          </Card>
        </Section>

        <Section title="Skeleton">
          <SkeletonBlock width="100%" height={160} />
          <SkeletonText lines={3} />
          <SkeletonBlock width={44} height={44} rounded="pill" />
        </Section>

        <Section title="Sheet">
          <Button label="Open sheet with actions" variant="secondary" onPress={() => setSheetOpen(true)} />
          <Button label="Open sheet with content only" variant="secondary" onPress={() => setBareSheetOpen(true)} />
        </Section>

        <Section title="SectionHeader">
          <SectionHeader title="Venues nearby" action={{ label: 'See all', onPress: noop }} />
        </Section>
      </ScrollView>

      <StickyActionBar totalCents={680} actionLabel="Pay €6.80" onPress={noop} />

      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Cancel my spot"
        primaryAction={{ label: 'Cancel my spot', onPress: () => setSheetOpen(false) }}
        secondaryAction={{ label: 'Keep my spot' }}>
        <Text>Your €6.80 hold is released. Swipe down, tap outside or press Keep my spot to close.</Text>
      </Sheet>
      <Sheet visible={bareSheetOpen} onClose={() => setBareSheetOpen(false)} title="About this venue">
        <Text tone="inkMuted">Content only, no actions.</Text>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl },
  section: { gap: space.md },
  stack: { gap: space.md },
  row: { flexDirection: 'row', gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
