import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { initPurchases } from '@/lib/purchases';
import { useStore } from '@/lib/store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrated = useStore((s) => s.hydrated);

  useEffect(() => {
    initPurchases();
  }, []);

  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync();
  }, [hydrated]);

  if (!hydrated) return null;

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
        <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
