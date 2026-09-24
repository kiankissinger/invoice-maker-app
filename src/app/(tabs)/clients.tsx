import { router } from 'expo-router';
import { useMemo, useState } from 'react';

import { AppText, Button, Card, EmptyState, Field, ListRow, Screen } from '@/components/ui';
import { computeTotals } from '@/lib/calc';
import { formatMoney } from '@/lib/format';
import { useStore } from '@/lib/store';

export default function ClientsTab() {
  const clients = useStore((s) => s.clients);
  const documents = useStore((s) => s.documents);
  const currency = useStore((s) => s.profile.currency);
  const [query, setQuery] = useState('');

  const outstanding = useMemo(() => {
    const byClient: Record<string, number> = {};
    for (const doc of Object.values(documents)) {
      if (doc.type !== 'invoice' || !doc.clientId || doc.status !== 'sent') continue;
      byClient[doc.clientId] = (byClient[doc.clientId] ?? 0) + Math.max(0, computeTotals(doc).balance);
    }
    return byClient;
  }, [documents]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(clients)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, query]);

  return (
    <Screen>
      <Button title="New client" icon="person-add-outline" onPress={() => router.push('/client/new')} />
      {Object.keys(clients).length === 0 ? (
        <EmptyState icon="people-outline" title="No clients yet" message="Save client details once and bill them in seconds." />
      ) : (
        <>
          <Field label="Search" value={query} onChangeText={setQuery} placeholder="Name or email" />
          <Card>
            {list.map((c, i) => (
              <ListRow
                key={c.id}
                icon="person-circle-outline"
                title={c.name}
                subtitle={c.email || c.phone}
                last={i === list.length - 1}
                right={
                  outstanding[c.id] ? (
                    <AppText variant="amount" color="warning">
                      {formatMoney(outstanding[c.id], currency)}
                    </AppText>
                  ) : undefined
                }
                onPress={() => router.push(`/client/${c.id}`)}
              />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
