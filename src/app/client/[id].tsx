import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { AppText, Button, Card, Field, ListRow, Row, Screen, Section, StatusBadge } from '@/components/ui';
import { computeTotals, displayStatus } from '@/lib/calc';
import { formatDate, formatMoney } from '@/lib/format';
import { useStore } from '@/lib/store';

export default function ClientScreen() {
  const { id, docId } = useLocalSearchParams<{ id: string; docId?: string }>();
  const isNew = id === 'new';
  const existing = useStore((s) => (isNew ? undefined : s.clients[id]));
  const documents = useStore((s) => s.documents);
  const currency = useStore((s) => s.profile.currency);

  const [form, setForm] = useState({
    name: existing?.name ?? '',
    contactName: existing?.contactName ?? '',
    email: existing?.email ?? '',
    phone: existing?.phone ?? '',
    address: existing?.address ?? '',
    notes: existing?.notes ?? '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const history = useMemo(
    () =>
      isNew
        ? []
        : Object.values(documents)
            .filter((d) => d.clientId === id)
            .sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
    [documents, id, isNew]
  );

  const stats = useMemo(() => {
    let billed = 0;
    let outstanding = 0;
    for (const doc of history) {
      if (doc.type !== 'invoice' || doc.status === 'void') continue;
      const t = computeTotals(doc);
      billed += t.total;
      if (doc.status !== 'draft') outstanding += Math.max(0, t.balance);
    }
    return { billed, outstanding };
  }, [history]);

  const save = () => {
    if (!form.name.trim()) {
      Alert.alert('Name required', 'Give this client a name.');
      return;
    }
    const client = useStore.getState().upsertClient({ ...form, name: form.name.trim(), id: existing?.id });
    if (docId) {
      useStore.getState().updateDocument(docId, { clientId: client.id });
      router.dismissTo({ pathname: '/document/[id]', params: { id: docId } });
      return;
    }
    router.back();
  };

  const remove = () => {
    const doIt = () => {
      router.back();
      useStore.getState().deleteClient(id);
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this client? Their invoices are kept.')) doIt();
      return;
    }
    Alert.alert('Delete client', 'Their invoices are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doIt },
    ]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New client' : form.name || 'Client' }} />

      {!isNew ? (
        <Row>
          <Card style={{ flex: 1 }}>
            <AppText variant="caption">Billed</AppText>
            <AppText variant="amount">{formatMoney(stats.billed, currency)}</AppText>
          </Card>
          <Card style={{ flex: 1 }}>
            <AppText variant="caption">Outstanding</AppText>
            <AppText variant="amount" color={stats.outstanding > 0 ? 'warning' : 'text'}>
              {formatMoney(stats.outstanding, currency)}
            </AppText>
          </Card>
        </Row>
      ) : null}

      <Section title="Details">
        <Field label="Client or company name" value={form.name} onChangeText={set('name')} autoFocus={isNew} />
        <Field label="Contact person" value={form.contactName} onChangeText={set('contactName')} />
        <Field label="Email" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label="Billing address" value={form.address} onChangeText={set('address')} multiline />
        <Field label="Private notes" value={form.notes} onChangeText={set('notes')} multiline hint="Never shown on documents." />
      </Section>

      <Button title="Save client" icon="checkmark" onPress={save} />

      {history.length > 0 ? (
        <Section title="History">
          {history.map((doc, i) => (
            <ListRow
              key={doc.id}
              title={`${doc.type === 'invoice' ? 'Invoice' : 'Estimate'} ${doc.number}`}
              subtitle={formatDate(doc.issueDate)}
              last={i === history.length - 1}
              right={<StatusBadge status={displayStatus(doc)} />}
              onPress={() => router.push(`/document/${doc.id}`)}
            />
          ))}
        </Section>
      ) : null}

      {!isNew ? <Button title="Delete client" variant="ghost" onPress={remove} /> : null}
    </Screen>
  );
}
