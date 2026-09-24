import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { Button, Card, EmptyState, Field, ListRow, Screen } from '@/components/ui';
import { useStore } from '@/lib/store';

export default function ClientPicker() {
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const clients = useStore((s) => s.clients);
  const selectedId = useStore((s) => s.documents[docId]?.clientId);
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(clients)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, query]);

  const choose = (clientId: string | undefined) => {
    useStore.getState().updateDocument(docId, { clientId });
    router.back();
  };

  return (
    <Screen>
      <Button
        title="New client"
        icon="person-add-outline"
        onPress={() => router.push({ pathname: '/client/[id]', params: { id: 'new', docId } })}
      />
      {Object.keys(clients).length > 0 ? <Field label="Search" value={query} onChangeText={setQuery} placeholder="Name or email" /> : null}
      {list.length === 0 ? (
        <EmptyState icon="people-outline" title="No clients yet" message="Add a client once and reuse their details on every invoice." />
      ) : (
        <Card>
          {list.map((c, i) => (
            <ListRow
              key={c.id}
              icon={c.id === selectedId ? 'checkmark-circle' : 'person-circle-outline'}
              title={c.name}
              subtitle={c.email}
              last={i === list.length - 1}
              onPress={() => choose(c.id)}
            />
          ))}
        </Card>
      )}
      {selectedId ? <Button title="Remove client" variant="ghost" onPress={() => choose(undefined)} /> : null}
    </Screen>
  );
}
