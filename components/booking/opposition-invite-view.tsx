// Side B's accept screen (B3; spec 13 "Invites, after payment"): what,
// when, where and side B's price or hold, from my_opposition_invites; then
// "Accept as captain" and the way side B pays. Paying (or holding) within the
// payment window makes the acceptance stick; the screen does that.
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ChoiceCard } from '@/components/booking/checkout-choice';
import { payLabel } from '@/components/booking/checkout-parts';
import { Banner, Button, EmptyState, SkeletonBlock, SkeletonText, StickyActionBar, Text } from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import type { OppositionInvite } from '@/lib/booking-opposition';
import { slotLabel, type LoadState } from '@/lib/booking-search';
import { guaranteeLine, wayLine, type WayToPay } from '@/lib/booking-v2';
import { formatEuros } from '@/lib/money/format';

type Mode = 'pay_all' | 'each_pays_responsible';

export type OppositionInviteViewProps = {
  state: LoadState<OppositionInvite>;
  onRetry: () => void;
  onPay: (mode: Mode) => void;
  paying: boolean;
  error: string | null;
  /** The server already made him side B's captain: the way to pay is fixed. */
  accepted: boolean;
};

const WAYS: { way: WayToPay; mode: Mode; title: string; testID: string }[] = [
  { way: 'pay_all', mode: 'pay_all', title: 'Pay for everyone', testID: 'opposition-way-pay-all' },
  { way: 'pay_for_myself', mode: 'each_pays_responsible', title: 'Pay for myself', testID: 'opposition-way-each-pays' },
];

export function OppositionInviteView(props: OppositionInviteViewProps) {
  const { state } = props;
  if (state.status === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <SkeletonText lines={2} variant="headline" />
          <SkeletonBlock width="100%" height={120} />
        </View>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="exclamationmark.circle.fill" message={state.message} action={{ label: 'Try again', onPress: props.onRetry }} />
      </View>
    );
  }
  return <InviteReady {...props} invite={state.data} />;
}

function InviteReady({ invite, onPay, paying, error, accepted }: Omit<OppositionInviteViewProps, 'state' | 'onRetry'> & { invite: OppositionInvite }) {
  const [accepting, setAccepting] = useState(accepted);
  const [mode, setMode] = useState<Mode | null>(null);
  const amount = mode === 'pay_all' ? invite.pay_all_cents : mode ? invite.each_pays_cents : null;
  const choose = (m: Mode) => {
    if (!accepted) setMode(m);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.group}>
          <Text variant="title" accessibilityRole="header">
            {invite.venue_name}
          </Text>
          <Text variant="body" tone="inkMuted" tabular>
            {slotLabel(invite.booking_day, invite.start_time, invite.end_time)}
          </Text>
          <Text variant="body" tone="inkMuted">
            {[invite.pitch_label, invite.format, `${invite.side_players} v ${invite.side_players}`].filter(Boolean).join(' · ')}
          </Text>
          <Text variant="body" tabular>
            {`Your team's half: ${formatEuros(invite.side_pitch_cents)}`}
          </Text>
        </View>

        {invite.found && !accepted ? (
          <Banner tone="info" message="Opposition found. Another captain accepted first." />
        ) : !accepting ? (
          <Button testID="opposition-accept" label="Accept as captain" onPress={() => setAccepting(true)} fullWidth />
        ) : (
          <View style={styles.section}>
            <View style={styles.row}>
              {WAYS.map((w) => (
                <ChoiceCard
                  key={w.way}
                  testID={w.testID}
                  title={w.title}
                  price={formatEuros(w.way === 'pay_all' ? invite.pay_all_cents : invite.each_pays_cents)}
                  line={wayLine('half', w.way)}
                  selected={mode === w.mode}
                  locked={accepted}
                  onPress={() => choose(w.mode)}
                />
              ))}
            </View>
            {mode === 'each_pays_responsible' ? (
              <Text variant="callout" tone="inkMuted">
                {guaranteeLine(invite.guarantee_cents)}
              </Text>
            ) : null}
          </View>
        )}

        {error ? (
          <View testID="opposition-error">
            <Banner tone="danger" message={error} />
          </View>
        ) : null}
      </ScrollView>
      {accepting && !(invite.found && !accepted) ? (
        <StickyActionBar
          actionTestID="opposition-pay"
          totalCents={amount ?? undefined}
          actionLabel={amount !== null ? payLabel(amount) : 'Choose who pays'}
          loading={paying}
          disabled={mode === null || paying}
          onPress={() => {
            if (mode) onPay(mode);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  group: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.md },
});
