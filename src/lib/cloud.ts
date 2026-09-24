import { api, ApiError } from './api';
import { useStore } from './store';
import { syncNow } from './sync';
import type { InvoiceDocument } from './types';

function applyDocument(doc: InvoiceDocument) {
  useStore.getState().applyRemote([{ type: 'document', id: doc.id, updatedAt: doc.updatedAt, deleted: false, data: doc }]);
}

/** Server actions need the latest copy of the document uploaded first. */
async function withSynced<T extends { document: InvoiceDocument }>(fn: () => Promise<T>): Promise<T> {
  await syncNow();
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'not_synced') throw error;
    await syncNow();
    result = await fn();
  }
  applyDocument(result.document);
  return result;
}

export async function getShareLink(docId: string): Promise<string> {
  const existing = useStore.getState().documents[docId]?.shareUrl;
  if (existing) return existing;
  return (await withSynced(() => api.shareDocument(docId))).url;
}

export async function emailToClient(docId: string, to: string, message?: string): Promise<void> {
  await withSynced(() => api.sendDocument(docId, to, message));
}
