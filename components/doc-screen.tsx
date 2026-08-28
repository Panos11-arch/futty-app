import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';

/** Shared layout for the plain-text screens under the account menu's Support
 *  and Legal Information sections (Help, How Futty Works, Terms of Use,
 *  Privacy Policy) — native views rather than a WebView loading docs/*.html,
 *  so these read in the app's own type/spacing instead of a plain browser
 *  page, and don't need react-native-webview added as a new dependency. */
export function DocScreen({ updated, children }: PropsWithChildren<{ updated?: string }>) {
  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {updated ? <ThemedText style={styles.updated}>Last updated: {updated}</ThemedText> : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function DocHeading({ children }: PropsWithChildren) {
  return <ThemedText style={styles.heading}>{children}</ThemedText>;
}

export function DocParagraph({ children }: PropsWithChildren) {
  return <ThemedText style={styles.paragraph}>{children}</ThemedText>;
}

export function DocBullet({ children }: PropsWithChildren) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <ThemedText style={styles.bulletText}>{children}</ThemedText>
    </View>
  );
}

export function DocEmailLink({ email, subject }: { email: string; subject?: string }) {
  const url = `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  return (
    <Pressable accessibilityRole="button" onPress={() => Linking.openURL(url)}>
      <IconLabel icon="envelope.fill" type="link" iconColor={FuttyColors.emerald700}>
        {email}
      </IconLabel>
    </Pressable>
  );
}

/** Tap-to-expand question, matching the <details>/<summary> pairs in the old
 *  docs/support.html. */
export function DocFAQ({ question, children }: PropsWithChildren<{ question: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable accessibilityRole="button" onPress={() => setOpen((v) => !v)} style={styles.faqCard}>
      <View style={styles.faqQuestionRow}>
        <ThemedText type="defaultSemiBold" style={styles.faqQuestion}>
          {question}
        </ThemedText>
        <IconSymbol name={open ? 'chevron.down' : 'chevron.right'} size={16} color={FuttyColors.stone500} />
      </View>
      {open ? <ThemedText style={styles.faqAnswer}>{children}</ThemedText> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 12,
    padding: 16,
    paddingBottom: 48,
  },
  updated: {
    fontSize: 12,
    color: FuttyColors.stone400,
    marginBottom: 4,
  },
  heading: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 16,
    color: FuttyColors.emerald950,
    marginTop: 8,
  },
  paragraph: {
    fontFamily: FuttyFonts.sans,
    fontSize: 14,
    color: FuttyColors.stone700,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 8,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: FuttyColors.emerald700,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontFamily: FuttyFonts.sans,
    fontSize: 14,
    color: FuttyColors.stone700,
    lineHeight: 20,
  },
  faqCard: {
    backgroundColor: FuttyColors.white,
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  faqQuestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  faqQuestion: {
    flex: 1,
    fontSize: 14,
    color: FuttyColors.emerald950,
  },
  faqAnswer: {
    fontFamily: FuttyFonts.sans,
    fontSize: 13,
    color: FuttyColors.stone500,
    lineHeight: 19,
  },
});
