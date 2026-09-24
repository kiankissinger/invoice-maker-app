import { router } from 'expo-router';
import { useCallback } from 'react';

import { FREE_DOCUMENT_LIMIT, useIsPro, type ProFeature } from '@/lib/purchases';
import { useStore } from '@/lib/store';

/**
 * Returns a guard: `requirePro('reports')` is true for Pro users; for free users it
 * opens the paywall (highlighting that feature) and returns false.
 */
export function useProGate() {
  const isPro = useIsPro();
  const documentsCreated = useStore((s) => s.documentsCreated);

  const requirePro = useCallback(
    (feature: ProFeature) => {
      if (isPro) return true;
      router.push({ pathname: '/paywall', params: { feature } });
      return false;
    },
    [isPro]
  );

  const canCreateDocument = useCallback(() => {
    if (isPro || documentsCreated < FREE_DOCUMENT_LIMIT) return true;
    router.push({ pathname: '/paywall', params: { feature: 'unlimited' } });
    return false;
  }, [isPro, documentsCreated]);

  return {
    isPro,
    requirePro,
    canCreateDocument,
    freeDocumentsLeft: Math.max(0, FREE_DOCUMENT_LIMIT - documentsCreated),
  };
}
