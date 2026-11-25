// S13A: Futty AI's answer format. The model ends an answer with up to two
// [[action:tag]] tags from a fixed whitelist; the server turns them into
// action buttons and never shows a tag as text.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { AI_ACTIONS, splitAnswer, titleFrom } from './answer.ts';

Deno.test('the whitelist is exactly the eight screens the app can open', () => {
  deepStrictEqual([...AI_ACTIONS], ['book', 'my_bookings', 'payments', 'premium', 'find_game', 'leagues', 'settings', 'contact_support']);
});

Deno.test('actions come off the answer, in order, and the text keeps its Markdown', () => {
  deepStrictEqual(splitAnswer('Tap **Book a pitch** on Home.\n\n1. Pick a time\n2. Pay\n\n[[action:book]] [[action:my_bookings]]'), {
    text: 'Tap **Book a pitch** on Home.\n\n1. Pick a time\n2. Pay',
    actions: ['book', 'my_bookings'],
  });
});

Deno.test('unknown tags are dropped, never shown', () => {
  deepStrictEqual(splitAnswer('Done. [[action:delete_account]] [[action:payments]] [[action:]]'), {
    text: 'Done.',
    actions: ['payments'],
  });
});

Deno.test('at most two actions, no repeats, any case or spacing', () => {
  deepStrictEqual(splitAnswer('Ok [[ action : Premium ]] [[action:premium]] [[action:book]] [[action:leagues]]'), {
    text: 'Ok',
    actions: ['premium', 'book'],
  });
});

Deno.test('an answer with no tags is unchanged', () => {
  deepStrictEqual(splitAnswer('  Hello there.  '), { text: 'Hello there.', actions: [] });
});

Deno.test('a tag in the middle of a line leaves no gap behind', () => {
  strictEqual(splitAnswer('Open payments [[action:payments]] to pay.').text, 'Open payments to pay.');
});

Deno.test('the title is the first question: one line, at most 80 characters', () => {
  strictEqual(titleFrom('  How do I   book a pitch?\nThanks '), 'How do I book a pitch?');
  strictEqual(titleFrom('a'.repeat(100)), `${'a'.repeat(79)}…`);
  strictEqual(titleFrom(''), 'Photo');
  strictEqual(titleFrom('   \n  '), 'Photo');
});
