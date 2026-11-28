// Apple WeatherKit (REST), called from Futty's server so the forecast works on
// Android too (docs/specs/13-payments-bookings.md "Weather"). P11.
//
// Each call carries a short-lived ES256 JWT signed with the WeatherKit key
// (.p8) from Supabase secrets: header { alg, kid: key ID, id: "<team ID>.<service ID>" },
// claims { iss: team ID, sub: service ID, iat, exp }. Made with jose, as the
// Apple sign-in secrets are (apple-sign-in.ts). Config is passed in rather
// than read from Deno.env here, so tests need no env access and no real key;
// tests use weatherkit-fake.ts instead of this client.
//
// Apple requires its "Weather" mark and the legal data-sources link wherever
// its data is shown (developer.apple.com/weatherkit/get-started, "Apple
// Weather and third-party attribution"); attribution() returns both.
import { importPKCS8, SignJWT } from 'npm:jose@5';

export const WEATHERKIT_HOST = 'https://weatherkit.apple.com';
/** Apple's "other data sources" legal page, linked from its attribution rules. */
export const DATA_SOURCES_URL = 'https://developer.apple.com/weatherkit/data-source-attribution/';
/** Forecast hours are asked for in Cyprus time, as every booking is. */
const TIME_ZONE = 'Asia/Nicosia';
/** How far ahead to ask: Apple's hourly forecast reaches about 10 days. Not a
 *  spec 13 rule; hours Apple doesn't have are simply missing. */
const ASK_AHEAD_MS = 10 * 24 * 3_600_000;
/** A token lasts half an hour: each request makes its own. */
const TOKEN_LIFETIME_SECONDS = 1800;

export type WeatherKitConfig = {
  /** Apple Developer Team ID. */
  teamId: string;
  /** Key ID of the WeatherKit key. */
  keyId: string;
  /** The WeatherKit service identifier registered in Apple Developer. */
  serviceId: string;
  /** The .p8 key's contents (PKCS#8 PEM). */
  privateKeyPem: string;
};

/** One hour of Apple's hourly forecast: only the fields Futty uses. */
export type WeatherHour = {
  /** ISO time the hour starts. */
  forecastStart: string;
  /** Apple's condition, e.g. 'HeavyRain', 'Thunderstorms', 'Clear'. */
  conditionCode: string;
  /** 0 to 1. */
  precipitationChance: number;
  /** Millimetres in the hour: the hour's rain intensity. */
  precipitationAmount: number;
  /** °C. */
  temperature: number;
  /** km/h (sustained). */
  windSpeed: number;
};

export type WeatherAttribution = {
  serviceName: string;
  /** Apple's mark for light backgrounds (full URL). */
  logoLight: string;
  /** Apple's mark for dark backgrounds (full URL). */
  logoDark: string;
  /** The legal data-sources page. */
  legalPageUrl: string;
};

/** What venue-weather needs from WeatherKit; the fake implements it too. */
export type WeatherSource = {
  hourly(latitude: number, longitude: number): Promise<WeatherHour[]>;
  attribution(): Promise<WeatherAttribution>;
};

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** The .p8 key as a PEM, however its lines were joined to fit a one-line
 *  secret: line breaks written as "\n", as spaces, or dropped. */
export function pemFromSecret(value: string): string {
  const body = value
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n');
}

export async function makeWeatherKitToken(config: WeatherKitConfig, now: Date = new Date()): Promise<string> {
  const key = await importPKCS8(pemFromSecret(config.privateKeyPem), 'ES256');
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId, id: `${config.teamId}.${config.serviceId}` })
    .setIssuer(config.teamId)
    .setSubject(config.serviceId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + TOKEN_LIFETIME_SECONDS)
    .sign(key);
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseHour(raw: unknown): WeatherHour | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  if (typeof h.forecastStart !== 'string' || Number.isNaN(Date.parse(h.forecastStart))) return null;
  if (typeof h.conditionCode !== 'string') return null;
  if (!isNumber(h.precipitationChance) || !isNumber(h.temperature) || !isNumber(h.windSpeed)) return null;
  return {
    forecastStart: h.forecastStart,
    conditionCode: h.conditionCode,
    precipitationChance: h.precipitationChance,
    // Optional in Apple's schema: no amount reported is no rain.
    precipitationAmount: isNumber(h.precipitationAmount) ? h.precipitationAmount : 0,
    temperature: h.temperature,
    windSpeed: h.windSpeed,
  };
}

function absolute(path: unknown): string | null {
  if (typeof path !== 'string' || path === '') return null;
  return new URL(path, WEATHERKIT_HOST).toString();
}

export function createWeatherKit(
  config: WeatherKitConfig,
  fetchFn: FetchFn = fetch,
  now: () => Date = () => new Date(),
): WeatherSource {
  return {
    async hourly(latitude, longitude) {
      const at = now();
      const start = new Date(at);
      start.setUTCMinutes(0, 0, 0);
      const url = new URL(`${WEATHERKIT_HOST}/api/v1/weather/en/${latitude}/${longitude}`);
      url.searchParams.set('dataSets', 'forecastHourly');
      url.searchParams.set('timezone', TIME_ZONE);
      url.searchParams.set('hourlyStart', start.toISOString());
      url.searchParams.set('hourlyEnd', new Date(start.getTime() + ASK_AHEAD_MS).toISOString());

      const res = await fetchFn(url.toString(), {
        headers: { Authorization: `Bearer ${await makeWeatherKitToken(config, at)}` },
      });
      if (!res.ok) throw new Error(`weatherkit_${res.status}`);
      const body = await res.json() as { forecastHourly?: { hours?: unknown[] } };
      const hours = Array.isArray(body?.forecastHourly?.hours) ? body.forecastHourly.hours : [];
      return hours.map(parseHour).filter((h): h is WeatherHour => h !== null);
    },

    async attribution() {
      const res = await fetchFn(`${WEATHERKIT_HOST}/attribution/en`, {});
      if (!res.ok) throw new Error(`weatherkit_attribution_${res.status}`);
      const body = await res.json() as Record<string, unknown>;
      const logoLight = absolute(body['logoLight@3x'] ?? body['logoLight@2x'] ?? body['logoLight@1x']);
      const logoDark = absolute(body['logoDark@3x'] ?? body['logoDark@2x'] ?? body['logoDark@1x']);
      if (!logoLight || !logoDark) throw new Error('weatherkit_attribution_invalid');
      return {
        serviceName: typeof body.serviceName === 'string' && body.serviceName ? body.serviceName : 'Apple Weather',
        logoLight,
        logoDark,
        // Apple's own link when it sends one; otherwise the data-sources page its rules link to.
        legalPageUrl: typeof body.legalPageURL === 'string' && body.legalPageURL.startsWith('https://')
          ? body.legalPageURL
          : DATA_SOURCES_URL,
      };
    },
  };
}
