// One section of the match page (scorers, man of the match, lineups): a
// title, then a skeleton while loading, an inline error with retry, or the
// section itself.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';

export type SectionStatus = 'loading' | 'error' | 'ready';

export type MatchPageSectionProps = {
  title: string;
  status: SectionStatus;
  onRetry: () => void;
  errorMessage?: string;
  children?: ReactNode;
  testID?: string;
};

export function MatchPageSection({ title, status, onRetry, errorMessage, children, testID }: MatchPageSectionProps) {
  return (
    <View style={styles.stack} testID={testID}>
      <SectionHeader title={title} />
      <Card>
        {status === 'loading' ? (
          <View testID={testID ? `${testID}-skeleton` : undefined}>
            <SkeletonText lines={3} />
          </View>
        ) : status === 'error' ? (
          <SectionError message={errorMessage ?? `Could not load ${title.toLowerCase()}.`} onRetry={onRetry} />
        ) : (
          children
        )}
      </Card>
    </View>
  );
}

/** An inline error with a retry, for a part of a section (the squad). */
export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Banner tone="danger" message={message} action={{ label: 'Try again', onPress: onRetry }} />;
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
});
