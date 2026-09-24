import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';

import type { IconName } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };
}

export default function TabLayout() {
  const theme = useTheme();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: theme.tint }}>
      <Tabs.Screen name="index" options={{ title: 'Invoices', tabBarIcon: tabIcon('document-text-outline') }} />
      <Tabs.Screen name="estimates" options={{ title: 'Estimates', tabBarIcon: tabIcon('clipboard-outline') }} />
      <Tabs.Screen name="clients" options={{ title: 'Clients', tabBarIcon: tabIcon('people-outline') }} />
      <Tabs.Screen name="reports" options={{ title: 'Money', tabBarIcon: tabIcon('wallet-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings-outline') }} />
    </Tabs>
  );
}
