// "Futty AI": answers questions about how Futty works, from a system prompt
// built from public.app_rules (prompt.ts). Everything outside this file is
// passed in (deps), so tests run it with a mocked model and database.
//
// Tool loop: the model can call check_pitch_availability for real free times
// and prices. It runs as the signed-in player on the venue model
// (venues_free_at, venue_free_slots, booking_quote): live venues only, the
// server's price per player, the player's own booking window. It never
// guesses or computes a price.
import type { Db } from '../_shared/db.ts';
import { type AppRules, euros } from '../_shared/rules.ts';
import { systemBlocks } from './prompt.ts';

export const MAX_TOOL_ITERATIONS = 4;

// Cost controls. Each request re-sends the whole conversation, so both the
// history length and the per-message size are capped, plus a per-user rate
// limit (counted in public.ai_chat_usage).
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 2000;
export const MAX_REQUESTS_PER_HOUR = 20;
export const MAX_REQUESTS_PER_DAY = 60;
const MAX_OUTPUT_TOKENS = 1024;

export const FALLBACK_REPLY =
  "Sorry, I can't help with that one. Ask me anything about booking, paying or playing on Futty.";
const LOOP_REPLY = "Sorry, I'm having trouble with that — try rephrasing?";

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

/** What the Messages API returns, the parts used here. */
export type ModelResponse = { stop_reason: string | null; content: ContentBlock[] };

export type ChatDeps = {
  modelId: string;
  /** Spec 13's rules (public.app_rules), read for each request. */
  rules: () => Promise<AppRules>;
  /** POST /v1/messages with this body. */
  model: (body: Record<string, unknown>) => Promise<ModelResponse>;
  /** Database functions as the signed-in player (their RLS, window, Premium). */
  userDb: Db;
  /** Live venues the player may see, optionally narrowed by city or name. */
  liveVenues: (filter: { city?: string; name?: string }) => Promise<{ id: string; name: string; city: string | null }[]>;
  /** The player's Futty AI requests since an instant, and recording this one. */
  usage: { countSince: (iso: string) => Promise<number>; record: () => Promise<void> };
  /** Today in Cyprus, YYYY-MM-DD. */
  today: () => string;
  now?: () => Date;
};

export type ChatResult = { status: number; body: Record<string, unknown> };

export const CHECK_AVAILABILITY_TOOL = {
  name: 'check_pitch_availability',
  description:
    "Checks REAL pitch availability and prices for a given day and format, optionally at a start time, narrowed by city or venue name. Always use this instead of guessing when a user asks about available times, venues or prices — never state real times, venues or prices without calling this first. Ask the user for whichever of day/format you don't already know before calling it.",
  input_schema: {
    type: 'object',
    properties: {
      day: { type: 'string', description: 'The date to check, as YYYY-MM-DD (Cyprus).' },
      format: { type: 'string', enum: ['5-a-side', '7-a-side', '9-a-side', '11-a-side'], description: 'The game format.' },
      duration_hours: {
        type: 'number',
        enum: [1, 1.5, 2],
        description: 'How long the game should be. Defaults to 1 hour if not specified.',
      },
      start_time: { type: 'string', description: 'Optional — a start time as HH:MM, on the hour or half hour.' },
      players_per_side: {
        type: 'number',
        enum: [5, 6],
        description: 'Optional — 6 for 6 v 6 on a 5-a-side pitch, at venues that allow it. Defaults to 5.',
      },
      city: { type: 'string', description: 'Optional — narrows the search to one city.' },
      venue_name: { type: 'string', description: 'Optional — narrows the search to venues matching this name.' },
    },
    required: ['day', 'format'],
  },
};

type AvailabilityInput = {
  day?: unknown;
  format?: unknown;
  duration_hours?: unknown;
  start_time?: unknown;
  players_per_side?: unknown;
  city?: unknown;
  venue_name?: unknown;
};

const hhmm = (time: string) => time.slice(0, 5);
const matches = (value: string | null, filter: string | undefined) =>
  !filter || (value ?? '').toLowerCase().includes(filter.toLowerCase());

/** Real availability, as the player, from the server. Every price is the server's. */
export async function checkAvailability(deps: ChatDeps, raw: AvailabilityInput): Promise<Record<string, unknown>> {
  const day = typeof raw.day === 'string' ? raw.day : '';
  const format = typeof raw.format === 'string' ? raw.format : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !format) return { error: 'day (YYYY-MM-DD) and format are required' };
  const duration = raw.duration_hours === 1.5 || raw.duration_hours === 2 ? raw.duration_hours : 1;
  const minutes = duration * 60;
  const playersPerSide = raw.players_per_side === 6 ? 6 : 5;
  const city = typeof raw.city === 'string' && raw.city ? raw.city : undefined;
  const name = typeof raw.venue_name === 'string' && raw.venue_name ? raw.venue_name : undefined;

  if (typeof raw.start_time === 'string' && raw.start_time) {
    const { data, error } = await deps.userDb.rpc('venues_free_at', {
      p_day: day, p_start: raw.start_time, p_minutes: minutes, p_format: format, p_players_per_side: playersPerSide,
    });
    if (error) return { error: error.message };
    const venues = ((data ?? []) as { name: string; city: string | null; player_cents: number; next_starts: string[] }[])
      .filter((v) => matches(v.name, name) && matches(v.city, city))
      .map((v) => ({
        venue: v.name,
        city: v.city,
        price_per_player: euros(v.player_cents),
        later_free_times: v.next_starts.map(hhmm),
      }));
    return { day, format, start_time: raw.start_time, duration_hours: duration, players_per_side: playersPerSide, venues };
  }

  const venues = await deps.liveVenues({ city, name });
  const results = [];
  for (const venue of venues) {
    const { data, error } = await deps.userDb.rpc('venue_free_slots', {
      p_venue_id: venue.id, p_day: day, p_format: format, p_minutes: minutes, p_players_per_side: playersPerSide,
    });
    if (error) return { error: error.message };
    const slots = (data ?? []) as { start_time: string; end_time: string }[];
    if (slots.length === 0) continue;
    const first = slots[0];
    const quote = await deps.userDb.rpc('booking_quote', {
      p_venue_id: venue.id, p_day: day, p_start: first.start_time, p_end: first.end_time,
      p_format: format, p_players_per_side: playersPerSide,
    });
    if (quote.error) return { error: quote.error.message };
    const playerCents = (quote.data as { each_pays?: { player_cents?: number } } | null)?.each_pays?.player_cents;
    results.push({
      venue: venue.name,
      city: venue.city,
      free_start_times: slots.map((s) => hhmm(s.start_time)),
      price_per_player_at_first_time: Number.isInteger(playerCents) ? euros(playerCents!) : null,
    });
  }
  return { day, format, duration_hours: duration, players_per_side: playersPerSide, venues: results };
}

type IncomingMessage = { role?: unknown; content?: unknown };

/** The conversation as the API takes it: user/assistant text only, capped, starting with the user. */
export function cleanMessages(messages: unknown): { role: 'user' | 'assistant'; content: string }[] | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const cleaned = (messages as IncomingMessage[])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.content as string).slice(0, MAX_MESSAGE_CHARS) }));
  while (cleaned.length > 0 && cleaned[0].role !== 'user') cleaned.shift();
  return cleaned.length > 0 ? cleaned : null;
}

export async function chat(deps: ChatDeps, body: { messages?: unknown }): Promise<ChatResult> {
  const cleaned = cleanMessages(body.messages);
  if (!cleaned) return { status: 400, body: { error: 'Missing messages' } };

  const now = (deps.now ?? (() => new Date()))();
  const [lastHour, lastDay] = await Promise.all([
    deps.usage.countSince(new Date(now.getTime() - 60 * 60 * 1000).toISOString()),
    deps.usage.countSince(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (lastHour >= MAX_REQUESTS_PER_HOUR || lastDay >= MAX_REQUESTS_PER_DAY) {
    return { status: 429, body: { error: "You've sent a lot of messages — please try again a bit later." } };
  }
  await deps.usage.record();

  // The rules first: with no rules, no answer (never stale or guessed numbers).
  const rules = await deps.rules();
  const system = systemBlocks(rules, deps.today());
  // deno-lint-ignore no-explicit-any
  const messages: any[] = cleaned;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await deps.model({
      model: deps.modelId,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages,
      tools: [CHECK_AVAILABILITY_TOOL],
    });

    if (response.stop_reason === 'refusal') return { status: 200, body: { reply: FALLBACK_REPLY } };

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { status: 200, body: { reply: text || FALLBACK_REPLY } };
    }

    // Append the whole content (thinking blocks included) before the results.
    messages.push({ role: 'assistant', content: response.content });
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const use = block as { id: string; name: string; input: Record<string, unknown> };
      const result = use.name === CHECK_AVAILABILITY_TOOL.name
        ? await checkAvailability(deps, use.input)
        : { error: `Unknown tool ${use.name}` };
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result),
        ...('error' in result ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { status: 200, body: { reply: LOOP_REPLY } };
}
