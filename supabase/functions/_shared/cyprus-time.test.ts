import { strictEqual as assertEquals } from 'node:assert/strict';
import { cyprusToday } from './cyprus-time.ts';

Deno.test('winter: 00:30 in Cyprus is already the next day (UTC+2)', () => {
  assertEquals(cyprusToday(new Date('2026-11-07T22:30:00Z')), '2026-11-08');
});

Deno.test('winter: 23:30 in Cyprus is still the same day', () => {
  assertEquals(cyprusToday(new Date('2026-11-07T21:30:00Z')), '2026-11-07');
});

Deno.test('summer: 00:30 in Cyprus is already the next day (UTC+3)', () => {
  assertEquals(cyprusToday(new Date('2026-07-01T21:30:00Z')), '2026-07-02');
});

Deno.test('summer: 23:30 in Cyprus is still the same day', () => {
  assertEquals(cyprusToday(new Date('2026-07-01T20:30:00Z')), '2026-07-01');
});

Deno.test('new year rolls over on Cyprus time', () => {
  assertEquals(cyprusToday(new Date('2026-12-31T22:00:00Z')), '2027-01-01');
});
