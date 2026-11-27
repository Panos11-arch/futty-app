// S7b: the photo check (Google Cloud Vision SafeSearch). Refused when adult
// or violence is LIKELY or VERY_LIKELY, or racy is VERY_LIKELY; any failure
// throws so the photo isn't posted. A fake fetch stands in for Google.
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';

import { SAFE } from './moderation-fakes.ts';
import { googleVision, type Likelihood, safeSearchAllows } from './vision.ts';

const LEVELS: Likelihood[] = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];

Deno.test('adult and violence: refused from LIKELY', () => {
  for (const level of LEVELS) {
    const refused = level === 'LIKELY' || level === 'VERY_LIKELY';
    strictEqual(safeSearchAllows({ ...SAFE, adult: level }), !refused, `adult ${level}`);
    strictEqual(safeSearchAllows({ ...SAFE, violence: level }), !refused, `violence ${level}`);
  }
});

Deno.test('racy: refused only at VERY_LIKELY', () => {
  for (const level of LEVELS) {
    strictEqual(safeSearchAllows({ ...SAFE, racy: level }), level !== 'VERY_LIKELY', `racy ${level}`);
  }
});

Deno.test('spoof and medical never refuse', () => {
  strictEqual(safeSearchAllows({ ...SAFE, spoof: 'VERY_LIKELY', medical: 'VERY_LIKELY' }), true);
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return await respond();
  }) as typeof fetch;
  return { calls, fetchFn };
}

Deno.test('googleVision: sends the photo with the key in a header, reads SafeSearch', async () => {
  const f = fakeFetch(() => json({ responses: [{ safeSearchAnnotation: { ...SAFE, adult: 'POSSIBLE' } }] }));
  deepStrictEqual(await googleVision(f.fetchFn, 'vision-key')('BASE64'), { ...SAFE, adult: 'POSSIBLE' });
  strictEqual(f.calls[0].url, 'https://vision.googleapis.com/v1/images:annotate');
  strictEqual((f.calls[0].init.headers as Record<string, string>)['x-goog-api-key'], 'vision-key');
  deepStrictEqual(JSON.parse(String(f.calls[0].init.body)), {
    requests: [{ image: { content: 'BASE64' }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }],
  });
});

Deno.test('googleVision: every failure throws', async () => {
  const cases: [string, () => Response | Promise<Response>][] = [
    ['5xx', () => json({}, 503)],
    ['403', () => json({}, 403)],
    ['per-image error', () => json({ responses: [{ error: { message: 'bad image' } }] })],
    ['no result', () => json({ responses: [{}] })],
    ['network', () => Promise.reject(new TypeError('down'))],
  ];
  for (const [name, respond] of cases) {
    await rejects(() => googleVision(fakeFetch(respond).fetchFn, 'k')('x'), Error, name);
  }
  await rejects(() => googleVision(fakeFetch(() => json({})).fetchFn, '')('x'), /vision_key_missing/);
});

Deno.test('googleVision: times out', async () => {
  const slow = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
  await rejects(() => googleVision(slow, 'k', { timeoutMs: 10 })('x'));
});
