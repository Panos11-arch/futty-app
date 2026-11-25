// Futty AI replies: a small Markdown subset of our own (F9), so players never
// see raw asterisks.
import { parseReply } from '@/lib/futty-ai-markdown';

describe('parseReply', () => {
  it('bold text, with no asterisks left', () => {
    expect(parseReply('Book with **Pay for everyone** today.')).toEqual([
      {
        kind: 'paragraph',
        inline: [
          { text: 'Book with ', bold: false },
          { text: 'Pay for everyone', bold: true },
          { text: ' today.', bold: false },
        ],
      },
    ]);
  });

  it('bullet lists, with -, * or •', () => {
    expect(parseReply('Ways to pay:\n- Pay for everyone\n* Pay for myself\n• Cash at the venue')).toEqual([
      { kind: 'paragraph', inline: [{ text: 'Ways to pay:', bold: false }] },
      { kind: 'bullet', inline: [{ text: 'Pay for everyone', bold: false }] },
      { kind: 'bullet', inline: [{ text: 'Pay for myself', bold: false }] },
      { kind: 'bullet', inline: [{ text: 'Cash at the venue', bold: false }] },
    ]);
  });

  it('numbered lists keep their numbers', () => {
    expect(parseReply('1. Pick a time\n2) **Pay**')).toEqual([
      { kind: 'numbered', number: 1, inline: [{ text: 'Pick a time', bold: false }] },
      { kind: 'numbered', number: 2, inline: [{ text: 'Pay', bold: true }] },
    ]);
  });

  it('keeps line breaks inside a paragraph and splits paragraphs on blank lines', () => {
    expect(parseReply('Line one\nline two\n\nNext paragraph')).toEqual([
      { kind: 'paragraph', inline: [{ text: 'Line one\nline two', bold: false }] },
      { kind: 'paragraph', inline: [{ text: 'Next paragraph', bold: false }] },
    ]);
  });

  it('never shows a stray or unmatched asterisk, or a heading mark', () => {
    const all = (md: string) =>
      parseReply(md)
        .flatMap((b) => b.inline)
        .map((i) => i.text)
        .join('|');
    expect(all('This is **not closed')).toBe('This is not closed');
    expect(all('an *italic* word and a lone * star')).toBe('an italic word and a lone  star');
    expect(all('**')).toBe('');
    expect(all('### Booking')).toBe('Booking');
    expect(parseReply('### Booking')[0].inline[0].bold).toBe(true);
  });

  it('__bold__ counts as bold too', () => {
    expect(parseReply('__Losers pay__')[0].inline).toEqual([{ text: 'Losers pay', bold: true }]);
  });

  it('an empty reply has no blocks', () => {
    expect(parseReply('')).toEqual([]);
    expect(parseReply('\n\n')).toEqual([]);
  });
});

// S13A: links in answers.
describe('links', () => {
  it('[text](https://...) is a link with its text', () => {
    expect(parseReply('Read the [Terms](https://futty.app/terms/) first.')[0].inline).toEqual([
      { text: 'Read the ', bold: false },
      { text: 'Terms', bold: false, href: 'https://futty.app/terms/' },
      { text: ' first.', bold: false },
    ]);
  });

  it('a bare https link is a link, without the full stop after it', () => {
    expect(parseReply('See https://futty.app.')[0].inline).toEqual([
      { text: 'See ', bold: false },
      { text: 'https://futty.app', bold: false, href: 'https://futty.app' },
      { text: '.', bold: false },
    ]);
  });

  it('mailto links work; any other scheme stays plain text', () => {
    expect(parseReply('[Email us](mailto:support@futty.app)')[0].inline).toEqual([
      { text: 'Email us', bold: false, href: 'mailto:support@futty.app' },
    ]);
    expect(parseReply('[tap](javascript:alert(1))')[0].inline.some((i) => 'href' in i)).toBe(false);
  });

  it('links inside list items, bold next to links, and no asterisks in link text', () => {
    expect(parseReply('- **Pay** at [the page](https://futty.app/pay)')[0]).toEqual({
      kind: 'bullet',
      inline: [
        { text: 'Pay', bold: true },
        { text: ' at ', bold: false },
        { text: 'the page', bold: false, href: 'https://futty.app/pay' },
      ],
    });
    expect(parseReply('[*Terms*](https://futty.app/terms/)')[0].inline).toEqual([
      { text: 'Terms', bold: false, href: 'https://futty.app/terms/' },
    ]);
  });
});
