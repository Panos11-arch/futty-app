import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { AiMarkdown } from '@/components/futty-ai/ai-markdown';
import { Button } from '@/components/ui/button';
import { FuttyLogo } from '@/components/ui/futty-logo';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import type { AiActionButton } from '@/lib/futty-ai';
import { makeStyles } from '@/lib/theme';

const AVATAR = space.xl;
const THUMB = space.xxl * 2 + space.lg;

export type AiPhoto = { key: string; uri: string | null };

/** Futty AI's answer, on the left with the Futty logo as its avatar, then up to two action buttons. */
export function AiAnswer({
  body,
  actions,
  showAvatar,
  firstInGroup,
  onAction,
}: {
  body: string;
  actions: AiActionButton[];
  /** The last of a run of answers gets the avatar. */
  showAvatar: boolean;
  firstInGroup: boolean;
  onAction: (action: AiActionButton) => void;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.row, firstInGroup && styles.groupStart]} testID="ai-answer">
      <View style={styles.avatar} testID={showAvatar ? 'ai-avatar' : undefined}>
        {showAvatar ? <FuttyLogo size={AVATAR} /> : null}
      </View>
      <View style={styles.answerColumn}>
        <View style={[styles.bubble, styles.theirs, showAvatar && styles.tailTheirs]} accessible accessibilityLabel={`Futty AI: ${body}`}>
          <AiMarkdown text={body} />
        </View>
        {actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((a) => (
              <Button
                key={a.tag}
                testID={`ai-action-${a.tag.replace(/_/g, '-')}`}
                label={a.label}
                variant="secondary"
                size="compact"
                onPress={() => onAction(a)}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** My message, on the right on green: its photos, its text, and "Sent · Just now" under the latest. */
export function MyAiMessage({
  body,
  photos,
  sent,
  pending,
  firstInGroup,
  onOpenPhoto,
}: {
  body: string;
  photos: AiPhoto[];
  /** Only under my latest message. */
  sent: string | null;
  pending?: 'sending' | 'failed';
  firstInGroup: boolean;
  onOpenPhoto: (uri: string) => void;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.row, styles.rowMine, firstInGroup && styles.groupStart]} testID="ai-mine">
      <View style={[styles.bubble, styles.mine, pending === 'sending' && styles.sending]}>
        {photos.length > 0 ? (
          <View style={styles.photos}>
            {photos.map((p, i) => (
              <Pressable
                key={p.key}
                testID="ai-photo"
                accessibilityRole="imagebutton"
                accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
                disabled={!p.uri}
                onPress={() => p.uri && onOpenPhoto(p.uri)}>
                {p.uri ? (
                  <Image source={{ uri: p.uri }} contentFit="cover" style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbLoading]} />
                )}
              </Pressable>
            ))}
          </View>
        ) : null}
        {body ? (
          <Text variant="body" tone="greenInk">
            {body}
          </Text>
        ) : null}
      </View>
      {pending === 'failed' ? (
        <Text variant="caption" tone="danger" style={styles.meta} testID="ai-not-sent">
          Not sent
        </Text>
      ) : sent ? (
        <Text variant="caption" tone="inkMuted" style={styles.meta} testID="ai-sent">
          {sent}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, paddingHorizontal: space.md, paddingTop: space.xs / 2 },
  rowMine: { flexDirection: 'column', alignItems: 'flex-end' },
  groupStart: { paddingTop: space.md },
  avatar: { width: AVATAR, height: AVATAR },
  answerColumn: { flexShrink: 1, maxWidth: '82%', gap: space.xs },
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.xs,
  },
  theirs: { maxWidth: '100%', backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border },
  tailTheirs: { borderBottomLeftRadius: space.xs },
  mine: { backgroundColor: colors.green, borderBottomRightRadius: space.xs },
  sending: { opacity: 0.7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.control },
  thumbLoading: { backgroundColor: colors.greenSoft },
  meta: { paddingTop: space.xs / 2 },
}));
