// P10: the Futty AI's system prompt comes from public.app_rules and spec 13.
// 22 real player questions, each with the facts its answer needs; every
// question goes through the handler to a mocked model, and the system prompt
// it was sent must carry those facts, built from the rules (so they follow a
// rule change with no code change). Plus: prompt caching, the tool loop on
// the venue model, refusals and rate limits.
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { type AppRules, days, euros, hours, minutes, months } from '../_shared/rules.ts';
import { CHANGED_RULES, SPEC_RULES } from '../_shared/rules.fixtures.ts';
import { chat, type ChatDeps, checkAvailability, FALLBACK_REPLY, type ModelResponse } from './handler.ts';
import { buildSystemPrompt } from './prompt.ts';

type Fake = {
  deps: ChatDeps;
  requests: Record<string, unknown>[];
  db: ReturnType<typeof createDbFake>;
  recorded: number;
};

function fake(rules: AppRules, replies: ModelResponse[] = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sure.' }] }], used = 0): Fake {
  const db = createDbFake();
  const requests: Record<string, unknown>[] = [];
  const f: Fake = {
    db,
    requests,
    recorded: 0,
    deps: {
      modelId: 'claude-sonnet-5-5',
      rules: () => Promise.resolve(rules),
      model: (body) => {
        requests.push(structuredClone(body));
        return Promise.resolve(replies[Math.min(requests.length - 1, replies.length - 1)]);
      },
      userDb: db.db,
      liveVenues: () => Promise.resolve([{ id: 'v1', name: 'Nuevo Campo', city: 'Nicosia' }]),
      usage: {
        countSince: () => Promise.resolve(used),
        record: () => {
          f.recorded += 1;
          return Promise.resolve();
        },
      },
      today: () => '2026-11-16',
      now: () => new Date('2026-11-16T10:00:00Z'),
    },
  };
  return f;
}

const systemTexts = (request: Record<string, unknown>) => (request.system as { text: string }[]).map((b) => b.text);

/** 22 real player questions and the facts the prompt must give the model for each. */
const QUESTIONS: { question: string; facts: (r: AppRules) => string[] }[] = [
  {
    question: 'Can I get my money back if I cancel 3 hours before?',
    facts: (r) => [`Less than ${hours(r.refund_cutoff_hours)} before kickoff: nothing back.`],
  },
  {
    question: 'What happens if only 8 of us turn up?',
    facts: (r) => [
      'the players who joined split the full pitch price',
      `charged as a top-up ${hours(r.collection_delay_hours)} after the match`,
      'a no-show still owes their share',
    ],
  },
  {
    question: "Why can't I book?",
    facts: () => [
      "can't book, join a booking or choose cash anywhere on Futty until it's paid",
      'an unpaid debt is the most likely reason',
      '"Pay what I owe"',
    ],
  },
  {
    question: 'How much is Premium?',
    facts: (r) => [`${r.premium_price_label} a month, a subscription via Apple`],
  },
  {
    question: "What's the difference between paying for everyone and each paying?",
    facts: (r) => [
      `the booker pays the whole pitch in one payment, plus a ${euros(r.fee_pay_all_cents)} per player service fee`,
      `plus a ${euros(r.fee_each_pays_cents)} per player service fee`,
    ],
  },
  {
    question: 'What does "I\'m responsible for the team" mean?',
    facts: (r) => [
      `The booker's card is held for the full pitch price ${hours(r.guarantee_hold_lead_hours)} before kickoff`,
      `anything still unpaid ${hours(r.collection_delay_hours)} after the match is taken from that hold`,
    ],
  },
  {
    question: 'In "just my spot", what if someone never pays?',
    facts: () => ["a player who doesn't pay goes into debt to the venue"],
  },
  {
    question: "What's the service fee?",
    facts: (r) => [
      `Service fee: ${euros(r.fee_each_pays_cents)} per player when each pays, ${euros(r.fee_pay_all_cents)} per player when the booker pays for everyone.`,
      r.fee_premium_cents === 0 ? 'no service fee on their own spot' : `a ${euros(r.fee_premium_cents)} service fee on their own spot`,
    ],
  },
  {
    question: 'Can I pay cash?',
    facts: () => [
      'a player can pay their part in cash at the venue; they still pay the service fee by card in the app',
      "Cash can't be combined with venue credit.",
    ],
  },
  {
    question: 'How long does venue credit last?',
    facts: (r) => [
      `It expires ${months(r.credit_expiry_months)} after it's issued.`,
      'Credit can only be spent at the venue that issued it',
    ],
  },
  {
    question: 'If I cancel straight after booking, do I get everything back?',
    facts: (r) => [
      `Within ${minutes(r.free_cancel_minutes)} of paying (booked more than ${hours(r.refund_cutoff_hours)} before kickoff): everything back`,
      `From then until ${hours(r.refund_cutoff_hours)} before kickoff: ${euros(r.cancel_fee_cents)} is kept and the rest becomes venue credit`,
    ],
  },
  {
    question: 'What happens if the venue cancels our game?',
    facts: (r) => [
      'The venue cancels: every player gets their full share back.',
      `chooses a card refund (5–10 working days) or venue credit within ${hours(r.refund_choice_hours)}`,
    ],
  },
  {
    question: 'Can we play 6 v 6 on a 5-a-side pitch?',
    facts: (r) => [
      '"Players per side: 5 v 5 / 6 v 6"',
      `only the booker can switch a 5-a-side booking between 5 v 5 and 6 v 6, once, from the booking screen, until ${hours(r.refund_cutoff_hours)} before kickoff`,
      'Every player is told.',
    ],
  },
  {
    question: "We booked 5 v 5 but there are 12 of us. What happens to our money if we switch?",
    facts: (r) => [
      'each player who has paid gets the difference in their share of the pitch price back as venue credit',
      'Example only: on a €60 pitch, €6.00 a player becomes €5.00, so €1.00 each.',
      `it is not the ${euros(r.cancel_fee_cents)} cancellation fee`,
      "A cash player the venue hasn't marked as paid gets no credit and pays less in cash instead",
      'When the booker paid for everyone, switching moves no money.',
    ],
  },
  {
    question: 'Only 9 of us are coming now. Can we go back from 6 v 6 to 5 v 5?',
    facts: () => [
      '6 v 6 to 5 v 5 (only while 10 or fewer players have joined)',
      'including cash already marked as paid at the venue, pays the difference after the match, charged to their saved card with the top-ups',
      `the booker's hold covers it ("I'm responsible for the team") or it becomes the player's debt to the venue ("just my spot")`,
      'A booking can be switched only once.',
    ],
  },
  {
    question: 'How does Gipedo Pano work?',
    facts: (r) => [
      'a team booking where the losing team pays for the pitch',
      `held for the pitch price plus ${euros(r.gipedo_fee_cents)} per player`,
      `It can be booked at most ${days(r.gipedo_max_days)} ahead and at least ${hours(r.gipedo_opponent_hours)} before kickoff.`,
    ],
  },
  {
    question: 'Why do I have to accept "non-refundable"?',
    facts: (r) => [
      `A share paid less than ${hours(r.refund_cutoff_hours)} before kickoff is taken straight away, and the player must first accept "This booking is non-refundable".`,
    ],
  },
  {
    question: 'How far ahead can I book?',
    facts: (r) => [
      `Standard accounts book up to ${days(r.window_standard_days)} ahead; Personal Premium books up to ${days(r.window_premium_days)} ahead.`,
    ],
  },
  {
    question: 'How do I pay what I owe?',
    facts: () => ['Account > Your Payments > Debt and credit > "Pay what I owe"', 'Paying a debt adds no extra fee.'],
  },
  {
    question: 'Will I be warned about bad weather?',
    facts: (r) => [
      `a rain chance of ${r.weather_rain_chance_pct}% or more`,
      `wind of ${r.weather_wind_kmh} km/h or more`,
      `${r.weather_heat_c}°C or hotter`,
      '"Heavy rain forecast.", "Strong wind forecast.", "Thunderstorms forecast." or "Extreme heat forecast."',
      '"The venue may cancel this booking."',
      'It only warns; it never promises a cancellation.',
      'Forecast available closer to the date',
      'A venue can warn that conditions may be unsuitable',
      `cancel at least ${hours(r.refund_cutoff_hours)} before kickoff to keep their money as venue credit`,
    ],
  },
  {
    question: 'Our captain cancelled the whole game. What does it cost him?',
    facts: (r) => [
      `the booker pays ${euros(r.cancel_fee_cents)} for each other player whose payment was already taken (only when cancelled more than ${hours(r.refund_cutoff_hours)} before kickoff)`,
    ],
  },
  {
    question: "What if I don't finish paying for my booking?",
    facts: (r) => [
      `The booker must finish paying within ${minutes(r.payment_window_minutes)} of booking, otherwise the booking is cancelled and the pitch is released.`,
    ],
  },
];

Deno.test('22 player questions: each reaches the model with the facts it needs, from the rules', async () => {
  strictEqual(QUESTIONS.length, 22);
  for (const rules of [SPEC_RULES, CHANGED_RULES]) {
    for (const { question, facts } of QUESTIONS) {
      const f = fake(rules);
      const result = await chat(f.deps, { messages: [{ role: 'user', content: question }] });
      deepStrictEqual(result, { status: 200, body: { reply: 'Sure.' } }, question);
      strictEqual(f.requests.length, 1, question);
      deepStrictEqual(f.requests[0].messages, [{ role: 'user', content: question }], question);
      const prompt = systemTexts(f.requests[0])[0];
      for (const fact of facts(rules)) ok(prompt.includes(fact), `"${question}" needs: ${fact}`);
    }
  }
});

Deno.test("spec 13's numbers as they are today, written out", () => {
  const prompt = buildSystemPrompt(SPEC_RULES);
  for (const fact of [
    '€0.80 per player when each pays, €0.55 per player when the booker pays for everyone',
    'Standard accounts book up to 7 days ahead; Personal Premium books up to 14 days ahead.',
    'within 15 minutes of booking',
    'Within 1 hour of paying (booked more than 6 hours before kickoff)',
    '€1.00 is kept and the rest becomes venue credit',
    'Less than 6 hours before kickoff: nothing back.',
    'or venue credit within 48 hours',
    'It expires 12 months after it\'s issued.',
    'held for the full pitch price 72 hours before kickoff',
    '2 hours after the match',
    'plus €0.55 per player',
    'at most 5 days ahead and at least 24 hours before kickoff',
    '€3.99 a month',
    'no service fee on your own spot',
  ]) ok(prompt.includes(fact), fact);
});

Deno.test('changing a rule changes the prompt, with no code change', () => {
  const before = buildSystemPrompt(SPEC_RULES);
  const after = buildSystemPrompt(CHANGED_RULES);
  ok(before !== after);
  for (const fact of [
    '€0.90 per player when each pays, €0.60 per player when the booker pays for everyone',
    'Standard accounts book up to 3 days ahead; Personal Premium books up to 5 days ahead.',
    'Less than 4 hours before kickoff: nothing back.',
    'within 30 minutes of booking',
    'or venue credit within 24 hours',
    '€4.49 a month',
    'a €0.10 service fee on your own spot',
  ]) ok(after.includes(fact), fact);
  ok(!after.includes('Less than 6 hours'), 'no trace of the old cutoff');
});

Deno.test('weather (P11): the thresholds follow app_rules, and forecasts are no longer "coming soon"', () => {
  const changed = buildSystemPrompt({
    ...SPEC_RULES,
    weather_rain_chance_pct: 70,
    weather_wind_kmh: 50,
    weather_heat_c: 40,
    weather_heavy_rain: false,
    weather_thunderstorms: false,
  });
  for (const fact of ['a rain chance of 70% or more', 'wind of 50 km/h or more', '40°C or hotter']) {
    ok(changed.includes(fact), fact);
  }
  ok(!changed.includes('heavy rain,'), 'heavy rain left out when the rule is off');
  ok(!changed.includes('thunderstorms,'), 'thunderstorms left out when the rule is off');
  const spec = buildSystemPrompt(SPEC_RULES);
  ok(spec.includes('heavy rain, '), 'heavy rain counts under spec 13');
  ok(spec.includes('thunderstorms, '), 'thunderstorms count under spec 13');
  ok(!spec.includes('coming soon; they aren\'t in the app yet'), 'weather has shipped');
});

Deno.test('the old, wrong facts are gone', () => {
  const prompt = buildSystemPrompt(SPEC_RULES);
  for (const stale of ['21 days', '2 days ahead', '30 minutes before kickoff', '€4.99']) {
    ok(!prompt.includes(stale), `no "${stale}"`);
  }
  ok(!prompt.includes('Switching a booking between 5 v 5 and 6 v 6 after booking is coming soon'), 'switching has shipped');
});

Deno.test('P7: Team Premium is off for the release, so the Futty AI never sells it', () => {
  const prompt = buildSystemPrompt(SPEC_RULES);
  ok(prompt.includes('Team Premium is not on sale yet'), 'says it is not on sale');
  ok(prompt.includes('9-a-side and 11-a-side leagues are coming soon'), 'those leagues are coming soon');
  for (const price of ['€45', '€59']) ok(!prompt.includes(price), `no Team Premium price ${price}`);
});

Deno.test("switching's €60 example is an example, never a rule or the cancellation fee", () => {
  const example = 'Example only: on a €60 pitch, €6.00 a player becomes €5.00, so €1.00 each.';
  const sameExample = '(on the same €60 example, €1.00 each)';
  const prompt = buildSystemPrompt(CHANGED_RULES);
  ok(prompt.includes(example), 'the worked example, marked as one');
  ok(prompt.includes('it is not the €1.50 cancellation fee'), 'told apart from the cancellation fee, which follows the rules');
  // Without the example, nothing is left of spec 13's numbers when the
  // rules change: no €1.00 fee and no 6-hour cutoff.
  const rest = prompt.replace(example, '').replace(sameExample, '');
  for (const stale of ['€1.00', '6 hours', '€0.80', '€0.55']) ok(!rest.includes(stale), `no "${stale}" outside the example`);
  ok(rest.includes('until 4 hours before kickoff (exactly 4 hours before is still allowed)'), 'the cutoff is the rule');
});

Deno.test("prompt caching: the rules' prompt is the cached block; today's date comes after it", async () => {
  const f = fake(SPEC_RULES);
  await chat(f.deps, { messages: [{ role: 'user', content: 'Hi' }] });
  const request = f.requests[0];
  strictEqual(request.model, 'claude-sonnet-5-5');
  const system = request.system as { type: string; text: string; cache_control?: unknown }[];
  strictEqual(system.length, 2);
  deepStrictEqual(system[0].cache_control, { type: 'ephemeral' });
  strictEqual(system[0].text, buildSystemPrompt(SPEC_RULES));
  ok(!system[0].text.includes('2026-11-16'), 'no date inside the cached block');
  deepStrictEqual(system[1], { type: 'text', text: "Today's date in Cyprus is 2026-11-16." });
});

Deno.test('the tool loop: availability from the server, then the answer', async () => {
  const f = fake(SPEC_RULES, [
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: 'tu1', name: 'check_pitch_availability', input: { day: '2026-11-18', format: '5-a-side', start_time: '19:00' } },
      ],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nuevo Campo is free at 19:00 for €6.80 each.' }] },
  ]);
  f.db.respond('venues_free_at', [{ venue_id: 'v1', name: 'Nuevo Campo', city: 'Nicosia', player_cents: 680, next_starts: ['19:30:00'] }]);
  const result = await chat(f.deps, { messages: [{ role: 'user', content: 'Anything free at 7pm on Wednesday?' }] });
  deepStrictEqual(result.body, { reply: 'Nuevo Campo is free at 19:00 for €6.80 each.' });
  deepStrictEqual(f.db.callsTo('venues_free_at')[0].args, {
    p_day: '2026-11-18', p_start: '19:00', p_minutes: 60, p_format: '5-a-side', p_players_per_side: 5,
  });
  const second = f.requests[1].messages as { role: string; content: unknown }[];
  strictEqual(second.length, 3);
  strictEqual((second[1].content as { type: string }[])[0].type, 'thinking', 'the whole assistant content goes back');
  const toolResult = (second[2].content as { content: string; is_error?: boolean }[])[0];
  deepStrictEqual(JSON.parse(toolResult.content).venues, [
    { venue: 'Nuevo Campo', city: 'Nicosia', price_per_player: '€6.80', later_free_times: ['19:30'] },
  ]);
  strictEqual(toolResult.is_error, undefined);
});

Deno.test('availability without a time: each live venue\'s free times, and the server\'s price per player', async () => {
  const f = fake(SPEC_RULES);
  f.db.respond('venue_free_slots', [
    { start_time: '18:00:00', end_time: '19:00:00', price_cents: 6000 },
    { start_time: '18:30:00', end_time: '19:30:00', price_cents: 6000 },
  ]);
  f.db.respond('booking_quote', { each_pays: { player_cents: 680 } });
  const result = await checkAvailability(f.deps, { day: '2026-11-18', format: '5-a-side', duration_hours: 1.5, players_per_side: 6 });
  deepStrictEqual(result.venues, [{
    venue: 'Nuevo Campo',
    city: 'Nicosia',
    free_start_times: ['18:00', '18:30'],
    price_per_player_at_first_time: '€6.80',
  }]);
  deepStrictEqual(f.db.callsTo('venue_free_slots')[0].args, {
    p_venue_id: 'v1', p_day: '2026-11-18', p_format: '5-a-side', p_minutes: 90, p_players_per_side: 6,
  });
  deepStrictEqual(f.db.callsTo('booking_quote')[0].args, {
    p_venue_id: 'v1', p_day: '2026-11-18', p_start: '18:00:00', p_end: '19:00:00', p_format: '5-a-side', p_players_per_side: 6,
  });
});

Deno.test("the server's refusal (e.g. beyond the player's window) goes to the model as an error", async () => {
  const f = fake(SPEC_RULES, [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'check_pitch_availability', input: { day: '2026-12-30', format: '5-a-side', start_time: '19:00' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'That day is too far ahead.' }] },
  ]);
  f.db.fail('venues_free_at', 'beyond_booking_window');
  await chat(f.deps, { messages: [{ role: 'user', content: 'Book me for 30 December' }] });
  const toolResult = ((f.requests[1].messages as { content: unknown }[])[2].content as { content: string; is_error?: boolean }[])[0];
  deepStrictEqual(JSON.parse(toolResult.content), { error: 'beyond_booking_window' });
  strictEqual(toolResult.is_error, true);
  deepStrictEqual(await checkAvailability(f.deps, { day: 'soon', format: '5-a-side' }), {
    error: 'day (YYYY-MM-DD) and format are required',
  });
});

Deno.test('a refusal or an empty answer gets a plain reply, never an empty bubble', async () => {
  for (const reply of [
    { stop_reason: 'refusal', content: [] },
    { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 's' }] },
  ]) {
    const f = fake(SPEC_RULES, [reply]);
    deepStrictEqual(await chat(f.deps, { messages: [{ role: 'user', content: 'Hi' }] }), { status: 200, body: { reply: FALLBACK_REPLY } });
  }
});

Deno.test('bad requests and the rate limit; no rules, no answer', async () => {
  const f = fake(SPEC_RULES);
  deepStrictEqual(await chat(f.deps, { messages: [] }), { status: 400, body: { error: 'Missing messages' } });
  deepStrictEqual(await chat(f.deps, { messages: [{ role: 'assistant', content: 'Hello' }] }), { status: 400, body: { error: 'Missing messages' } });
  strictEqual(f.requests.length, 0);

  const busy = fake(SPEC_RULES, undefined, 20);
  strictEqual((await chat(busy.deps, { messages: [{ role: 'user', content: 'Hi' }] })).status, 429);
  strictEqual(busy.recorded, 0);

  const noRules = fake(SPEC_RULES);
  noRules.deps.rules = () => Promise.reject(new Error('app_rules_missing'));
  let error: unknown;
  try {
    await chat(noRules.deps, { messages: [{ role: 'user', content: 'Hi' }] });
  } catch (err) {
    error = err;
  }
  ok(error instanceof Error && error.message === 'app_rules_missing');
  strictEqual(noRules.requests.length, 0, 'the model is never asked without the rules');
});
