import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, View } from 'react-native';

import { NumberField } from '@/components/number-field';
import { AppText, Card, Field, ListRow, ProBadge, Row, Screen, Section, ToggleRow } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useProGate } from '@/hooks/use-pro-gate';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCIES } from '@/lib/format';
import { TEMPLATES } from '@/lib/pdf';
import { useAccount } from '@/lib/account';
import { getManagementUrl, useSubscription } from '@/lib/purchases';
import { useSyncStatus } from '@/lib/sync';
import { useStore } from '@/lib/store';

const ACCENTS = ['#2563EB', '#0F766E', '#7C3AED', '#DB2777', '#EA580C', '#111827', '#15803D', '#B91C1C'];

export default function SettingsTab() {
  const theme = useTheme();
  const profile = useStore((s) => s.profile);
  const update = useStore((s) => s.updateProfile);
  const { isPro, requirePro } = useProGate();
  const devPro = useSubscription((s) => s.devPro);
  const user = useAccount((s) => s.user);
  const chargesEnabled = useAccount((s) => s.me?.payments.chargesEnabled);
  const lastSyncedAt = useSyncStatus((s) => s.lastSyncedAt);

  return (
    <Screen>
      <Card>
        <ListRow
          icon="sparkles"
          title={isPro ? 'Pro is active' : 'Upgrade to Pro'}
          subtitle={isPro ? 'Thanks for supporting the app!' : 'Free trial · unlimited invoices · no watermark'}
          last={!isPro}
          onPress={isPro ? undefined : () => router.push('/paywall')}
        />
        {isPro ? (
          <ListRow
            icon="card-outline"
            title="Manage subscription"
            subtitle="Change plan or cancel anytime"
            last
            onPress={async () => void WebBrowser.openBrowserAsync(await getManagementUrl())}
          />
        ) : null}
      </Card>

      <Section title="Your business">
        <ListRow icon="business-outline" title={profile.name || 'Business profile'} subtitle="Logo, contact details, payment instructions" onPress={() => router.push('/business')} />
        <ListRow icon="pricetags-outline" title="Saved items & services" right={!isPro ? <ProBadge /> : undefined} last onPress={() => requirePro('catalog') && router.push('/catalog')} />
      </Section>

      <Section title="Cloud & payments" action={!isPro ? <ProBadge /> : undefined}>
        <ListRow
          icon="cloud-outline"
          title={user ? user.email : 'Sign in'}
          subtitle={user ? (lastSyncedAt ? `Synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : 'Account & sync') : 'Sync, backup and sending from the cloud'}
          onPress={() => router.push('/account')}
        />
        <ListRow
          icon="card-outline"
          title="Online payments & reminders"
          subtitle={chargesEnabled ? 'Stripe connected' : 'Get paid by card, remind clients automatically'}
          last
          onPress={() => requirePro('onlinePayments') && router.push('/payments')}
        />
      </Section>

      <Section title="Look & feel" action={!isPro ? <ProBadge /> : undefined}>
        <AppText variant="caption">Default template</AppText>
        <View style={styles.chips}>
          {TEMPLATES.map((t) => {
            const selected = profile.templateId === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => (!t.pro || requirePro('templates')) && update({ templateId: t.id })}
                style={[styles.chip, { borderColor: selected ? theme.tint : theme.border, backgroundColor: selected ? theme.tint : 'transparent' }]}>
                <AppText variant="caption" color={selected ? 'onTint' : 'text'}>
                  {t.name}
                  {t.pro && !isPro ? ' 🔒' : ''}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="caption">Brand color</AppText>
        <View style={styles.chips}>
          {ACCENTS.map((color) => (
            <Pressable
              key={color}
              accessibilityLabel={`Brand color ${color}`}
              onPress={() => requirePro('branding') && update({ accentColor: color })}
              style={[styles.swatch, { backgroundColor: color, borderColor: profile.accentColor === color ? theme.text : 'transparent' }]}
            />
          ))}
        </View>
      </Section>

      <Section title="Defaults for new documents">
        <AppText variant="caption">Currency</AppText>
        <View style={styles.chips}>
          {CURRENCIES.map((c) => {
            const selected = profile.currency === c;
            return (
              <Pressable
                key={c}
                onPress={() => update({ currency: c })}
                style={[styles.chip, { borderColor: selected ? theme.tint : theme.border, backgroundColor: selected ? theme.tint : 'transparent' }]}>
                <AppText variant="caption" color={selected ? 'onTint' : 'text'}>
                  {c}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <Row>
          <Field label="Tax label" value={profile.taxLabel} onChangeText={(taxLabel) => update({ taxLabel })} />
          <NumberField label="Tax rate %" value={profile.defaultTaxRate} onChange={(defaultTaxRate) => update({ defaultTaxRate })} />
        </Row>
        <NumberField
          label="Payment terms (days)"
          value={profile.defaultPaymentTermsDays}
          onChange={(days) => update({ defaultPaymentTermsDays: Math.max(0, Math.round(days)) })}
        />
        <Row>
          <Field label="Invoice prefix" value={profile.invoicePrefix} onChangeText={(invoicePrefix) => update({ invoicePrefix })} autoCapitalize="characters" />
          <NumberField
            label="Next number"
            value={profile.nextInvoiceNumber}
            onChange={(n) => update({ nextInvoiceNumber: Math.max(1, Math.round(n)) })}
          />
        </Row>
        <Row>
          <Field label="Estimate prefix" value={profile.estimatePrefix} onChangeText={(estimatePrefix) => update({ estimatePrefix })} autoCapitalize="characters" />
          <NumberField
            label="Next number"
            value={profile.nextEstimateNumber}
            onChange={(n) => update({ nextEstimateNumber: Math.max(1, Math.round(n)) })}
          />
        </Row>
        <Field label="Default notes" value={profile.defaultNotes} onChangeText={(defaultNotes) => update({ defaultNotes })} multiline />
        <Field label="Default terms" value={profile.defaultTerms} onChangeText={(defaultTerms) => update({ defaultTerms })} multiline />
      </Section>

      {__DEV__ ? (
        <Section title="Developer">
          <ToggleRow label="Simulate Pro" value={devPro} onValueChange={(v) => useSubscription.getState().setDevPro(v)} />
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 3 },
});
