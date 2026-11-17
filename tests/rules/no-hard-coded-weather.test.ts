// P11: spec 13's weather thresholds (60% rain, 40 km/h wind, 38°C, the
// 12-hour nudge lead) live only in public.app_rules. This scans the weather
// code, app and Edge Function alike, for any of those numbers written in.
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const FILES = [
  'supabase/functions/venue-weather/handler.ts',
  'supabase/functions/venue-weather/assess.ts',
  'supabase/functions/venue-weather/index.ts',
  'supabase/functions/_shared/weatherkit.ts',
  'lib/weather.ts',
  'lib/use-weather.ts',
  'components/venue/weather-strip.tsx',
  'components/venue/weather-nudges.tsx',
];

/** Code only: comments may name the rules. */
function code(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
      return line.replace(/\s\/\/ .*$/, '');
    })
    .join('\n');
}

describe('no weather threshold is written into code', () => {
  it.each(FILES)('%s', (file) => {
    const text = code(fs.readFileSync(path.join(root, file), 'utf8'));
    // Regex pieces such as [0-9a-f]{12} (a UUID) or [12]\d (a day) are not rules.
    expect(text.match(/(?<![{[])\b(60|40|38|12)\b/g) ?? []).toEqual([]);
    expect(text).not.toMatch(/0\.6\b/);
  });

  it('the database function reads the nudge lead from app_rules', () => {
    const migration = fs
      .readdirSync(path.join(root, 'supabase/migrations'))
      .find((f) => f.endsWith('_pay_weather.sql'))!;
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8');
    const body = sql.slice(sql.indexOf('create or replace function public.venue_weather_slots'));
    expect(code(body.replace(/--[^\n]*/g, ''))).not.toMatch(/\b12\b/);
    expect(body).toContain('weather_nudge_hours');
  });
});
