import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { AppText, Button, Card, Field, ListRow, Screen, Section } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { newId, useStore } from '@/lib/store';

type Draft = Awaited<ReturnType<typeof api.draftItems>>;

export default function AiDraftScreen() {
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const doc = useStore((s) => s.documents[docId]);
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  if (!doc) return null;

  const generate = async () => {
    setBusy(true);
    try {
      setDraft(await api.draftItems(description.trim(), doc.currency));
    } catch (e) {
      Alert.alert('Could not draft items', e instanceof ApiError ? e.message : 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!draft) return;
    const current = useStore.getState().documents[doc.id];
    const kept = current.items.filter((i) => i.description.trim() || i.unitPrice);
    useStore.getState().updateDocument(doc.id, {
      items: [
        ...kept,
        ...draft.items.map((i) => ({
          id: newId(),
          description: i.description,
          details: i.details ?? undefined,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          unit: i.unit ?? undefined,
          taxable: i.taxable,
        })),
      ],
      notes: draft.notes && !current.notes.trim() ? draft.notes : current.notes,
    });
    router.back();
  };

  return (
    <Screen>
      <AppText variant="caption">
        Describe the job the way you’d tell a friend — prices, hours, parts. Your saved items and prices are used when they match.
      </AppText>
      <Section title="The job">
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          multiline
          autoFocus
          placeholder={'Replaced 50-gal water heater. 4 hrs labor at $85/hr, heater $650, fittings and valve $45, haul away old unit $75.'}
          style={{ minHeight: 140 }}
        />
      </Section>
      <Button title={draft ? 'Try again' : 'Draft line items'} icon="sparkles" variant={draft ? 'secondary' : 'primary'} loading={busy} disabled={description.trim().length < 3} onPress={generate} />
      {draft ? (
        <>
          <Card>
            {draft.items.map((item, i) => (
              <ListRow
                key={i}
                title={item.description}
                subtitle={`${item.quantity}${item.unit ? ` ${item.unit}` : ''} × ${formatMoney(item.unitPrice, doc.currency)}${item.unitPrice === 0 ? ' — add a price' : ''}`}
                right={<AppText variant="amount">{formatMoney(item.quantity * item.unitPrice, doc.currency)}</AppText>}
                last={i === draft.items.length - 1}
              />
            ))}
          </Card>
          <Button title={`Add ${draft.items.length} item${draft.items.length === 1 ? '' : 's'}`} icon="checkmark" disabled={!draft.items.length} onPress={apply} />
        </>
      ) : null}
    </Screen>
  );
}
