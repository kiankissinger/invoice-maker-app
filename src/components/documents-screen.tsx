import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, EmptyState, Field, ListRow, Row, Screen, Segmented, StatusBadge } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useProGate } from '@/hooks/use-pro-gate';
import { computeTotals, displayStatus, todayISO } from '@/lib/calc';
import { formatDate, formatMoney } from '@/lib/format';
import { FREE_DOCUMENT_LIMIT } from '@/lib/purchases';
import { useStore } from '@/lib/store';
import type { DisplayStatus, DocType } from '@/lib/types';

type Filter = 'all' | 'open' | 'overdue' | 'paid' | 'draft';

const INVOICE_FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
];

const ESTIMATE_FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'open', label: 'Sent' },
];

function matches(filter: Filter, status: DisplayStatus): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'open':
      return status === 'sent' || status === 'partial' || status === 'overdue';
    case 'overdue':
      return status === 'overdue';
    case 'paid':
      return status === 'paid';
    case 'draft':
      return status === 'draft';
  }
}

export function DocumentsScreen({ type }: { type: DocType }) {
  const documents = useStore((s) => s.documents);
  const clients = useStore((s) => s.clients);
  const profile = useStore((s) => s.profile);
  const createDocument = useStore((s) => s.createDocument);
  const { isPro, canCreateDocument, freeDocumentsLeft } = useProGate();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const today = todayISO();
  const rows = useMemo(
    () =>
      Object.values(documents)
        .filter((doc) => doc.type === type)
        .map((doc) => ({ doc, status: displayStatus(doc, today), totals: computeTotals(doc) }))
        .sort((a, b) => b.doc.issueDate.localeCompare(a.doc.issueDate) || b.doc.number.localeCompare(a.doc.number)),
    [documents, type, today]
  );

  const summary = useMemo(() => {
    let outstanding = 0;
    let overdue = 0;
    let paidThisMonth = 0;
    const month = today.slice(0, 7);
    for (const { doc, status, totals } of rows) {
      if (status === 'sent' || status === 'partial' || status === 'overdue') outstanding += totals.balance;
      if (status === 'overdue') overdue += totals.balance;
      for (const p of doc.payments) if (p.date.startsWith(month)) paidThisMonth += p.amount;
    }
    return { outstanding, overdue, paidThisMonth };
  }, [rows, today]);

  const q = query.trim().toLowerCase();
  const visible = rows.filter(
    ({ doc, status }) =>
      matches(filter, status) &&
      (!q ||
        doc.number.toLowerCase().includes(q) ||
        (doc.clientId && clients[doc.clientId]?.name.toLowerCase().includes(q)))
  );

  const onCreate = () => {
    if (!canCreateDocument()) return;
    const doc = createDocument(type);
    router.push(`/document/${doc.id}`);
  };

  const label = type === 'invoice' ? 'Invoice' : 'Estimate';

  return (
    <Screen>
        {type === 'invoice' ? (
          <Row style={styles.stats}>
            <Stat label="Outstanding" value={formatMoney(summary.outstanding, profile.currency)} />
            <Stat label="Overdue" value={formatMoney(summary.overdue, profile.currency)} danger={summary.overdue > 0} />
            <Stat label="Paid this month" value={formatMoney(summary.paidThisMonth, profile.currency)} />
          </Row>
        ) : null}

        {!isPro ? (
          <Card>
            <AppText variant="caption">
              Free plan: {freeDocumentsLeft} of {FREE_DOCUMENT_LIMIT} documents left. Upgrade for unlimited invoices, no watermark and every template.
            </AppText>
            <Button title="Start free trial" variant="secondary" icon="sparkles" onPress={() => router.push('/paywall')} />
          </Card>
        ) : null}

        <Button title={`New ${label}`} icon="add" onPress={onCreate} />

        {rows.length > 0 ? (
          <Field
            label="Search"
            placeholder="Number or client"
            value={query}
            onChangeText={setQuery}
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
        ) : null}

        {rows.length > 0 ? (
          <Segmented options={type === 'invoice' ? INVOICE_FILTERS : ESTIMATE_FILTERS} value={filter} onChange={setFilter} />
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            icon={type === 'invoice' ? 'document-text-outline' : 'clipboard-outline'}
            title={`No ${label.toLowerCase()}s yet`}
            message={
              type === 'invoice'
                ? 'Create a professional invoice in under a minute and send it as a PDF.'
                : 'Send an estimate, capture a signature, then convert it to an invoice in one tap.'
            }
          />
        ) : visible.length === 0 ? (
          <AppText variant="caption" style={{ textAlign: 'center' }}>
            Nothing matches.
          </AppText>
        ) : (
          <Card>
            {visible.map(({ doc, status, totals }, index) => (
              <ListRow
                key={doc.id}
                title={(doc.clientId && clients[doc.clientId]?.name) || 'No client'}
                subtitle={`${doc.number} · ${formatDate(doc.issueDate)}`}
                last={index === visible.length - 1}
                onPress={() => router.push(`/document/${doc.id}`)}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <AppText variant="amount">
                      {formatMoney(type === 'invoice' && status !== 'paid' ? totals.balance : totals.total, doc.currency)}
                    </AppText>
                    <StatusBadge status={status} />
                  </View>
                }
              />
            ))}
          </Card>
        )}
    </Screen>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <Card style={styles.stat}>
      <AppText variant="caption" numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="amount" color={danger ? 'danger' : 'text'} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  stats: { alignItems: 'stretch' },
  stat: { flex: 1, padding: Spacing.two + 4, gap: 2 },
});
