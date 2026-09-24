import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { api } from './api';

const PUSH_TOKEN_KEY = 'push-token';

export function configureNotifications(): () => void {
  if (Platform.OS === 'web') return () => {};
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  const open = (data: Record<string, unknown> | undefined) => {
    if (typeof data?.docId === 'string') router.push(`/document/${data.docId}`);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) setTimeout(() => open(last.notification.request.content.data), 0);
  const sub = Notifications.addNotificationResponseReceivedListener((response) => open(response.notification.request.content.data));
  return () => sub.remove();
}

/** Asks for permission (once) and registers this device for payment/view alerts. */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Payments & activity',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn('Push disabled: no EAS projectId (run `eas init`).');
      return;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerDevice(token, Platform.OS);
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch (error) {
    console.warn('Push registration failed', error);
  }
}

export async function unregisterPush(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!token) return;
  await api.unregisterDevice(token).catch(() => {});
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}
