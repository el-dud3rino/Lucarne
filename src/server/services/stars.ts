import { db } from '../db/connection.js';
import type { MemberStarBalance } from '../../shared/types.js';

/**
 * Stars each member has earned (chores + routine bonuses) minus stars spent on rewards.
 * A routine's bonus counts once per day on which every one of its current steps was checked.
 */
export function routineBonusStarsByMember(): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT r.member_id AS member_id, r.stars AS stars
         FROM routines r
         JOIN routine_steps s ON s.routine_id = r.id
         JOIN routine_step_checks k ON k.step_id = s.id
        WHERE r.stars > 0
        GROUP BY r.id, k.date_str
       HAVING COUNT(*) = (SELECT COUNT(*) FROM routine_steps s2 WHERE s2.routine_id = r.id)`
    )
    .all() as Array<{ member_id: string; stars: number }>;
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.member_id, (map.get(r.member_id) ?? 0) + Number(r.stars));
  return map;
}

export function starBalances(): MemberStarBalance[] {
  const members = db.prepare("SELECT id FROM family_members WHERE role != 'family' ORDER BY sort_order").all() as Array<{ id: string }>;
  const earnedRows = db
    .prepare('SELECT completed_by_member_id AS m, COALESCE(SUM(stars_earned), 0) AS s FROM chore_completions GROUP BY completed_by_member_id')
    .all() as Array<{ m: string; s: number }>;
  const spentRows = db
    .prepare('SELECT member_id AS m, COALESCE(SUM(cost), 0) AS s FROM reward_redemptions GROUP BY member_id')
    .all() as Array<{ m: string; s: number }>;
  const earned = new Map(earnedRows.map((r) => [r.m, Number(r.s)]));
  const spent = new Map(spentRows.map((r) => [r.m, Number(r.s)]));
  const bonus = routineBonusStarsByMember();
  return members.map(({ id }) => {
    const e = (earned.get(id) ?? 0) + (bonus.get(id) ?? 0);
    const s = spent.get(id) ?? 0;
    return { memberId: id, earned: e, spent: s, balance: e - s };
  });
}
