import type { ExpenseCategory, InvoiceDocument, SyncChange } from './types';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
export const apiConfigured = () => API_URL.length > 0;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!apiConfigured()) throw new ApiError(0, 'not_configured', 'The server URL is not configured (EXPO_PUBLIC_API_URL).');
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Could not reach the server. Check your connection.');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    if (res.status === 401 && authToken) onUnauthorized?.();
    throw new ApiError(res.status, json.error ?? 'error', json.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}

export type Me = {
  user: { id: string; email: string };
  isPro: boolean;
  payments: { configured: boolean; connected: boolean; chargesEnabled: boolean };
};

export type StripeStatus = { configured: boolean; connected: boolean; chargesEnabled: boolean; detailsSubmitted: boolean };

export const api = {
  startLogin: (email: string) => request<{ ok: true }>('POST', '/v1/auth/start', { email }),
  verifyLogin: (email: string, code: string) =>
    request<{ token: string; user: { id: string; email: string } }>('POST', '/v1/auth/verify', { email, code }),
  me: (refresh = false) => request<Me>('GET', `/v1/me${refresh ? '?refresh=1' : ''}`),
  deleteAccount: () => request<{ ok: true }>('DELETE', '/v1/me'),
  registerDevice: (token: string, platform: string) => request<{ ok: true }>('POST', '/v1/devices', { token, platform }),
  unregisterDevice: (token: string) => request<{ ok: true }>('DELETE', `/v1/devices/${encodeURIComponent(token)}`),
  sync: (cursor: number, changes: SyncChange[]) =>
    request<{ cursor: number; hasMore: boolean; changes: SyncChange[] }>('POST', '/v1/sync', { cursor, changes }),
  shareDocument: (id: string) => request<{ url: string; document: InvoiceDocument }>('POST', `/v1/documents/${id}/share`),
  sendDocument: (id: string, to: string, message?: string) =>
    request<{ url: string; document: InvoiceDocument }>('POST', `/v1/documents/${id}/send`, { to, message }),
  scanReceipt: (image: string) =>
    request<{ vendor: string | null; date: string | null; total: number | null; tax: number | null; currency: string | null; category: ExpenseCategory }>(
      'POST',
      '/v1/ai/receipt',
      { image, mediaType: 'image/jpeg' }
    ),
  draftItems: (description: string, currency: string) =>
    request<{
      items: { description: string; details: string | null; quantity: number; unitPrice: number; unit: string | null; taxable: boolean }[];
      notes: string | null;
    }>('POST', '/v1/ai/draft-items', { description, currency }),
  connectStripe: () => request<{ url: string }>('POST', '/v1/stripe/connect'),
  stripeStatus: () => request<StripeStatus>('GET', '/v1/stripe/status'),
  stripeDashboard: () => request<{ url: string }>('POST', '/v1/stripe/dashboard'),
};
