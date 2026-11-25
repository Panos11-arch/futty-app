// S13A: Futty AI's answer format. The system prompt (prompt.ts) asks the
// model to end an answer with up to two [[action:tag]] tags; here they come
// off the text and become action buttons. Only tags on the whitelist are
// kept (the app opens a fixed screen for each); unknown ones are dropped and
// no tag is ever shown as text.

/** The screens an action button can open, as the app knows them (lib/futty-ai.ts). */
export const AI_ACTIONS = ['book', 'my_bookings', 'payments', 'premium', 'find_game', 'leagues', 'settings', 'contact_support'] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

export const MAX_ACTIONS = 2;
export const MAX_TITLE_CHARS = 80;

const TAG = /[ \t]*\[\[\s*action\s*:\s*([a-z_]*)\s*\]\]/gi;

function isAction(tag: string): tag is AiAction {
  return (AI_ACTIONS as readonly string[]).includes(tag);
}

/** The answer's text with every action tag removed, and its valid actions (at most two, in order). */
export function splitAnswer(raw: string): { text: string; actions: AiAction[] } {
  const actions: AiAction[] = [];
  for (const match of raw.matchAll(TAG)) {
    const tag = match[1].toLowerCase();
    if (isAction(tag) && !actions.includes(tag) && actions.length < MAX_ACTIONS) actions.push(tag);
  }
  const text = raw
    .replace(TAG, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, actions };
}

/** A chat's title: the first line of the first question, at most 80 characters; "Photo" for a photo alone. */
export function titleFrom(question: string): string {
  const line = (question.split(/\r?\n/).find((l) => l.trim() !== '') ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return 'Photo';
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line;
}
