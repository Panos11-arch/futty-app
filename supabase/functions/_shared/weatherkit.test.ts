// The real WeatherKit client, with a fake fetch: the signed token, the
// request, and turning Apple's answers into what venue-weather uses.
import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair, importSPKI, jwtVerify, exportSPKI } from 'npm:jose@5';

import {
  createWeatherKit,
  DATA_SOURCES_URL,
  makeWeatherKitToken,
  type WeatherKitConfig,
  WEATHERKIT_HOST,
} from './weatherkit.ts';

async function testConfig(): Promise<{ config: WeatherKitConfig; publicPem: string }> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  return {
    config: {
      teamId: 'TEAM123456',
      keyId: 'KEY1234567',
      serviceId: 'app.futty.weather',
      privateKeyPem: await exportPKCS8(privateKey),
    },
    publicPem: await exportSPKI(publicKey),
  };
}

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string) => Response) {
  const calls: Call[] = [];
  const fetchFn = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(respond(url));
  };
  return { calls, fetchFn };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.test('the token is an ES256 JWT with the WeatherKit header and claims', async () => {
  const { config, publicPem } = await testConfig();
  const now = new Date('2026-11-20T10:00:00Z');
  const token = await makeWeatherKitToken(config, now);

  deepStrictEqual(decodeProtectedHeader(token), { alg: 'ES256', kid: 'KEY1234567', id: 'TEAM123456.app.futty.weather' });
  const claims = decodeJwt(token);
  strictEqual(claims.iss, 'TEAM123456');
  strictEqual(claims.sub, 'app.futty.weather');
  strictEqual(claims.iat, now.getTime() / 1000);
  strictEqual((claims.exp as number) > (claims.iat as number), true);
  // Signed with the key: verifies against its public half.
  await jwtVerify(token, await importSPKI(publicPem, 'ES256'), { currentDate: now });
});

Deno.test('hourly asks Apple for the hourly forecast at the coordinates, with the token', async () => {
  const { config } = await testConfig();
  const now = new Date('2026-11-20T10:20:00Z');
  const hour = {
    forecastStart: '2026-11-20T10:00:00Z',
    conditionCode: 'HeavyRain',
    precipitationChance: 0.8,
    precipitationAmount: 6.2,
    temperature: 14.4,
    windSpeed: 31.5,
    humidity: 0.9,
  };
  const { calls, fetchFn } = fakeFetch(() => json({ forecastHourly: { name: 'HourlyForecast', hours: [hour] } }));
  const kit = createWeatherKit(config, fetchFn, () => now);

  const hours = await kit.hourly(35.1856, 33.3823);

  strictEqual(calls.length, 1);
  const url = new URL(calls[0].url);
  strictEqual(url.origin, WEATHERKIT_HOST);
  strictEqual(url.pathname, '/api/v1/weather/en/35.1856/33.3823');
  strictEqual(url.searchParams.get('dataSets'), 'forecastHourly');
  strictEqual(url.searchParams.get('timezone'), 'Asia/Nicosia');
  strictEqual(url.searchParams.get('hourlyStart'), '2026-11-20T10:00:00.000Z');
  strictEqual(new Date(url.searchParams.get('hourlyEnd')!).getTime() > now.getTime(), true);
  const auth = new Headers(calls[0].init.headers).get('Authorization')!;
  strictEqual(auth.startsWith('Bearer '), true);
  strictEqual(decodeJwt(auth.slice('Bearer '.length)).iss, 'TEAM123456');
  // Only the fields used are kept.
  deepStrictEqual(hours, [{
    forecastStart: '2026-11-20T10:00:00Z',
    conditionCode: 'HeavyRain',
    precipitationChance: 0.8,
    precipitationAmount: 6.2,
    temperature: 14.4,
    windSpeed: 31.5,
  }]);
});

Deno.test('hourly: an hour without the fields it needs is dropped, a missing amount reads as none', async () => {
  const { config } = await testConfig();
  const good = { forecastStart: '2026-11-20T11:00:00Z', conditionCode: 'Clear', precipitationChance: 0, temperature: 20, windSpeed: 5 };
  const { fetchFn } = fakeFetch(() =>
    json({ forecastHourly: { hours: [{ forecastStart: '2026-11-20T10:00:00Z', conditionCode: 'Clear' }, good] } })
  );
  const hours = await createWeatherKit(config, fetchFn).hourly(35, 33);
  deepStrictEqual(hours, [{ ...good, precipitationAmount: 0 }]);
});

Deno.test('hourly: no hourly forecast in the answer reads as none', async () => {
  const { config } = await testConfig();
  const { fetchFn } = fakeFetch(() => json({}));
  deepStrictEqual(await createWeatherKit(config, fetchFn).hourly(35, 33), []);
});

Deno.test('hourly: Apple refusing is an error, not an empty forecast', async () => {
  const { config } = await testConfig();
  const { fetchFn } = fakeFetch(() => new Response('forbidden', { status: 401 }));
  await rejects(() => createWeatherKit(config, fetchFn).hourly(35, 33), /weatherkit_401/);
});

Deno.test('attribution: Apple\'s mark as full URLs, and the data-sources link', async () => {
  const { config } = await testConfig();
  const { calls, fetchFn } = fakeFetch(() =>
    json({
      'logoLight@3x': '/assets/branding/en/Apple_Weather_blk_en_3X_090122.png',
      'logoDark@3x': '/assets/branding/en/Apple_Weather_wht_en_3X_090122.png',
      'logoLight@1x': '/assets/branding/en/Apple_Weather_blk_en_1X_090122.png',
      serviceName: 'Apple Weather',
    })
  );
  const attribution = await createWeatherKit(config, fetchFn).attribution();
  strictEqual(calls[0].url, `${WEATHERKIT_HOST}/attribution/en`);
  deepStrictEqual(attribution, {
    serviceName: 'Apple Weather',
    logoLight: `${WEATHERKIT_HOST}/assets/branding/en/Apple_Weather_blk_en_3X_090122.png`,
    logoDark: `${WEATHERKIT_HOST}/assets/branding/en/Apple_Weather_wht_en_3X_090122.png`,
    legalPageUrl: DATA_SOURCES_URL,
  });
});

Deno.test('attribution: Apple\'s own legal page link is used when it sends one', async () => {
  const { config } = await testConfig();
  const { fetchFn } = fakeFetch(() =>
    json({
      'logoLight@3x': '/a/blk.png',
      'logoDark@3x': '/a/wht.png',
      serviceName: 'Apple Weather',
      legalPageURL: 'https://weatherkit.apple.com/legal-attribution.html',
    })
  );
  const attribution = await createWeatherKit(config, fetchFn).attribution();
  strictEqual(attribution.legalPageUrl, 'https://weatherkit.apple.com/legal-attribution.html');
});

Deno.test('attribution: without Apple\'s mark it fails, so no forecast is shown without it', async () => {
  const { config } = await testConfig();
  const { fetchFn } = fakeFetch(() => json({ serviceName: 'Apple Weather' }));
  await rejects(() => createWeatherKit(config, fetchFn).attribution(), /weatherkit_attribution_invalid/);
});

Deno.test('a .p8 key joined onto one line still signs (literal \\n, spaces, or nothing between lines)', async () => {
  // Supabase secrets are set as one line: the key may arrive with its line
  // breaks written as "\n", as spaces, or dropped.
  const { config, publicPem } = await testConfig();
  const now = new Date('2026-11-20T10:00:00Z');
  const pem = config.privateKeyPem.trim();
  const oneLine = [pem.replace(/\n/g, '\\n'), pem.replace(/\n/g, ' '), pem.replace(/\n/g, '')];
  for (const privateKeyPem of oneLine) {
    const token = await makeWeatherKitToken({ ...config, privateKeyPem }, now);
    await jwtVerify(token, await importSPKI(publicPem, 'ES256'), { currentDate: now });
  }
});
