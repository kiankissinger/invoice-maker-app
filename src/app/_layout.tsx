import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { loadSession, refreshMe, useAccount } from '@/lib/account';
import { configureNotifications, registerForPush } from '@/lib/notifications';
import { initPurchases, useSubscription } from '@/lib/purchases';
import { useStore } from '@/lib/store';
import { startAutoSync, syncNow } from '@/lib/sync';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrated = useStore((s) => s.hydrated);
  const accountReady = useAccount((s) => s.ready);
  const ready = hydrated && accountReady;

  useEffect(() => {
    initPurchases();
    loadSession();
  }, []);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync();
    const stopSync = startAutoSync();
    const stopNotifications = configureNotifications();
    if (useAccount.getState().user) {
      void refreshMe();
      void registerForPush();
    }
    // After a purchase, make the server re-check the subscription right away, then sync.
    const unsubPro = useSubscription.subscribe((state, prev) => {
      if (state.hasEntitlement && !prev.hasEntitlement) void refreshMe(true).then(() => syncNow());
    });
    return () => {
      stopSync();
      stopNotifications();
      unsubPro();
    };
  }, [ready]);

  if (!ready) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="document/[id]" options={{ title: '' }} />
        <Stack.Screen name="client/[id]" options={{ title: 'Client' }} />
        <Stack.Screen name="business" options={{ title: 'Business profile' }} />
        <Stack.Screen name="catalog" options={{ title: 'Items & services' }} />
        <Stack.Screen name="client-picker" options={{ presentation: 'modal', title: 'Choose client' }} />
        <Stack.Screen name="payment" options={{ presentation: 'modal', title: 'Record payment' }} />
        <Stack.Screen name="signature" options={{ presentation: 'modal', title: 'Signature' }} />
        <Stack.Screen name="account" options={{ title: 'Account' }} />
        <Stack.Screen name="payments" options={{ title: 'Payments & reminders' }} />
        <Stack.Screen name="send" options={{ presentation: 'modal', title: 'Email to client' }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
