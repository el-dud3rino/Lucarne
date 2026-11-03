import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db, runTransaction } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import { starBalances } from '../services/stars.js';
import type { Reward, RewardRedemption } from '../../shared/types.js';

export const rewardsRouter = new Hono();

function mapReward(r: Record<string, unknown>): Reward {
  return {
    id: String(r.id),
    title: String(r.title),
    emoji: String(r.emoji || '🎁'),
    cost: Number(r.cost),
    memberId: r.member_id ? String(r.member_id) : null,
    sortOrder: Number(r.sort_order || 0),
  };
}

function mapRedemption(r: Record<string, unknown>): RewardRedemption {
  return {
    id: String(r.id),
    rewardId: r.reward_id ? String(r.reward_id) : null,
    memberId: String(r.member_id),
    title: String(r.title),
    emoji: String(r.emoji || '🎁'),
    cost: Number(r.cost),
    redeemedAt: String(r.redeemed_at),
  };
}

function cleanCost(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : null;
}

/** Rewards, star balances and the 30 most recent redemptions — everything the Rewards sheet needs. */
rewardsRouter.get('/', (c) => {
  const rewards = (db.prepare('SELECT * FROM rewards WHERE active = 1 ORDER BY sort_order ASC, cost ASC').all() as Record<string, unknown>[]).map(mapReward);
  const history = (
    db.prepare('SELECT * FROM reward_redemptions ORDER BY redeemed_at DESC LIMIT 30').all() as Record<string, unknown>[]
  ).map(mapRedemption);
  return c.json({ rewards, balances: starBalances(), history });
});

rewardsRouter.post('/', async (c) => {
  const body = await c.req.json<Partial<Reward>>();
  const title = (body.title || '').trim();
  const cost = cleanCost(body.cost);
  if (!title) return c.json({ error: 'Name the reward' }, 400);
  if (cost === null) return c.json({ error: 'Cost must be between 1 and 10,000 stars' }, 400);
  const id = crypto.randomUUID();
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM rewards').get() as { m: number };
  db.prepare('INSERT INTO rewards (id, title, emoji, cost, member_id, active, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)').run(
    id,
    title.slice(0, 80),
    body.emoji || '🎁',
    cost,
    body.memberId || null,
    Number(max.m) + 1
  );
  broadcastInvalidate(['rewards']);
  return c.json(mapReward(db.prepare('SELECT * FROM rewards WHERE id = ?').get(id) as Record<string, unknown>), 201);
});

rewardsRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM rewards WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Partial<Reward>>();
  const title = body.title !== undefined ? body.title.trim() : String(existing.title);
  const cost = body.cost !== undefined ? cleanCost(body.cost) : Number(existing.cost);
  if (!title) return c.json({ error: 'Name the reward' }, 400);
  if (cost === null) return c.json({ error: 'Cost must be between 1 and 10,000 stars' }, 400);
  db.prepare('UPDATE rewards SET title = ?, emoji = ?, cost = ?, member_id = ? WHERE id = ?').run(
    title.slice(0, 80),
    body.emoji ?? String(existing.emoji),
    cost,
    body.memberId !== undefined ? body.memberId || null : (existing.member_id as string | null),
    id
  );
  broadcastInvalidate(['rewards']);
  return c.json(mapReward(db.prepare('SELECT * FROM rewards WHERE id = ?').get(id) as Record<string, unknown>));
});

// Soft delete: past redemptions keep their title/emoji/cost.
rewardsRouter.delete('/:id', (c) => {
  db.prepare('UPDATE rewards SET active = 0 WHERE id = ?').run(c.req.param('id'));
  broadcastInvalidate(['rewards']);
  return c.json({ ok: true });
});

/** Spend stars on a reward. Refuses if the member can't afford it. */
rewardsRouter.post('/:id/redeem', async (c) => {
  const id = c.req.param('id');
  const { memberId } = await c.req.json<{ memberId: string }>();
  if (!memberId) return c.json({ error: 'Who is redeeming this reward?' }, 400);
  try {
    const result = runTransaction(() => {
      const reward = db.prepare('SELECT * FROM rewards WHERE id = ? AND active = 1').get(id) as Record<string, unknown> | undefined;
      if (!reward) throw Object.assign(new Error('That reward no longer exists'), { status: 404 });
      if (reward.member_id && String(reward.member_id) !== memberId) {
        throw Object.assign(new Error('This reward is set up for someone else'), { status: 400 });
      }
      const bal = starBalances().find((b) => b.memberId === memberId);
      if (!bal) throw Object.assign(new Error('Unknown family member'), { status: 400 });
      const cost = Number(reward.cost);
      if (bal.balance < cost) {
        throw Object.assign(new Error(`Not enough stars yet: needs ${cost}, has ${bal.balance}`), { status: 400 });
      }
      const rid = crypto.randomUUID();
      db.prepare(
        'INSERT INTO reward_redemptions (id, reward_id, member_id, title, emoji, cost, redeemed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(rid, id, memberId, String(reward.title), String(reward.emoji), cost, new Date().toISOString());
      return mapRedemption(db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(rid) as Record<string, unknown>);
    });
    broadcastInvalidate(['rewards']);
    return c.json(result, 201);
  } catch (err) {
    const status = (err as { status?: number }).status === 404 ? 404 : 400;
    return c.json({ error: err instanceof Error ? err.message : 'Could not redeem' }, status);
  }
});

/** Undo a redemption (refunds the stars). */
rewardsRouter.delete('/redemptions/:id', (c) => {
  db.prepare('DELETE FROM reward_redemptions WHERE id = ?').run(c.req.param('id'));
  broadcastInvalidate(['rewards']);
  return c.json({ ok: true });
});
