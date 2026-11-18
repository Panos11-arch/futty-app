import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';

/** Shared layout for the plain-text screens under the account menu's Support
 *  and Legal information sections (Help, How Futty works, Terms of use,
 *  Privacy policy) — native views rather than a WebView loading docs/*.html,
 *  so these read in the app's own type/spacing instead of a plain browser
 *  page, and don't need react-native-webview added as a new dependency. */
export function DocScreen({ updated, children }: PropsWithChildren<{ updated?: string }>) {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {updated ? (
          <Text variant="caption" tone="inkMuted">
            Last updated: {updated}
          </Text>
        ) : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function DocHeading({ children }: PropsWithChildren) {
  return (
    <Text variant="headline" accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function DocParagraph({ children }: PropsWithChildren) {
  return <Text variant="body">{children}</Text>;
}

export function DocBullet({ children }: PropsWithChildren) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text variant="body" style={styles.flex}>
        {children}
      </Text>
    </View>
  );
}

export function DocEmailLink({ email, subject }: { email: string; subject?: string }) {
  const url = `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  return <Button label={email} variant="plain" onPress={() => Linking.openURL(url)} />;
}

/** Tap-to-expand question, matching the <details>/<summary> pairs on the
 *  website's support page (site/support/index.html). */
export function DocFAQ({ question, children }: PropsWithChildren<{ question: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((v) => !v)}
      style={styles.faqCard}>
      <View style={styles.faqQuestionRow}>
        <Text variant="headline" style={styles.flex}>
          {question}
        </Text>
        <IconSymbol name={open ? 'chevron.down' : 'chevron.right'} size={ICON.small} color={colors.inkMuted} />
      </View>
      {open ? (
        <Text variant="body" tone="inkMuted">
          {children}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  heading: { marginTop: space.sm },
  bulletRow: { flexDirection: 'row', gap: space.sm, paddingRight: space.sm },
  bulletDot: {
    width: space.xs + 1,
    height: space.xs + 1,
    borderRadius: radius.pill,
    backgroundColor: colors.inkMuted,
    marginTop: space.sm,
  },
  faqCard: {
    minHeight: MIN_TOUCH,
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.sm,
  },
  faqQuestionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
