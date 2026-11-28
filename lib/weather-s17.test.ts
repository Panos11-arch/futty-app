// S17: the weather card's words (image 03, "22° · Clear at 20:00") and the
// venue Home tab's "today" window. The numbers and Apple's condition come
// from venue-weather; the app only puts them into words.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { conditionWords, detailLine, headline, nowWindow } from '@/lib/weather';
import { CALM_FORECAST } from '@/lib/weather.fixtures';

describe('conditionWords: Apple\'s condition code in words', () => {
  it.each([
    ['Clear', 'Clear'],
    ['MostlyClear', 'Mostly clear'],
    ['PartlyCloudy', 'Partly cloudy'],
    ['HeavyRain', 'Heavy rain'],
    ['IsolatedThunderstorms', 'Isolated thunderstorms'],
    ['SunShowers', 'Sun showers'],
  ])('%s: %s', (code, words) => {
    expect(conditionWords(code)).toBe(words);
  });

  it('nothing usable: no words', () => {
    expect(conditionWords(undefined)).toBeNull();
    expect(conditionWords('')).toBeNull();
    expect(conditionWords('<b>Clear</b>')).toBeNull();
  });
});

describe('headline: temperature · condition at the time', () => {
  it('one temperature', () => {
    expect(headline({ ...CALM_FORECAST, temp_min_c: 22, temp_max_c: 22, condition: 'Clear' }, '20:00')).toBe(
      '22° · Clear at 20:00',
    );
  });

  it('a range over the game', () => {
    expect(headline({ ...CALM_FORECAST, temp_min_c: 19, temp_max_c: 21, condition: 'MostlyCloudy' }, '18:30:00')).toBe(
      '19–21° · Mostly cloudy at 18:30',
    );
  });

  it('no condition from the server: the temperature at the time', () => {
    expect(headline({ ...CALM_FORECAST, condition: undefined }, '20:00')).toBe('19° at 20:00');
  });
});

describe('detailLine: rain and wind, then thunderstorms', () => {
  it('calm', () => {
    expect(detailLine(CALM_FORECAST)).toBe('Rain 10% · Wind 12 km/h');
  });

  it('rain in mm and thunderstorms', () => {
    expect(detailLine({ ...CALM_FORECAST, rain_chance_pct: 70, rain_mm: 3.5, thunderstorm: true })).toBe(
      'Rain 70% · 3.5 mm · Wind 12 km/h · Thunderstorms',
    );
  });
});

describe('nowWindow: the hour it is now in Cyprus, whatever the phone\'s zone', () => {
  it('winter (UTC+2)', () => {
    expect(nowWindow(new Date('2026-11-27T12:40:00Z'))).toEqual({ day: '2026-11-27', start: '14:00', end: '15:00' });
  });

  it('summer (UTC+3)', () => {
    expect(nowWindow(new Date('2026-07-10T05:05:00Z'))).toEqual({ day: '2026-07-10', start: '08:00', end: '09:00' });
  });

  it('the last hour of the day ends at midnight', () => {
    expect(nowWindow(new Date('2026-11-27T21:30:00Z'))).toEqual({ day: '2026-11-27', start: '23:00', end: '00:00' });
  });

  it('just after midnight in Cyprus is the next day there', () => {
    expect(nowWindow(new Date('2026-11-27T22:10:00Z'))).toEqual({ day: '2026-11-28', start: '00:00', end: '01:00' });
  });
});
