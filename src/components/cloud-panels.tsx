import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { AppText, Field, ListRow, ProBadge, Section, ToggleRow } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useProGate } from '@/hooks/use-pro-gate';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { isValidISODate, nextOccurrence, recurrenceDate, todayISO } from '@/lib/calc';
import { getShareLink } from '@/lib/cloud';
import { formatDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { InvoiceDocument, Recurrence, RecurrenceFrequency } from '@/lib/types';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Email / link sharing, delivery status and per-invoice automation toggles. */
export function DeliveryPanel({ doc }: { doc: InvoiceDocument }) {
  const { isPro, signedIn, requireCloud } = useProGate();
  const update = useStore((s) => s.updateDocument);
  const [sharing, setSharing] = useState(false);
  const isInvoice = doc.type === 'invoice';
  const label = isInvoice ? 'Invoice' : 'Estimate';
  const onlinePayments = doc.payments.filter((p) => p.source === 'stripe').length;

  const shareLink = async () => {
    if (!requireCloud('onlinePayments') || sharing) return;
    setSharing(true);
    try {
      const url = await getShareLink(doc.id);
      await Share.share({ message: `${label} ${doc.number}: ${url}`, url });
    } catch (e) {
      Alert.alert('Could not create link', e instanceof ApiError ? e.message : 'Try again in a moment.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Section title="Send & get paid" action={!isPro ? <ProBadge /> : undefined}>
      <ListRow
        icon="mail-outline"
        title="Email to client"
        subtitle={isInvoice ? 'With a link to view, download and pay' : 'Client can approve online and pay a deposit'}
        onPress={() => requireCloud('onlinePayments') && router.push({ pathname: '/send', params: { docId: doc.id } })}
      />
      <ListRow
        icon="link-outline"
        title={sharing ? 'Creating link…' : 'Share link'}
        subtitle="Text it, WhatsApp it, anywhere"
        last={!doc.sentAt && !doc.viewedAt && !doc.approval && !onlinePayments && !(isPro && signedIn && isInvoice)}
        onPress={shareLink}
      />
      {doc.sentAt ? (
        <AppText variant="caption">
          ✉️ Emailed{doc.lastSentTo ? ` to ${doc.lastSentTo}` : ''} · {when(doc.sentAt)}
        </AppText>
      ) : null}
      {doc.viewedAt ? <AppText variant="caption">👀 Viewed by client · {when(doc.viewedAt)}</AppText> : null}
      {doc.approval ? (
        <AppText variant="caption" color="success">
          ✍️ Accepted by {doc.approval.name} · {when(doc.approval.at)}
        </AppText>
      ) : null}
      {onlinePayments ? <AppText variant="caption">💳 {onlinePayments} online payment{onlinePayments > 1 ? 's' : ''}</AppText> : null}
      {isPro && signedIn && isInvoice ? (
        <>
          <ToggleRow
            label="Accept card payments"
            value={doc.allowOnlinePayment !== false}
            onValueChange={(allowOnlinePayment) => update(doc.id, { allowOnlinePayment })}
          />
          <ToggleRow
            label="Automatic reminders"
            value={doc.remindersEnabled !== false}
            onValueChange={(remindersEnabled) => update(doc.id, { remindersEnabled })}
          />
        </>
      ) : null}
    </Section>
  );
}

const FREQUENCIES: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

function schedule(anchorDate: string, frequency: RecurrenceFrequency): Pick<Recurrence, 'anchorDate' | 'frequency' | 'count' | 'nextIssueDate'> {
  return { anchorDate, frequency, ...nextOccurrence(anchorDate, frequency, todayISO()) };
}

export function RecurrencePanel({ doc }: { doc: InvoiceDocument }) {
  const theme = useTheme();
  const { isPro, requireCloud } = useProGate();
  const update = useStore((s) => s.updateDocument);
  const parent = useStore((s) => (doc.recurringParentId ? s.documents[doc.recurringParentId] : undefined));
  const rec = doc.recurrence;
  const [endDraft, setEndDraft] = useState(rec?.endDate ?? '');

  const setRec = (patch: Partial<Recurrence>) => rec && update(doc.id, { recurrence: { ...rec, ...patch } });

  const toggle = (on: boolean) => {
    if (!on) return setRec({ active: false });
    if (!requireCloud('recurring')) return;
    const frequency = rec?.frequency ?? 'monthly';
    update(doc.id, {
      recurrence: { autoSend: rec?.autoSend ?? false, endDate: rec?.endDate, ...schedule(rec?.anchorDate ?? doc.issueDate, frequency), active: true },
    });
  };

  const nextAfterEnd = rec?.endDate && rec.nextIssueDate > rec.endDate;

  return (
    <Section title="Repeat" action={!isPro ? <ProBadge /> : undefined}>
      {parent ? (
        <ListRow icon="repeat-outline" title={`Created from ${parent.number}`} subtitle="Recurring schedule" onPress={() => router.push(`/document/${parent.id}`)} />
      ) : null}
      <ToggleRow label="Repeat this invoice" value={!!rec?.active} onValueChange={toggle} />
      {rec?.active ? (
        <>
          <View style={styles.chips}>
            {FREQUENCIES.map((f) => {
              const selected = rec.frequency === f.value;
              return (
                <Pressable
                  key={f.value}
                  onPress={() => setRec(schedule(rec.anchorDate, f.value))}
                  style={[styles.chip, { borderColor: selected ? theme.tint : theme.border, backgroundColor: selected ? theme.tint : 'transparent' }]}>
                  <AppText variant="caption" color={selected ? 'onTint' : 'text'}>
                    {f.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <ToggleRow label="Email each invoice automatically" value={rec.autoSend} onValueChange={(autoSend) => setRec({ autoSend })} />
          <Field
            label="End date (optional)"
            value={endDraft}
            placeholder="YYYY-MM-DD"
            error={endDraft && !isValidISODate(endDraft) ? 'Use YYYY-MM-DD' : undefined}
            onChangeText={(text) => {
              setEndDraft(text);
              if (!text) setRec({ endDate: undefined });
              else if (isValidISODate(text)) setRec({ endDate: text });
            }}
          />
          <AppText variant="caption">
            {nextAfterEnd
              ? 'The schedule has ended.'
              : `Next invoice ${formatDate(rec.nextIssueDate)}, then ${formatDate(recurrenceDate(rec.anchorDate, rec.frequency, rec.count + 2))}. ${
                  rec.autoSend ? 'Each one is emailed to your client.' : 'You’ll get a notification to review and send it.'
                }`}
          </AppText>
        </>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
});
