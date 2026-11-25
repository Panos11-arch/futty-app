import { Linking, View } from 'react-native';

import { Text, type TextTone } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { type Block, parseReply } from '@/lib/futty-ai-markdown';
import { makeStyles } from '@/lib/theme';

/**
 * Futty AI's answer: our own renderer for the model's Markdown subset
 * (lib/futty-ai-markdown.ts): bold, bullet and numbered lists, line breaks
 * and links. An asterisk is never shown raw.
 */
export function AiMarkdown({ text, tone = 'ink' }: { text: string; tone?: TextTone }) {
  const styles = useStyles();

  const inline = (block: Block) =>
    block.inline.map((part, i) =>
      part.href ? (
        <Text
          key={i}
          variant="body"
          tone={tone}
          style={styles.link}
          accessibilityRole="link"
          testID="ai-link"
          onPress={() => void Linking.openURL(part.href as string).catch(() => {})}>
          {part.text}
        </Text>
      ) : (
        <Text key={i} variant="body" tone={tone} style={part.bold ? styles.bold : undefined}>
          {part.text}
        </Text>
      )
    );

  return (
    <View style={styles.blocks}>
      {parseReply(text).map((block, i) =>
        block.kind === 'paragraph' ? (
          <Text key={i} variant="body" tone={tone}>
            {inline(block)}
          </Text>
        ) : (
          <View key={i} style={styles.listRow} testID={block.kind === 'bullet' ? 'ai-bullet' : 'ai-numbered'}>
            <Text variant="body" tone={tone} tabular>
              {block.kind === 'bullet' ? '•' : `${block.number}.`}
            </Text>
            <Text variant="body" tone={tone} style={styles.flex}>
              {inline(block)}
            </Text>
          </View>
        )
      )}
    </View>
  );
}

const useStyles = makeStyles(({ type }) => ({
  blocks: { gap: space.xs },
  listRow: { flexDirection: 'row', gap: space.xs },
  flex: { flex: 1 },
  bold: { fontFamily: type.headline.fontFamily },
  // Underlined, in the text's own colour (green is never text on white).
  link: { textDecorationLine: 'underline' },
}));
