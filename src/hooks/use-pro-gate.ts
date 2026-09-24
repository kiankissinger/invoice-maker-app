import { router } from 'expo-router';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import { useAccount } from '@/lib/account';
import { countThisMonth, todayISO } from '@/lib/calc';
import { apiConfigured } from '@/lib/api';
import { FREE_DOCUMENT_LIMIT, useIsPro, type ProFeature } from '@/lib/purchases';
import { useStore } from '@/lib/store';

/**
 * Returns a guard: `requirePro('reports')` is true for Pro users; for free users it
 * opens the paywall (highlighting that feature) and returns false.
 */
export function useProGate() {
  const isPro = useIsPro();
  const createdThisMonth = useStore((s) => countThisMonth(s.createdThisMonth, todayISO()));

  const requirePro = useCallback(
    (feature: ProFeature) => {
      if (isPro) return true;
      router.push({ pathname: '/paywall', params: { feature } });
      return false;
    },
    [isPro]
  );

  const canCreateDocument = useCallback(() => {
    if (isPro || createdThisMonth < FREE_DOCUMENT_LIMIT) return true;
    router.push({ pathname: '/paywall', params: { feature: 'unlimited' } });
    return false;
  }, [isPro, createdThisMonth]);

  const signedIn = useAccount((s) => s.user !== null);

  /** Pro + a server + a signed-in account: needed for sync, payments, sending and reminders. */
  const requireCloud = useCallback(
    (feature: ProFeature) => {
      if (!requirePro(feature)) return false;
      if (!apiConfigured()) {
        Alert.alert('Server not configured', 'Set EXPO_PUBLIC_API_URL to your server to use cloud features.');
        return false;
      }
      if (!signedIn) {
        router.push('/account');
        return false;
      }
      return true;
    },
    [requirePro, signedIn]
  );

  return {
    isPro,
    requirePro,
    requireCloud,
    signedIn,
    canCreateDocument,
    freeDocumentsLeft: Math.max(0, FREE_DOCUMENT_LIMIT - createdThisMonth),
  };
}
