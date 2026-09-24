import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { NumberField } from '@/components/number-field';
import { AppText, Button, Row, Screen, Section, Segmented, ToggleRow } from '@/components/ui';
import { useProGate } from '@/hooks/use-pro-gate';
import { api, ApiError, type StripeStatus } from '@/lib/api';
import { useStore } from '@/lib/store';

export default function PaymentsScreen() {
  const { requireCloud, signedIn, isPro } = useProGate();
  const reminders = useStore((s) => s.profile.reminders);
  const lateFee = useStore((s) => s.profile.lateFee);
  const updateProfile = useStore((s) => s.updateProfile);
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!signedIn) return;
    api.stripeStatus().then(setStatus).catch(() => setStatus(null));
  }, [signedIn]);
  useFocusEffect(refresh);

  const setReminders = (patch: Partial<typeof reminders>) => updateProfile({ reminders: { ...reminders, ...patch } });
  const setLateFee = (patch: Partial<typeof lateFee>) => updateProfile({ lateFee: { ...lateFee, ...patch } });

  const open = async (getUrl: () => Promise<{ url: string }>) => {
    if (!requireCloud('onlinePayments')) return;
    setBusy(true);
    try {
      const { url } = await getUrl();
      await WebBrowser.openBrowserAsync(url);
      refresh();
    } catch (e) {
      Alert.alert('Stripe', e instanceof ApiError ? e.message : 'Could not open Stripe.');
    } finally {
      setBusy(false);
    }
  };

  const stripeText = !status
    ? 'Connect Stripe so clients can pay invoices by card, Apple Pay or Google Pay. Money goes straight to your bank.'
    : !status.configured
      ? 'Online payments are not configured on the server yet.'
      : status.chargesEnabled
        ? 'Connected. A “Pay now” button appears on every invoice link, and paid invoices update automatically.'
        : status.connected
          ? 'Almost there — finish your Stripe setup to start accepting payments.'
          : 'Connect Stripe so clients can pay invoices by card, Apple Pay or Google Pay. Money goes straight to your bank.';

  return (
    <Screen>
      <Section title="Online payments">
        <AppText variant="caption" color={status?.chargesEnabled ? 'success' : 'textSecondary'}>
          {stripeText}
        </AppText>
        {status?.chargesEnabled ? (
          <Button title="Open Stripe dashboard" icon="open-outline" variant="secondary" loading={busy} onPress={() => open(api.stripeDashboard)} />
        ) : (
          <Button
            title={status?.connected ? 'Finish Stripe setup' : 'Connect Stripe'}
            icon="card-outline"
            loading={busy}
            disabled={status?.configured === false}
            onPress={() => open(api.connectStripe)}
          />
        )}
      </Section>

      <Section title="Automatic reminders">
        <AppText variant="caption">
          Emails your client about unpaid invoices that have been sent, during their business hours. Turn reminders off for a single invoice
          from the invoice screen.
        </AppText>
        <ToggleRow
          label="Send reminders"
          value={reminders.enabled}
          onValueChange={(enabled) => (!enabled || requireCloud('reminders')) && setReminders({ enabled })}
        />
        {reminders.enabled ? (
          <>
            <Row>
              <NumberField
                label="Days before due"
                value={reminders.daysBefore}
                onChange={(v) => setReminders({ daysBefore: Math.max(0, Math.round(v)) })}
                hint="0 = off"
              />
              <NumberField
                label="Then every N days late"
                value={reminders.everyDaysAfter}
                onChange={(v) => setReminders({ everyDaysAfter: Math.max(0, Math.round(v)) })}
                hint="0 = off"
              />
            </Row>
            <ToggleRow label="Remind on the due date" value={reminders.onDueDate} onValueChange={(onDueDate) => setReminders({ onDueDate })} />
            <NumberField label="Stop after this many overdue reminders" value={reminders.maxAfter} onChange={(v) => setReminders({ maxAfter: Math.max(0, Math.round(v)) })} />
          </>
        ) : null}
        {!isPro || !signedIn ? (
          <AppText variant="caption">Reminders need Pro and a signed-in account.</AppText>
        ) : null}
      </Section>

      <Section title="Late fees">
        <AppText variant="caption">
          Adds a one-time “Late payment fee” line to sent invoices once they are overdue by more than the grace period. Check local rules on
          maximum late fees and mention them in your terms.
        </AppText>
        <ToggleRow label="Add late fees automatically" value={lateFee.enabled} onValueChange={(enabled) => (!enabled || requireCloud('lateFees')) && setLateFee({ enabled })} />
        {lateFee.enabled ? (
          <>
            <Segmented
              options={[
                { value: 'percent', label: '% of balance' },
                { value: 'amount', label: 'Flat amount' },
              ]}
              value={lateFee.kind}
              onChange={(kind) => setLateFee({ kind })}
            />
            <Row>
              <NumberField key={lateFee.kind} label={lateFee.kind === 'percent' ? 'Fee %' : 'Fee amount'} value={lateFee.value} onChange={(value) => setLateFee({ value: Math.max(0, value) })} />
              <NumberField label="Grace days" value={lateFee.graceDays} onChange={(v) => setLateFee({ graceDays: Math.max(0, Math.round(v)) })} />
            </Row>
          </>
        ) : null}
      </Section>
    </Screen>
  );
}
