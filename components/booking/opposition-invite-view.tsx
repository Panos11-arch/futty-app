// Side B's accept screen (B3; spec 13 "Invites, after payment"): what,
// when, where and side B's price or hold, from my_opposition_invites; then
// "Accept as captain" and the way side B pays. Paying (or holding) within the
// payment window makes the acceptance stick; the screen does that.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ChoiceCard } from '@/components/booking/checkout-choice';
import { payLabel } from '@/components/booking/checkout-parts';
import { Banner, Button, EmptyState, SkeletonBlock, SkeletonText, StickyActionBar, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import type { OppositionInvite } from '@/lib/booking-opposition';
import { slotLabel, type LoadState } from '@/lib/booking-search';
import { guaranteeLine, wayLine, type WayToPay } from '@/lib/booking-v2';
import { hoursText, ruleText } from '@/lib/rules';
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
  const styles = useStyles();
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
  const styles = useStyles();
  const [accepting, setAccepting] = useState(accepted);
  const [mode, setMode] = useState<Mode | null>(null);
  // B1d: on a Losers pay game side B's prices are its holds.
  const losers = invite.losers_pay === true;
  const allCents = losers ? (invite.losers_pay_all_cents ?? 0) : invite.pay_all_cents;
  const eachCents = losers ? (invite.losers_each_pays_cents ?? 0) : invite.each_pays_cents;
  const amount = mode === 'pay_all' ? allCents : mode ? eachCents : null;
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

        {losers ? (
          <View testID="opposition-losers-pay">
            <Banner tone="info" title="Losers pay" message={losersPayInviteLine(invite, mode)} />
          </View>
        ) : null}

        {invite.found && !accepted ? (
          <Banner tone="info" message="Opposition found. Another captain accepted first." />
        ) : !accepting ? (
          <Button
            testID="opposition-accept"
            label={losers ? 'Accept Losers pay' : 'Accept as captain'}
            onPress={() => setAccepting(true)}
            fullWidth
          />
        ) : (
          <View style={styles.section}>
            <View style={styles.row}>
              {WAYS.map((w) => (
                <ChoiceCard
                  key={w.way}
                  testID={w.testID}
                  title={w.title}
                  price={formatEuros(w.way === 'pay_all' ? allCents : eachCents)}
                  line={wayLine('half', w.way)}
                  selected={mode === w.mode}
                  locked={accepted}
                  onPress={() => choose(w.mode)}
                />
              ))}
            </View>
            {mode === 'each_pays_responsible' && !losers ? (
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

/** B1d (spec 13 "Losers pay"): side B sees Losers pay and its hold before
 *  accepting, from the server's amounts. */
function losersPayInviteLine(invite: OppositionInvite, mode: Mode | null): string {
  const settle = "The losing team pays the whole pitch: if you lose, your hold is taken; if you win, it's released; a draw or a dispute takes half.";
  if (mode === 'pay_all') return `${settle} We hold ${formatEuros(invite.losers_pay_all_cents ?? 0)} on your card until the result.`;
  if (mode === 'each_pays_responsible') {
    const spot = formatEuros(invite.losers_spot_cents ?? 0);
    return `${settle} Each player's card is held for ${spot}. ` + ruleText(
      (r) => `${hoursText(r.gipedo_opponent_hours)} before kickoff, we hold ${spot} on your card for each of your team's spots still without a hold.`,
      `Before kickoff, we hold ${spot} on your card for each of your team's spots still without a hold.`,
    );
  }
  return settle;
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  group: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.md },
}));
