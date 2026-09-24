import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, {
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import { create } from 'zustand';

import { scheduleTrialReminder } from './notifications';

/** RevenueCat entitlement that unlocks every Pro feature. */
export const PRO_ENTITLEMENT = 'pro';

/** How many documents (invoices + estimates) a free user can create per calendar month. */
export const FREE_DOCUMENT_LIMIT = 3;

export type ProFeature =
  | 'unlimited'
  | 'templates'
  | 'noWatermark'
  | 'reports'
  | 'catalog'
  | 'signature'
  | 'convert'
  | 'duplicate'
  | 'branding'
  | 'onlinePayments'
  | 'reminders'
  | 'recurring'
  | 'cloud'
  | 'ai'
  | 'lateFees';

export const PRO_FEATURES: { key: ProFeature; title: string; detail: string }[] = [
  { key: 'unlimited', title: 'Unlimited invoices & estimates', detail: 'No caps, ever.' },
  { key: 'noWatermark', title: 'No watermark', detail: 'Clean, professional PDFs.' },
  { key: 'templates', title: 'All premium templates', detail: 'Modern, Minimal and Bold designs.' },
  { key: 'branding', title: 'Custom brand color', detail: 'Match your logo on every document.' },
  { key: 'signature', title: 'E-signatures', detail: 'Capture client sign-off on the spot.' },
  { key: 'convert', title: 'Estimate → invoice in one tap', detail: 'Win the job, bill instantly.' },
  { key: 'catalog', title: 'Saved items & services', detail: 'Build invoices in seconds.' },
  { key: 'duplicate', title: 'Duplicate documents', detail: 'Repeat work without retyping.' },
  { key: 'reports', title: 'Revenue reports', detail: 'Cash flow, aging and top clients.' },
  { key: 'onlinePayments', title: 'Get paid online', detail: 'Clients pay by card with one tap. Invoices mark themselves paid.' },
  { key: 'reminders', title: 'Automatic reminders', detail: 'Polite nudges before and after the due date.' },
  { key: 'recurring', title: 'Recurring invoices', detail: 'Bill retainers automatically every week, month or year.' },
  { key: 'cloud', title: 'Cloud sync & backup', detail: 'Your data on every device, never lost.' },
  { key: 'ai', title: 'AI assistant', detail: 'Describe the job, get line items. Snap a receipt, get an expense.' },
  { key: 'lateFees', title: 'Automatic late fees', detail: 'Added for you when an invoice runs overdue.' },
];

type SubscriptionState = {
  ready: boolean;
  /** False when no RevenueCat key is set (web, local dev) — purchases are unavailable. */
  storeAvailable: boolean;
  hasEntitlement: boolean;
  /** Dev-only switch so every Pro screen can be exercised without a sandbox account. */
  devPro: boolean;
  setDevPro: (value: boolean) => void;
};

export const useSubscription = create<SubscriptionState>()((set) => ({
  ready: false,
  storeAvailable: false,
  hasEntitlement: false,
  devPro: false,
  setDevPro: (devPro) => set({ devPro }),
}));

export function useIsPro(): boolean {
  return useSubscription((s) => s.hasEntitlement || (__DEV__ && s.devPro));
}

/** Non-hook version for use outside components. */
export function isProNow(): boolean {
  const s = useSubscription.getState();
  return s.hasEntitlement || (__DEV__ && s.devPro);
}

/**
 * Store keys for real App Store / Play builds. The Test Store key (`test_…`) simulates purchases
 * with no store account, and is the only kind that works in Expo Go and on the web.
 */
function apiKey(): string | undefined {
  const testKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_KEY || undefined;
  const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  if (Platform.OS === 'web' || isExpoGo) return testKey;
  const storeKey =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
      : Platform.OS === 'android'
        ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
        : undefined;
  return storeKey || testKey;
}

function applyCustomerInfo(info: CustomerInfo) {
  const pro = info.entitlements.active[PRO_ENTITLEMENT];
  useSubscription.setState({ hasEntitlement: pro != null });
  void scheduleTrialReminder(pro?.expirationDate ?? null, pro?.periodType === 'TRIAL', pro?.willRenew ?? false);
}

let initialized = false;

export async function initPurchases(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const key = apiKey();
  if (!key) {
    useSubscription.setState({ ready: true, storeAvailable: false });
    return;
  }
  try {
    Purchases.configure({ apiKey: key });
    Purchases.addCustomerInfoUpdateListener(applyCustomerInfo);
    applyCustomerInfo(await Purchases.getCustomerInfo());
    useSubscription.setState({ storeAvailable: true });
  } catch (error) {
    console.warn('RevenueCat init failed', error);
  } finally {
    useSubscription.setState({ ready: true });
  }
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!useSubscription.getState().storeAvailable) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

/** Returns true when the purchase unlocked Pro, false when the user cancelled. Throws otherwise. */
export async function purchase(pkg: PurchasesPackage): Promise<boolean> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    applyCustomerInfo(customerInfo);
    return customerInfo.entitlements.active[PRO_ENTITLEMENT] != null;
  } catch (error) {
    if ((error as PurchasesError).code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return false;
    throw error;
  }
}

/** Where the user can change or cancel their subscription (App Store / Google Play). */
export async function getManagementUrl(): Promise<string> {
  if (useSubscription.getState().storeAvailable) {
    try {
      const info = await Purchases.getCustomerInfo();
      if (info.managementURL) return info.managementURL;
    } catch (error) {
      console.warn('Could not load subscription info', error);
    }
  }
  return Platform.OS === 'android'
    ? 'https://play.google.com/store/account/subscriptions'
    : 'https://apps.apple.com/account/subscriptions';
}

export async function restore(): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  applyCustomerInfo(info);
  return info.entitlements.active[PRO_ENTITLEMENT] != null;
}
