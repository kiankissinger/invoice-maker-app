import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { create } from 'zustand';

import { api, ApiError, setAuthToken, setUnauthorizedHandler, type Me } from './api';
import { registerForPush, unregisterPush } from './notifications';
import { useSubscription } from './purchases';
import { useStore } from './store';

const TOKEN_KEY = 'auth-token';
const USER_KEY = 'auth-user';

// SecureStore isn't available on web; fall back to AsyncStorage there.
const secure = {
  get: (k: string) => (Platform.OS === 'web' ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  remove: (k: string) => (Platform.OS === 'web' ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

type AccountState = {
  ready: boolean;
  user: { id: string; email: string } | null;
  /** Server-side view of the account (Pro status, Stripe), refreshed on launch. */
  me: Me | null;
};

export const useAccount = create<AccountState>()(() => ({ ready: false, user: null, me: null }));

export const useSignedIn = () => useAccount((s) => s.user !== null);

async function linkPurchases(userId: string | null) {
  if (!useSubscription.getState().storeAvailable) return;
  try {
    if (userId) await Purchases.logIn(userId);
    else await Purchases.logOut();
  } catch (error) {
    console.warn('RevenueCat identify failed', error);
  }
}

export async function loadSession(): Promise<void> {
  const [token, user] = await Promise.all([secure.get(TOKEN_KEY), AsyncStorage.getItem(USER_KEY)]);
  setUnauthorizedHandler(() => void clearSession());
  if (token && user) {
    setAuthToken(token);
    useAccount.setState({ user: JSON.parse(user) });
  }
  useAccount.setState({ ready: true });
}

export async function refreshMe(forceEntitlement = false): Promise<Me | null> {
  if (!useAccount.getState().user) return null;
  try {
    const me = await api.me(forceEntitlement);
    useAccount.setState({ me });
    return me;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) console.warn('Failed to load account', error);
    return null;
  }
}

export async function signIn(email: string, code: string): Promise<void> {
  const { token, user } = await api.verifyLogin(email, code);
  setAuthToken(token);
  await Promise.all([secure.set(TOKEN_KEY, token), AsyncStorage.setItem(USER_KEY, JSON.stringify(user))]);
  // A different account than last time: upload everything on this device to it.
  useStore.getState().setSyncMeta({ cursor: 0, pushedUpTo: null });
  useAccount.setState({ user });
  await linkPurchases(user.id);
  await refreshMe(true);
  void registerForPush();
}

async function clearSession() {
  setAuthToken(null);
  await Promise.all([secure.remove(TOKEN_KEY), AsyncStorage.removeItem(USER_KEY)]);
  useStore.getState().setSyncMeta({ cursor: 0, pushedUpTo: null });
  useAccount.setState({ user: null, me: null });
}

/** Signs out; documents stay on this device. */
export async function signOut(): Promise<void> {
  await unregisterPush();
  await linkPurchases(null);
  await clearSession();
}

export async function deleteAccount(): Promise<void> {
  await api.deleteAccount();
  await signOut();
}
