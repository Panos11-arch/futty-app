// The venue dashboard's "Set up your venue" card (S5A): Photos, Amenities,
// Food & drink, Opening hours, Phone and website, Pitches and Prices, each
// with a tick once the venue has entered it (the server works this out:
// venue_setup_status) and opening its setup screen. Hidden once complete.
import { useCallback } from 'react';
import { View } from 'react-native';

import { Banner, Card, IconSymbol, ListRow, SectionHeader } from '@/components/ui';
import { ICON } from '@/components/ui/foundation';
import { useLoad, type LoadState } from '@/lib/booking-search';
import { useReloadOnReturn } from '@/lib/use-owed';
import { fetchSetupStatus, setupSteps, type SetupPathname, type SetupStatus } from '@/lib/venue-checklist';
import { useTheme } from '@/lib/theme';

export function SetupChecklist({ venueId, onOpen }: { venueId: string; onOpen: (pathname: SetupPathname) => void }) {
  const load = useCallback(() => fetchSetupStatus(venueId), [venueId]);
  const { state, reload } = useLoad(`setup:${venueId}`, load);
  // Back from a setup screen: the ticks again.
  useReloadOnReturn(reload);
  return <SetupChecklistView state={state} onOpen={onOpen} onRetry={reload} />;
}

export function SetupChecklistView({
  state,
  onOpen,
  onRetry,
}: {
  state: LoadState<SetupStatus>;
  onOpen: (pathname: SetupPathname) => void;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  if (state.status === 'loading') return null;
  if (state.status === 'error') {
    return <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: onRetry }} />;
  }
  if (state.data.complete) return null;
  return (
    <View testID="venue-setup-checklist">
      <SectionHeader title="Set up your venue" />
      <Card padded={false}>
        {setupSteps(state.data).map((step) => (
          <ListRow
            key={step.key}
            testID={`venue-setup-step-${step.key}`}
            title={step.label}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: step.done }}
            chevron
            onPress={() => onOpen(step.pathname)}
            trailing={
              <IconSymbol
                name={step.done ? 'checkmark.circle.fill' : 'circle'}
                size={ICON.regular}
                color={step.done ? colors.ink : colors.inkMuted}
              />
            }
          />
        ))}
      </Card>
    </View>
  );
}
