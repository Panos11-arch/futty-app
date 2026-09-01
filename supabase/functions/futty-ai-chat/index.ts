// "Futty AI" — an in-app assistant scoped to answering questions about how
// Futty itself works (booking, leagues, XP/scoring, Premium, community).
// Uses the Anthropic Messages API directly via fetch rather than the
// @anthropic-ai/sdk package — Supabase's own docs list the SDK as Deno-
// compatible, but the API itself is a plain JSON REST endpoint with no
// complex crypto (unlike Apple's JWS or Stripe's webhook signing), so a
// direct fetch call is simpler and has nothing SDK-specific to break.
//
// Tool-calling loop: the model can call check_pitch_availability to answer
// questions like "when's the next free 5-a-side pitch in Nicosia" with a
// REAL answer computed from live venue_bookings data — never a guess. The
// system prompt is written to match verified actual app behavior (e.g. XP
// only ever decreases via dispute penalties, confirmed directly against
// supabase/scores.sql — there is no win/draw XP reward to describe).

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')!;

const MODEL = 'claude-sonnet-5';
const MAX_TOOL_ITERATIONS = 4;

// Mirrors lib/booking.ts exactly (CAPACITY_OPTIONS, buildSlotGrid) — kept as
// a separate copy rather than a shared import since that file also pulls in
// nothing Deno-incompatible, but duplicating these ~15 lines is simpler than
// setting up a cross-runtime shared module for this one function.
const CAPACITY_OPTIONS = [
  { capacity: 10, format: '5-a-side', pitches: 1 },
  { capacity: 14, format: '7-a-side', pitches: 2 },
  { capacity: 18, format: '9-a-side', pitches: 3 },
  { capacity: 22, format: '11-a-side', pitches: 4 },
];
const SLOT_STEP_MINUTES = 30;

function timeToMin(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}
function minToTime(min: number) {
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const SYSTEM_PROMPT = `You are "Futty AI", an in-app assistant for Futty — a pitch-booking and football league/team app for Cyprus. Today's date is ${new Date().toISOString().slice(0, 10)}.

ONLY answer questions about how the Futty app works. If asked anything unrelated (general chat, other topics, coding help, etc.), politely decline and redirect to app-related help.

Accurate facts about how the app actually works — do not contradict these or guess beyond them:

BOOKING A PITCH
- Flow: pick a day, then city, then duration (1h / 1h30 / 2h), then format (5/7/9/11-a-side), then venue, then an open time slot.
- Standard accounts can book up to 2 days ahead. Personal Premium unlocks up to 21 days ahead.
- If the venue has a price, payment (card, via Stripe) happens at booking time. Free venues confirm instantly.
- Cancelling is allowed up to 30 minutes before kickoff, and refunds automatically if it was paid. Within 30 minutes of kickoff, cancellation is blocked.
- Use the check_pitch_availability tool whenever a user asks about available times/venues — never guess at real availability, always check it.

XP AND SCORING
- Played/won/drawn/lost/goals are tracked accurately for every match (friendly and league).
- XP currently only ever DECREASES: a player or team loses 20 XP as a penalty for repeatedly disputing a score (submitting inconsistent numbers three times without the two sides agreeing). A league team whose captain racks up 3+ such disputes also loses league standings points.
- There is no reward for winning or drawing a match — winning/drawing does not add XP. If asked "how much XP do I get for winning", say clearly that wins/draws are tracked for your record but don't currently add XP, and that XP only moves via the dispute penalty above.

PERSONAL PREMIUM
- €4.99/month subscription via Apple. Unlocks booking up to 21 days ahead and a verified badge.
- Cancel via Settings > Apple ID > Subscriptions on the device (the app links there) — access continues until the paid period ends.

TEAM PREMIUM
- A one-time purchase per team, required only to register that team for 9-a-side (€45) or 11-a-side (€59) leagues. 5-a-side and 7-a-side leagues don't need it.
- If refunded, the team loses access to that format and forfeits any remaining fixtures in an in-progress season (past results stay on the table).

LEAGUES
- Joining a league auto-generates a round-robin fixture list against every other team in it.
- Each fixture: the two captains each propose a day/time/venue; it's agreed once both sides' latest proposal matches exactly.
- After the match, either captain submits the score; if both sides' latest submissions match, it's confirmed. Otherwise it can take up to 3 attempts before the score is locked as unresolved.

COMMUNITY
- You can follow players and teams, and block or report a player from the Community tab. Fixture chat has its own report option (blocking isn't available there, only report, since chat messages are attributed to a team, not one person).

SQUADS
- From a booking, you can post "need players" or "need opposition" to find people/teams for that specific game slot.

Keep answers short and conversational — this is a small in-app helper, not a long-form document.`;

const CHECK_AVAILABILITY_TOOL = {
  name: 'check_pitch_availability',
  description:
    "Checks REAL pitch availability for a given day and format, optionally narrowed by city or venue name. Always use this instead of guessing when a user asks about available times or venues — never state real times/venues without calling this first. Ask the user for whichever of day/format/city you don't already know before calling it, unless they've already given you a specific query.",
  input_schema: {
    type: 'object',
    properties: {
      day: { type: 'string', description: 'The date to check, as YYYY-MM-DD.' },
      format: {
        type: 'string',
        enum: ['5-a-side', '7-a-side', '9-a-side', '11-a-side'],
        description: 'The game format, which determines how many pitches are needed.',
      },
      duration_hours: {
        type: 'number',
        enum: [1, 1.5, 2],
        description: 'How long the game should be. Defaults to 1 hour if not specified.',
      },
      city: { type: 'string', description: 'Optional — narrows the search to one city.' },
      venue_name: { type: 'string', description: 'Optional — narrows the search to venues matching this name.' },
    },
    required: ['day', 'format'],
  },
};

async function checkPitchAvailability(
  supabase: ReturnType<typeof createClient>,
  input: { day: string; format: string; duration_hours?: number; city?: string; venue_name?: string }
) {
  const option = CAPACITY_OPTIONS.find((o) => o.format === input.format);
  if (!option) return { error: `Unknown format "${input.format}".` };
  const durationMin = (input.duration_hours ?? 1) * 60;

  let query = supabase
    .from('venues')
    .select('id, name, city, base_pitches, open_time, close_time, price_per_pitch_hour');
  if (input.city) query = query.ilike('city', `%${input.city}%`);
  if (input.venue_name) query = query.ilike('name', `%${input.venue_name}%`);

  const { data: venues, error: venuesError } = await query;
  if (venuesError) return { error: venuesError.message };
  if (!venues || venues.length === 0) return { venues: [], note: 'No venues matched that search.' };

  const results = [];
  for (const venue of venues as {
    id: string;
    name: string;
    city: string;
    base_pitches: number;
    open_time: string;
    close_time: string;
    price_per_pitch_hour: number | null;
  }[]) {
    if (venue.base_pitches < option.pitches) continue; // can't fit this format at all

    const { data: bookings } = await supabase
      .from('venue_bookings')
      .select('start_time, end_time, pitches')
      .eq('venue_id', venue.id)
      .eq('booking_day', input.day)
      .neq('status', 'cancelled');

    const openMin = timeToMin(venue.open_time);
    const closeMin = timeToMin(venue.close_time);
    const freeSlots: string[] = [];

    for (let start = openMin; start + durationMin <= closeMin; start += SLOT_STEP_MINUTES) {
      const end = start + durationMin;
      let used = 0;
      for (const b of bookings ?? []) {
        const bStart = timeToMin(b.start_time as string);
        const bEnd = timeToMin(b.end_time as string);
        if (bStart < end && bEnd > start) used += b.pitches as number;
      }
      if (venue.base_pitches - used >= option.pitches) freeSlots.push(minToTime(start));
    }

    if (freeSlots.length > 0) {
      results.push({
        venue: venue.name,
        city: venue.city,
        price_per_pitch_hour: venue.price_per_pitch_hour,
        free_start_times: freeSlots,
      });
    }
  }

  return { day: input.day, format: input.format, duration_hours: input.duration_hours ?? 1, results };
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

async function callAnthropic(messages: unknown[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
      tools: [CHECK_AVAILABILITY_TOOL],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  return res.json();
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabaseAsUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabaseAsUser.auth.getUser();
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401 });

  let body: { messages?: { role: 'user' | 'assistant'; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  if (!body.messages || body.messages.length === 0) {
    return new Response('Missing messages', { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  const messages: any[] = body.messages.map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      // deno-lint-ignore no-explicit-any
      const response: any = await callAnthropic(messages);
      const content = response.content as AnthropicContentBlock[];

      if (response.stop_reason !== 'tool_use') {
        const text = content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        return new Response(JSON.stringify({ reply: text }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      messages.push({ role: 'assistant', content });

      const toolResults = [];
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        const result =
          block.name === 'check_pitch_availability'
            ? await checkPitchAvailability(supabaseAsUser, block.input as never)
            : { error: `Unknown tool ${block.name}` };
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    return new Response(JSON.stringify({ reply: "Sorry, I'm having trouble with that — try rephrasing?" }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

/*
DEPLOYMENT:

1. Set the Anthropic API key:
     supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

2. Deploy:
     supabase functions deploy futty-ai-chat
*/
