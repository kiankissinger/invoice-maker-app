import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';

import { HttpError, type Context } from './context';
import { loginCodeEmail } from './emails';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const TOKEN_TTL = '180d';
const PRO_CACHE_MS = 60 * 60 * 1000;
const NOT_PRO_CACHE_MS = 5 * 60 * 1000;

export type AuthUser = { id: string; email: string };

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

function hashCode(ctx: Context, email: string, code: string) {
  return createHash('sha256').update(`${ctx.config.jwtSecret}:${email}:${code}`).digest('hex');
}

export async function startLogin(ctx: Context, rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const now = ctx.now();
  const { rows } = await ctx.db.query<{ expires_at: Date }>(`SELECT expires_at FROM login_codes WHERE email = $1`, [email]);
  const existing = rows[0];
  if (existing && new Date(existing.expires_at).getTime() - CODE_TTL_MS + RESEND_AFTER_MS > now.getTime()) {
    throw new HttpError(429, 'too_soon', 'Please wait a few seconds before requesting another code.');
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ctx.db.query(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts) VALUES ($1, $2, $3, 0)
     ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
    [email, hashCode(ctx, email, code), new Date(now.getTime() + CODE_TTL_MS)]
  );
  await ctx.mailer.send(loginCodeEmail(ctx.config.appName, code, email));
}

export async function verifyLogin(ctx: Context, rawEmail: string, code: string): Promise<{ token: string; user: AuthUser }> {
  const email = normalizeEmail(rawEmail);
  const { reviewEmail, reviewCode } = ctx.config;
  const isReviewLogin = !!reviewEmail && !!reviewCode && email === normalizeEmail(reviewEmail) && code === reviewCode;

  if (!isReviewLogin) {
    const { rows } = await ctx.db.query<{ code_hash: string; expires_at: Date; attempts: number }>(
      `SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = $1`,
      [email]
    );
    const row = rows[0];
    if (!row || new Date(row.expires_at).getTime() < ctx.now().getTime()) {
      throw new HttpError(400, 'code_expired', 'That code has expired. Request a new one.');
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await ctx.db.query(`DELETE FROM login_codes WHERE email = $1`, [email]);
      throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Request a new code.');
    }
    const expected = Buffer.from(row.code_hash, 'hex');
    const actual = Buffer.from(hashCode(ctx, email, code.trim()), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      await ctx.db.query(`UPDATE login_codes SET attempts = attempts + 1 WHERE email = $1`, [email]);
      throw new HttpError(400, 'invalid_code', 'That code is not right.');
    }
    await ctx.db.query(`DELETE FROM login_codes WHERE email = $1`, [email]);
  }

  const { rows: users } = await ctx.db.query<{ id: string; email: string }>(
    `INSERT INTO users (id, email) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email`,
    [randomUUID(), email]
  );
  const user = users[0];
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(new TextEncoder().encode(ctx.config.jwtSecret));
  return { token, user };
}

export function requireUser(ctx: Context) {
  const key = new TextEncoder().encode(ctx.config.jwtSecret);
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return next(new HttpError(401, 'unauthorized'));
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
      const { rows } = await ctx.db.query<AuthUser>(`SELECT id, email FROM users WHERE id = $1`, [payload.sub]);
      if (!rows[0]) return next(new HttpError(401, 'unauthorized'));
      req.user = rows[0];
      next();
    } catch {
      next(new HttpError(401, 'unauthorized'));
    }
  };
}

/** Cached Pro check. `force` bypasses the cache (e.g. right after a purchase). */
export async function isPro(ctx: Context, userId: string, force = false): Promise<boolean> {
  const { rows } = await ctx.db.query<{ is_pro: boolean; pro_checked_at: Date | null }>(
    `SELECT is_pro, pro_checked_at FROM users WHERE id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return false;
  const age = row.pro_checked_at ? ctx.now().getTime() - new Date(row.pro_checked_at).getTime() : Infinity;
  if (!force && age < (row.is_pro ? PRO_CACHE_MS : NOT_PRO_CACHE_MS)) return row.is_pro;
  try {
    const pro = await ctx.entitlements.isPro(userId);
    await ctx.db.query(`UPDATE users SET is_pro = $2, pro_checked_at = $3 WHERE id = $1`, [userId, pro, ctx.now()]);
    return pro;
  } catch (error) {
    console.warn('Entitlement check failed; using cached value', error);
    return row.is_pro;
  }
}

export function requirePro(ctx: Context) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (await isPro(ctx, req.user!.id)) return next();
      next(new HttpError(402, 'pro_required', 'This feature needs an active Pro subscription.'));
    } catch (error) {
      next(error);
    }
  };
}
