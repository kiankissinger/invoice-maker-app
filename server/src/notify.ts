import type { Context } from './context';

/** Best-effort push to all of a user's devices. Never throws. */
export async function notifyUser(
  ctx: Context,
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { rows } = await ctx.db.query<{ push_token: string }>(`SELECT push_token FROM devices WHERE user_id = $1`, [userId]);
    if (rows.length === 0) return;
    const dead = await ctx.pusher.send(rows.map((r) => ({ to: r.push_token, title, body, data })));
    if (dead.length) await ctx.db.query(`DELETE FROM devices WHERE push_token = ANY($1)`, [dead]);
  } catch (error) {
    console.warn('Push notification failed', error);
  }
}
