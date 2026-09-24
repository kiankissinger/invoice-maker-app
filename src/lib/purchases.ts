import { Platform } from 'react-native';
import Purchases, {
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import { create } from 'zustand';

/** RevenueCat entitlement that unlocks every Pro feature. */
export const PRO_ENTITLEMENT = 'pro';

/** How many documents (invoices + estimates) a free user can ever create. */
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
  | 'cloud';

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

function apiKey(): string | undefined {
  if (Platform.OS === 'ios') return process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  return undefined;
}

function applyCustomerInfo(info: CustomerInfo) {
  useSubscription.setState({ hasEntitlement: info.entitlements.active[PRO_ENTITLEMENT] != null });
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

export async function restore(): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  applyCustomerInfo(info);
  return info.entitlements.active[PRO_ENTITLEMENT] != null;
}
