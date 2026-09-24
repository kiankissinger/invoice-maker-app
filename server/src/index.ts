import { createApp } from './app';
import { loadConfig } from './config';
import type { Context } from './context';
import { createPgDb, migrate } from './db';
import { startJobs } from './jobs';
import { createEntitlementChecker, createMailer, createPusher, createStripeGateway } from './services';

async function main() {
  const config = loadConfig();
  const db = createPgDb(config.databaseUrl);
  await migrate(db);

  const ctx: Context = {
    config,
    db,
    mailer: createMailer(config),
    pusher: createPusher(config),
    payments: createStripeGateway(config),
    entitlements: createEntitlementChecker(config),
    now: () => new Date(),
  };

  if (config.env === 'production' && config.allowAllPro) console.warn('WARNING: ALLOW_ALL_PRO is on in production.');
  if (!ctx.payments) console.warn('Stripe is not configured; online payments are disabled.');
  if (!config.resendApiKey) console.warn('Resend is not configured; emails are logged instead of sent.');

  const server = createApp(ctx).listen(config.port, () => console.log(`API listening on :${config.port}`));
  const stopJobs = config.jobsEnabled ? startJobs(ctx) : () => {};

  const shutdown = () => {
    stopJobs();
    server.close(() => db.close().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
