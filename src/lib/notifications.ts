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

const TRIAL_REMINDER_KEY = 'trial-reminder';

/**
 * Schedules a local reminder 2 days before a free trial converts to paid, so nobody is
 * surprised by a charge. Idempotent per trial end date; cancels a stale one when the trial changes.
 */
export async function scheduleTrialReminder(trialEndsAt: string | null, isTrial: boolean, willRenew: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(TRIAL_REMINDER_KEY)) ?? 'null') as { endsAt: string; id: string } | null;
    const wanted = isTrial && willRenew && trialEndsAt ? trialEndsAt : null;
    if (saved && saved.endsAt === wanted) return;
    if (saved) {
      await Notifications.cancelScheduledNotificationAsync(saved.id).catch(() => {});
      await AsyncStorage.removeItem(TRIAL_REMINDER_KEY);
    }
    if (!wanted) return;

    const remindAt = new Date(new Date(wanted).getTime() - 2 * 24 * 60 * 60 * 1000);
    if (remindAt.getTime() <= Date.now()) return;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your free trial ends in 2 days',
        body: 'Keep Pro and it renews automatically. Not for you? Cancel anytime in Settings → Manage subscription.',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: remindAt },
    });
    await AsyncStorage.setItem(TRIAL_REMINDER_KEY, JSON.stringify({ endsAt: wanted, id }));
  } catch (error) {
    console.warn('Could not schedule trial reminder', error);
  }
}
