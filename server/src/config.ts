import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Public base URL of this server, used in emails, invoice links and Stripe redirects. */
  PUBLIC_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  APP_NAME: z.string().default('Invoice Maker'),
  /** Deep link scheme of the mobile app (app.json "scheme"). */
  APP_SCHEME: z.string().default('invoicemaker'),

  RESEND_API_KEY: z.string().optional(),
  /** e.g. "invoices@mail.yourdomain.com" — must be a verified Resend sender domain. */
  EMAIL_FROM: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  /** Signing secret of the Connect webhook endpoint (events from connected accounts). */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Optional platform fee on online payments, in basis points (100 = 1%). */
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(0),

  /** RevenueCat secret API key (v1) used to verify Pro entitlements server-side. */
  REVENUECAT_SECRET_KEY: z.string().optional(),
  REVENUECAT_ENTITLEMENT: z.string().default('pro'),
  /** Treat every user as Pro when RevenueCat isn't configured. Never enable in production. */
  ALLOW_ALL_PRO: bool,

  /** Claude API key for receipt scanning and AI drafting. */
  ANTHROPIC_API_KEY: z.string().optional(),

  /** Optional fixed login for App Store / Play review accounts. */
  REVIEW_LOGIN_EMAIL: z.string().optional(),
  REVIEW_LOGIN_CODE: z.string().regex(/^\d{6}$/).optional(),

  EXPO_ACCESS_TOKEN: z.string().optional(),
  JOBS_ENABLED: bool,
  JOBS_INTERVAL_MINUTES: z.coerce.number().default(15),
  /** Sign-in requests allowed per IP per 15 minutes. */
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(20),
});

export type Config = {
  env: string;
  port: number;
  databaseUrl: string;
  publicUrl: string;
  jwtSecret: string;
  appName: string;
  appScheme: string;
  resendApiKey?: string;
  emailFrom?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  platformFeeBps: number;
  revenuecatSecretKey?: string;
  revenuecatEntitlement: string;
  allowAllPro: boolean;
  anthropicApiKey?: string;
  reviewEmail?: string;
  reviewCode?: string;
  expoAccessToken?: string;
  jobsEnabled: boolean;
  jobsIntervalMinutes: number;
  authRateLimit: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const production = parsed.NODE_ENV === 'production';
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    publicUrl: parsed.PUBLIC_URL.replace(/\/$/, ''),
    jwtSecret: parsed.JWT_SECRET,
    appName: parsed.APP_NAME,
    appScheme: parsed.APP_SCHEME,
    resendApiKey: parsed.RESEND_API_KEY,
    emailFrom: parsed.EMAIL_FROM,
    stripeSecretKey: parsed.STRIPE_SECRET_KEY,
    stripeWebhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
    platformFeeBps: parsed.PLATFORM_FEE_BPS,
    revenuecatSecretKey: parsed.REVENUECAT_SECRET_KEY,
    revenuecatEntitlement: parsed.REVENUECAT_ENTITLEMENT,
    allowAllPro: parsed.ALLOW_ALL_PRO ?? (!production && !parsed.REVENUECAT_SECRET_KEY),
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    reviewEmail: parsed.REVIEW_LOGIN_EMAIL,
    reviewCode: parsed.REVIEW_LOGIN_CODE,
    expoAccessToken: parsed.EXPO_ACCESS_TOKEN,
    jobsEnabled: parsed.JOBS_ENABLED ?? true,
    jobsIntervalMinutes: parsed.JOBS_INTERVAL_MINUTES,
    authRateLimit: parsed.AUTH_RATE_LIMIT,
  };
}
