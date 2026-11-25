// Futty AI replies come back as Markdown. The app renders a small subset of
// it itself (F9, no new dependency): bold, bullet and numbered lists, line
// breaks and links (S13A). Everything else is shown as plain text, and an asterisk is
// never shown raw, matched or not. Headings ("### ...") become a bold line.

/** A run of text; `href` only on a link (https or mailto, S13A). */
export type Inline = { text: string; bold: boolean; href?: string };
export type Block =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'bullet'; inline: Inline[] }
  | { kind: 'numbered'; number: number; inline: Inline[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

// Bold (**x**, __x__); a link [text](https://... or mailto:...); a bare
// https link, without the punctuation that ends its sentence.
const INLINE =
  /\*\*(.+?)\*\*|__(.+?)__|\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|(https?:\/\/[^\s)]*[^\s).,!?;:'"])/g;

/** Bold spans and links; any other asterisk is dropped. */
export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), bold: false });
    if (match[3] !== undefined) parts.push({ text: match[3], bold: false, href: match[4] });
    else if (match[5] !== undefined) parts.push({ text: match[5], bold: false, href: match[5] });
    else parts.push({ text: match[1] ?? match[2], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts
    .map((p) => ({ ...p, text: p.text.replace(/\*/g, '') }))
    .filter((p) => p.text !== '');
}

export function parseReply(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      const inline = parseInline(paragraph.join('\n'));
      if (inline.length > 0) blocks.push({ kind: 'paragraph', inline });
      paragraph = [];
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = line.match(HEADING);
    const numbered = line.match(NUMBERED);
    const bullet = line.match(BULLET);
    if (heading) {
      flush();
      const text = heading[1].replace(/\*/g, '').trim();
      if (text) blocks.push({ kind: 'paragraph', inline: [{ text, bold: true }] });
    } else if (numbered) {
      flush();
      blocks.push({ kind: 'numbered', number: Number(numbered[1]), inline: parseInline(numbered[2]) });
    } else if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', inline: parseInline(bullet[1]) });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
