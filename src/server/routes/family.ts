import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import type { FamilyMember } from '../../shared/types.js';

export const familyRouter = new Hono();

function mapMemberRow(row: Record<string, unknown>): FamilyMember {
  return {
    id: String(row.id),
    name: String(row.name),
    initial: String(row.initial),
    emoji: String(row.emoji),
    role: row.role as FamilyMember['role'],
    colorBg: String(row.color_bg),
    colorText: String(row.color_text),
    colorAccent: String(row.color_accent),
    sortOrder: Number(row.sort_order),
  };
}

familyRouter.get('/', (c) => {
  const rows = db
    .prepare('SELECT * FROM family_members ORDER BY sort_order ASC, name ASC')
    .all() as Record<string, unknown>[];
  return c.json(rows.map(mapMemberRow));
});

familyRouter.post('/', async (c) => {
  const body = await c.req.json<Partial<FamilyMember>>();
  const name = (body.name || 'Member').trim();
  const id = crypto.randomUUID();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM family_members')
    .get() as { m: number };

  db.prepare(
    `INSERT INTO family_members (id, name, initial, emoji, role, color_bg, color_text, color_accent, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    (body.initial || name[0] || '?').toUpperCase(),
    body.emoji || '🙂',
    body.role || 'parent',
    body.colorBg || '#E0F2FE',
    body.colorText || '#0C4A6E',
    body.colorAccent || '#0284C7',
    body.sortOrder ?? maxOrder.m + 1
  );

  broadcastInvalidate(['family']);
  const created = db
    .prepare('SELECT * FROM family_members WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return c.json(mapMemberRow(created), 201);
});

familyRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<FamilyMember>>();
  const existing = db
    .prepare('SELECT * FROM family_members WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const name = (body.name ?? String(existing.name)).trim();
  db.prepare(
    `UPDATE family_members
     SET name = ?, initial = ?, emoji = ?, role = ?, color_bg = ?, color_text = ?, color_accent = ?, sort_order = ?
     WHERE id = ?`
  ).run(
    name,
    (body.initial ?? name[0] ?? '?').toUpperCase(),
    body.emoji ?? String(existing.emoji),
    body.role ?? String(existing.role),
    body.colorBg ?? String(existing.color_bg),
    body.colorText ?? String(existing.color_text),
    body.colorAccent ?? String(existing.color_accent),
    body.sortOrder ?? Number(existing.sort_order),
    id
  );

  broadcastInvalidate(['family']);
  const updated = db
    .prepare('SELECT * FROM family_members WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return c.json(mapMemberRow(updated));
});

familyRouter.delete('/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM family_members WHERE id = ?').run(id);
  broadcastInvalidate(['family', 'events', 'chores']);
  return c.json({ ok: true });
});
