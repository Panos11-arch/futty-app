import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import {
  ALWAYS_SENT_REASON,
  notificationLabel,
  quietHoursCrossMidnight,
  quietHoursError,
  type QuietHours,
} from '@/lib/notifications';
import { preferences } from '@/lib/preferences';
import { registerForPushNotifications, unregisterPushNotifications } from '@/lib/push-notifications';
import { useNotificationSettings } from '@/lib/use-notification-settings';
import { useProfile } from '@/lib/use-profile';

function describePushFailure(reason: string) {
  switch (reason) {
    case 'not_supported_on_web':
      return 'Push notifications need iOS or Android.';
    case 'not_a_physical_device':
      return 'Push notifications need a real device, not a simulator.';
    case 'permission_denied':
      return 'Notification permission was denied. Turn it on in your phone’s settings.';
    case 'no_project_id':
      return 'Not set up yet: this app has no EAS project configured.';
    default:
      return reason;
  }
}

/** This phone's push token: registering it is what lets any push arrive. */
function DevicePushRow() {
  const profile = useProfile();
  const [enabled, setEnabled] = useState(preferences.isPushNotificationsEnabled());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    if (profile.status !== 'ready') return;
    setBusy(true);
    setError(null);
    if (next) {
      const result = await registerForPushNotifications(profile.profile.id);
      if (result.ok) {
        preferences.setPushNotificationsEnabled(true);
        setEnabled(true);
      } else {
        setError(describePushFailure(result.reason));
      }
    } else {
      await unregisterPushNotifications(profile.profile.id);
      preferences.setPushNotificationsEnabled(false);
      setEnabled(false);
    }
    setBusy(false);
  }

  return (
    <View style={styles.section}>
      <Card padded={false}>
        <ListRow
          title="Push notifications on this phone"
          leading={{ icon: 'bell.fill' }}
          trailing={
            <Switch
              accessibilityLabel="Push notifications on this phone"
              value={enabled}
              onValueChange={toggle}
              disabled={busy || profile.status !== 'ready'}
            />
          }
        />
      </Card>
      {error ? <Banner tone="danger" message={error} /> : null}
    </View>
  );
}

const toHHMM = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function dateFor(hhmm: string | undefined) {
  const d = new Date();
  const [h, m] = (hhmm ?? '22:00').split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/** One time row; the picker gives a wall-clock time, read as Cyprus time. */
function TimeRow({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string) => void }) {
  const [showIOS, setShowIOS] = useState(false);
  function open() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: dateFor(value),
        mode: 'time',
        is24Hour: true,
        onChange: (event, selected) => {
          if (event.type === 'set' && selected) onChange(toHHMM(selected));
        },
      });
    } else {
      setShowIOS((v) => !v);
    }
  }
  return (
    <View>
      <ListRow
        testID={`quiet-${label.toLowerCase()}`}
        title={label}
        accessibilityLabel={`${label}: ${value ?? 'not set'}`}
        trailing={
          <Text variant="body" tone={value ? 'ink' : 'inkMuted'} tabular>
            {value ?? 'Pick a time'}
          </Text>
        }
        chevron
        onPress={open}
      />
      {Platform.OS === 'ios' && showIOS ? (
        <DateTimePicker
          testID={`quiet-${label.toLowerCase()}-picker`}
          value={dateFor(value)}
          mode="time"
          display="spinner"
          is24Hour
          onChange={(event, selected) => {
            if (event.type === 'set' && selected) onChange(toHHMM(selected));
          }}
        />
      ) : null}
    </View>
  );
}

function QuietHoursSection({
  saved,
  onSave,
}: {
  saved: QuietHours | null;
  onSave: (q: QuietHours | null) => Promise<{ error: unknown }>;
}) {
  const [on, setOn] = useState(saved !== null);
  const [draft, setDraft] = useState<Partial<QuietHours>>(saved ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOn(saved !== null);
    setDraft(saved ?? {});
  }, [saved]);

  const invalid = quietHoursError(draft);
  const changed = !saved || saved.starts !== draft.starts || saved.ends !== draft.ends;

  async function toggle(next: boolean) {
    setError(null);
    if (next) {
      // No defaults (match-record.md decision 1a.6): nothing is saved until both times are picked.
      setOn(true);
      return;
    }
    setOn(false);
    setDraft({});
    if (saved) {
      setBusy(true);
      const { error: e } = await onSave(null);
      setBusy(false);
      if (e) {
        setOn(true);
        setDraft(saved);
        setError('Couldn’t turn off quiet hours. Try again.');
      }
    }
  }

  async function save() {
    if (invalid || !draft.starts || !draft.ends) return;
    setBusy(true);
    setError(null);
    const { error: e } = await onSave({ starts: draft.starts, ends: draft.ends });
    setBusy(false);
    if (e) setError('Couldn’t save quiet hours. Try again.');
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Quiet hours" />
      <Card padded={false}>
        <ListRow
          title="Quiet hours"
          subtitle="Pushes wait until the quiet hours end"
          trailing={
            <Switch accessibilityLabel="Quiet hours" value={on} onValueChange={toggle} disabled={busy} />
          }
        />
        {on ? (
          <>
            <TimeRow label="Start" value={draft.starts} onChange={(v) => setDraft((d) => ({ ...d, starts: v }))} />
            <TimeRow label="End" value={draft.ends} onChange={(v) => setDraft((d) => ({ ...d, ends: v }))} />
          </>
        ) : null}
      </Card>
      {on ? (
        <View style={styles.quietFooter}>
          <Text variant="caption" tone="inkMuted">
            {draft.starts && draft.ends && !invalid && quietHoursCrossMidnight({ starts: draft.starts, ends: draft.ends })
              ? 'Cyprus time · ends the next day'
              : 'Cyprus time'}
          </Text>
          {draft.starts && draft.ends && invalid ? (
            <Text variant="callout" tone="danger">
              {invalid}
            </Text>
          ) : null}
          {changed ? (
            <Button label="Save quiet hours" onPress={save} loading={busy} disabled={invalid !== null} />
          ) : null}
        </View>
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
    </View>
  );
}

/** Per-type settings and quiet hours (match-record.md section 4.10, decision
 *  1d), written to the player's own notification_settings and
 *  notification_quiet_hours rows. Which types exist, and which are always
 *  sent, comes from the server. */
export default function NotificationSettingsScreen() {
  const s = useNotificationSettings();
  const [writeError, setWriteError] = useState<string | null>(null);

  async function toggle(type: string, enabled: boolean) {
    setWriteError(null);
    const { error } = await s.setEnabled(type, enabled);
    if (error) setWriteError(`Couldn’t change “${notificationLabel(type)}”. Try again.`);
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <DevicePushRow />

        {s.status === 'loading' ? (
          <View testID="notification-settings-skeleton">
            <SkeletonText lines={6} />
          </View>
        ) : null}

        {s.status === 'error' ? (
          <Banner
            tone="danger"
            message="Couldn’t load your notification settings."
            action={{ label: 'Try again', onPress: s.reload }}
          />
        ) : null}

        {s.status === 'ready' ? (
          <>
            {writeError ? <Banner tone="danger" message={writeError} /> : null}
            {s.sections.map((section) => (
              <View key={section.key} style={styles.section}>
                <SectionHeader title={section.title} />
                <Card padded={false}>
                  {section.types.map((type) => {
                    const label = notificationLabel(type);
                    return (
                      <ListRow
                        key={type}
                        testID={`notification-${type}`}
                        title={label}
                        trailing={
                          <Switch
                            testID={`switch-${type}`}
                            accessibilityLabel={label}
                            value={s.settings[type] ?? true}
                            onValueChange={(v) => toggle(type, v)}
                          />
                        }
                      />
                    );
                  })}
                </Card>
              </View>
            ))}

            {s.alwaysSent.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Always sent" />
                <Text variant="callout" tone="inkMuted">
                  {ALWAYS_SENT_REASON}
                </Text>
                <Card padded={false}>
                  {s.alwaysSent.map((type) => (
                    <ListRow key={type} testID={`notification-${type}`} title={notificationLabel(type)} />
                  ))}
                </Card>
              </View>
            ) : null}

            <QuietHoursSection saved={s.quietHours} onSave={s.saveQuietHours} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: space.xl,
    padding: space.lg,
    paddingBottom: space.xxl,
  },
  section: { gap: space.sm },
  quietFooter: { gap: space.sm },
});
