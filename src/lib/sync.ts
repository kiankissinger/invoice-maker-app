import { AppState } from 'react-native';
import { create } from 'zustand';

import { useAccount } from './account';
import { api, ApiError, apiConfigured } from './api';
import { isProNow } from './purchases';
import { useStore } from './store';

type SyncStatus = {
  syncing: boolean;
  lastSyncedAt: string | null;
  error: string | null;
};

export const useSyncStatus = create<SyncStatus>()(() => ({ syncing: false, lastSyncedAt: null, error: null }));

const MAX_ROUNDS = 20;
const BATCH = 500;
let inFlight: Promise<void> | null = null;
let again = false;

export function canSync(): boolean {
  return apiConfigured() && useAccount.getState().user !== null && isProNow();
}

/** Pushes local changes and pulls remote ones. Concurrent calls coalesce into one extra run. */
export function syncNow(): Promise<void> {
  if (!canSync()) return Promise.resolve();
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = run().finally(() => {
    inFlight = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return inFlight;
}

async function run() {
  useSyncStatus.setState({ syncing: true, error: null });
  try {
    const store = useStore.getState;
    // Anything edited after this moment is pushed next time.
    const startedAt = new Date().toISOString();
    const pending = store().collectChanges(store().syncMeta.pushedUpTo);
    let cursor = store().syncMeta.cursor;

    let done = false;
    for (let round = 0; round < MAX_ROUNDS && !done; round++) {
      const batch = pending.slice(round * BATCH, (round + 1) * BATCH);
      const res = await api.sync(cursor, batch);
      store().applyRemote(res.changes);
      cursor = res.cursor;
      store().setSyncMeta({ cursor });
      done = !res.hasMore && (round + 1) * BATCH >= pending.length;
    }
    // If we ran out of rounds, leave pushedUpTo alone so the rest goes next time.
    if (done) store().setSyncMeta({ pushedUpTo: startedAt });
    useSyncStatus.setState({ lastSyncedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Sync failed.';
    useSyncStatus.setState({ error: message });
    if (!(error instanceof ApiError) || error.code !== 'offline') console.warn('Sync failed', error);
  } finally {
    useSyncStatus.setState({ syncing: false });
  }
}

/** Syncs on launch, when the app returns to the foreground, and shortly after local edits. */
export function startAutoSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), delay);
  };

  const unsubStore = useStore.subscribe((state, prev) => {
    if (state.documents !== prev.documents || state.clients !== prev.clients || state.catalog !== prev.catalog || state.profile !== prev.profile || state.tombstones !== prev.tombstones) {
      schedule(3000);
    }
  });
  const unsubAccount = useAccount.subscribe((state, prev) => {
    if (state.user && state.user !== prev.user) schedule(0);
  });
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') schedule(0);
  });
  schedule(0);

  return () => {
    clearTimeout(timer);
    unsubStore();
    unsubAccount();
    appState.remove();
  };
}
