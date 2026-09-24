import type { Config } from './config';
import type { Db } from './db';
import type { EntitlementChecker, Mailer, PaymentsGateway, Pusher } from './services';

export type Context = {
  config: Config;
  db: Db;
  mailer: Mailer;
  pusher: Pusher;
  payments: PaymentsGateway | null;
  entitlements: EntitlementChecker;
  now: () => Date;
};

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string
  ) {
    super(message ?? code);
  }
}
