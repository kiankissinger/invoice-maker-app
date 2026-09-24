import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable } from 'react-native';

import { NumberField } from '@/components/number-field';
import { AppText, Button, Card, EmptyState, Field, ListRow, Row, Screen, Section, ToggleRow } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/format';
import { newId, useStore } from '@/lib/store';
import type { CatalogItem } from '@/lib/types';

/** Manage saved items. With a `docId` param, tapping an item adds it to that document. */
export default function CatalogScreen() {
  const { docId } = useLocalSearchParams<{ docId?: string }>();
  const theme = useTheme();
  const catalog = useStore((s) => s.catalog);
  const currency = useStore((s) => s.profile.currency);
  const [editing, setEditing] = useState<Partial<CatalogItem> | null>(null);

  const items = useMemo(() => Object.values(catalog).sort((a, b) => a.description.localeCompare(b.description)), [catalog]);

  const pick = (item: CatalogItem) => {
    const doc = useStore.getState().documents[docId!];
    if (!doc) return;
    const { id: _id, ...rest } = item;
    // Replace a blank first row rather than leaving it dangling.
    const kept = doc.items.filter((i) => i.description.trim() || i.unitPrice);
    useStore.getState().updateDocument(doc.id, { items: [...kept, { ...rest, id: newId(), quantity: 1 }] });
    router.back();
  };

  if (editing) {
    return (
      <Screen>
        <Section title={editing.id ? 'Edit item' : 'New item'}>
          <Field label="Description" value={editing.description ?? ''} onChangeText={(description) => setEditing({ ...editing, description })} autoFocus />
          <Field label="Details" value={editing.details ?? ''} onChangeText={(details) => setEditing({ ...editing, details })} multiline />
          <Row>
            <NumberField label="Rate" value={editing.unitPrice ?? 0} onChange={(unitPrice) => setEditing({ ...editing, unitPrice })} />
            <Field label="Unit" value={editing.unit ?? ''} onChangeText={(unit) => setEditing({ ...editing, unit })} placeholder="hrs" />
          </Row>
          <ToggleRow label="Taxable" value={editing.taxable ?? true} onValueChange={(taxable) => setEditing({ ...editing, taxable })} />
        </Section>
        <Button
          title="Save item"
          icon="checkmark"
          disabled={!editing.description?.trim()}
          onPress={() => {
            useStore.getState().upsertCatalogItem({
              id: editing.id,
              description: editing.description!.trim(),
              details: editing.details,
              unitPrice: editing.unitPrice ?? 0,
              unit: editing.unit,
              taxable: editing.taxable ?? true,
            });
            setEditing(null);
          }}
        />
        {editing.id ? (
          <Button
            title="Delete item"
            variant="ghost"
            onPress={() => {
              useStore.getState().deleteCatalogItem(editing.id!);
              setEditing(null);
            }}
          />
        ) : null}
        <Button title="Cancel" variant="secondary" onPress={() => setEditing(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Button title="New item" icon="add" onPress={() => setEditing({ taxable: true })} />
      {items.length === 0 ? (
        <EmptyState icon="pricetags-outline" title="No saved items" message="Save the products and services you bill most, then add them to any invoice with a tap." />
      ) : (
        <Card>
          {docId ? <AppText variant="caption">Tap an item to add it.</AppText> : null}
          {items.map((item, i) => (
            <ListRow
              key={item.id}
              title={item.description}
              subtitle={`${formatMoney(item.unitPrice, currency)}${item.unit ? ` / ${item.unit}` : ''}`}
              last={i === items.length - 1}
              onPress={() => (docId ? pick(item) : setEditing(item))}
              right={
                docId ? (
                  <Pressable onPress={() => setEditing(item)} accessibilityLabel="Edit item">
                    <Ionicons name="create-outline" size={18} color={theme.tint} />
                  </Pressable>
                ) : undefined
              }
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
