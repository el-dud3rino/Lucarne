import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuotaError, GeminiUsage, nextPacificMidnight, pacificDayKey, tierOf } from '../../src/server/services/geminiQuota.js';

test('tiers: Flash-Lite vs full Flash', () => {
  assert.equal(tierOf('gemini-3.5-flash-lite'), 'lite');
  assert.equal(tierOf('gemini-3.8-flash'), 'flash');
});

test('next Pacific midnight is the start of the next Pacific day (DST-safe)', () => {
  const now = Date.parse('2026-11-02T20:00:00Z'); // Nov 2, 12:00 PST
  const reset = nextPacificMidnight(now);
  assert.equal(new Date(reset).toISOString(), '2026-11-03T08:00:00.000Z');
  assert.equal(pacificDayKey(reset), '2026-11-03');
  assert.equal(pacificDayKey(reset - 1000), '2026-11-02');
  // Summer (PDT, UTC-7)
  assert.equal(new Date(nextPacificMidnight(Date.parse('2026-07-01T12:00:00Z'))).toISOString(), '2026-07-02T07:00:00.000Z');
});

test('classifies Google quota errors', () => {
  assert.equal(classifyQuotaError(new Error('{"error":{"code":429,"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 20 ... requests per day"}}')), 'day');
  assert.equal(classifyQuotaError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"... per minute"}}')), 'minute');
  assert.equal(classifyQuotaError(new Error('{"error":{"code":429,"message":"You exceeded your current quota"}}')), 'minute');
  assert.equal(classifyQuotaError(new Error('{"error":{"code":503,"message":"high demand"}}')), null);
});

test('per-minute limit: blocked after 5 Flash requests, free again a minute later; Lite allows 15', () => {
  const u = new GeminiUsage({ enabled: true });
  const t0 = Date.parse('2026-11-02T20:00:00Z');
  for (let i = 0; i < 5; i++) u.record('gemini-3.8-flash', t0 + i * 1000);
  assert.equal(u.blockedUntil('gemini-3.8-flash', t0 + 5000), t0 + 60_000);
  assert.equal(u.blockedUntil('gemini-3.8-flash', t0 + 61_000), 0);
  for (let i = 0; i < 14; i++) u.record('gemini-3.5-flash-lite', t0 + i);
  assert.equal(u.blockedUntil('gemini-3.5-flash-lite', t0 + 100), 0, '14 of 15 used');
});

test('per-day limit (20 for Flash) blocks until midnight Pacific and survives a restart', () => {
  let saved: any = null;
  const make = () => new GeminiUsage({ enabled: true, load: () => saved, save: (s) => (saved = JSON.parse(JSON.stringify(s))) });
  const t0 = Date.parse('2026-11-02T16:00:00Z');
  const u = make();
  for (let i = 0; i < 20; i++) u.record('gemini-3.6-flash', t0 + i * 61_000); // spread out: never hits per-minute
  const later = t0 + 21 * 61_000;
  assert.equal(u.blockedUntil('gemini-3.6-flash', later), nextPacificMidnight(later));
  const restarted = make();
  assert.equal(restarted.usedToday('gemini-3.6-flash', later), 20, 'daily count persisted');
  assert.equal(restarted.blockedUntil('gemini-3.6-flash', nextPacificMidnight(later) + 1000), 0, 'new day resets');
});

test('Google saying "daily quota exceeded" wins over our own count; paid tier disables local limits', () => {
  const u = new GeminiUsage({ enabled: true });
  const now = Date.parse('2026-11-02T20:00:00Z');
  u.record('gemini-3.8-flash', now);
  u.markDayExhausted('gemini-3.8-flash', now);
  assert.equal(u.blockedUntil('gemini-3.8-flash', now + 1000), nextPacificMidnight(now));
  const paid = new GeminiUsage({ enabled: false });
  for (let i = 0; i < 50; i++) paid.record('gemini-3.8-flash', now);
  assert.equal(paid.blockedUntil('gemini-3.8-flash', now), 0);
});
