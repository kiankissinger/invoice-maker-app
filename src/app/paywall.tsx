import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Button, Screen } from '@/components/ui';
import { APP_NAME, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentOffering, PRO_FEATURES, purchase, restore, useIsPro, useSubscription, type ProFeature } from '@/lib/purchases';

function periodLabel(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case 'ANNUAL':
      return 'Yearly';
    case 'MONTHLY':
      return 'Monthly';
    case 'WEEKLY':
      return 'Weekly';
    case 'LIFETIME':
      return 'Lifetime';
    default:
      return pkg.product.title;
  }
}

function trialLabel(pkg: PurchasesPackage): string | null {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const unit = intro.periodUnit.toLowerCase();
  return `${intro.periodNumberOfUnits}-${unit} free trial`;
}

export default function Paywall() {
  const { feature } = useLocalSearchParams<{ feature?: ProFeature }>();
  const theme = useTheme();
  const isPro = useIsPro();
  const storeAvailable = useSubscription((s) => s.storeAvailable);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [loading, setLoading] = useState(storeAvailable);
  const [selected, setSelected] = useState<PurchasesPackage | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!storeAvailable) return;
    getCurrentOffering()
      .then((o) => {
        setOffering(o);
        setSelected(o?.annual ?? o?.availablePackages[0] ?? null);
      })
      .catch((e) => console.warn('Failed to load offerings', e))
      .finally(() => setLoading(false));
  }, [storeAvailable]);

  useEffect(() => {
    if (isPro) router.back();
  }, [isPro]);

  const buy = async () => {
    if (!selected) return;
    setWorking(true);
    try {
      await purchase(selected);
    } catch (e) {
      Alert.alert('Purchase failed', (e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const onRestore = async () => {
    setWorking(true);
    try {
      const restored = await restore();
      if (!restored) Alert.alert('Nothing to restore', 'No active subscription was found for this account.');
    } catch (e) {
      Alert.alert('Restore failed', (e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const trial = selected ? trialLabel(selected) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <Pressable onPress={() => router.back()} style={styles.close} accessibilityLabel="Close">
        <Ionicons name="close" size={26} color={theme.textSecondary} />
      </Pressable>
      <Screen>
        <View style={styles.hero}>
          <Ionicons name="sparkles" size={40} color={theme.tint} />
          <AppText variant="title" style={{ textAlign: 'center' }}>
            {APP_NAME} Pro
          </AppText>
          <AppText variant="caption" style={{ textAlign: 'center' }}>
            Get paid faster with unlimited, beautifully branded invoices. No weekly plans, no surprise charges — try it free and cancel in two taps.
          </AppText>
        </View>

        <View style={{ gap: Spacing.two }}>
          {PRO_FEATURES.map((f) => (
            <View key={f.key} style={[styles.feature, f.key === feature && { backgroundColor: theme.backgroundSelected }]}>
              <Ionicons name="checkmark-circle" size={22} color={theme.success} />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontWeight: '600' }}>{f.title}</AppText>
                <AppText variant="caption">{f.detail}</AppText>
              </View>
            </View>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator />
        ) : offering ? (
          <View style={{ gap: Spacing.two }}>
            {offering.availablePackages.map((pkg) => {
              const isSelected = selected?.identifier === pkg.identifier;
              const pkgTrial = trialLabel(pkg);
              return (
                <Pressable
                  key={pkg.identifier}
                  onPress={() => setSelected(pkg)}
                  style={[styles.plan, { borderColor: isSelected ? theme.tint : theme.border, backgroundColor: theme.backgroundElement }]}>
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontWeight: '700' }}>{periodLabel(pkg)}</AppText>
                    {pkgTrial ? (
                      <AppText variant="caption" color="success">
                        {pkgTrial}
                      </AppText>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <AppText variant="amount">{pkg.product.priceString}</AppText>
                    {pkg.packageType === 'ANNUAL' && pkg.product.pricePerMonthString ? (
                      <AppText variant="caption">{pkg.product.pricePerMonthString}/mo</AppText>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
            <Button title={trial ? `Start ${trial}` : 'Continue'} loading={working} disabled={!selected} onPress={buy} />
            {selected && trial ? (
              <AppText variant="caption" style={{ textAlign: 'center' }}>
                Free for the trial, then {selected.product.priceString} per {periodLabel(selected).toLowerCase().replace('ly', '')}. We’ll remind you
                before the trial ends. Cancel anytime in Settings → Manage subscription.
              </AppText>
            ) : null}
            <Button title="Restore purchases" variant="ghost" disabled={working} onPress={onRestore} />
          </View>
        ) : (
          <View style={{ gap: Spacing.two }}>
            <AppText variant="caption" style={{ textAlign: 'center' }}>
              Subscriptions are not available in this build. Set the RevenueCat API keys and run a development build on a
              device to test purchases.
            </AppText>
            {__DEV__ ? (
              <Button
                title="Simulate Pro (dev only)"
                variant="secondary"
                onPress={() => useSubscription.getState().setDevPro(true)}
              />
            ) : null}
          </View>
        )}
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  close: { alignSelf: 'flex-end', paddingHorizontal: 16, paddingVertical: 6 },
  hero: { alignItems: 'center', gap: Spacing.two },
  feature: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', padding: Spacing.two, borderRadius: 10 },
  plan: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderRadius: 14, padding: Spacing.three },
});
