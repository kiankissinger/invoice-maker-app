import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { NumberField } from '@/components/number-field';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  Field,
  ListRow,
  ProBadge,
  Row,
  Screen,
  Section,
  Segmented,
  StatusBadge,
  ToggleRow,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useProGate } from '@/hooks/use-pro-gate';
import { useTheme } from '@/hooks/use-theme';
import { addDays, computeTotals, displayStatus, isValidISODate, lineTotal } from '@/lib/calc';
import { formatDate, formatMoney, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { previewDocument, shareDocumentPdf, SIGNATURE_HEIGHT, SIGNATURE_WIDTH, TEMPLATES } from '@/lib/pdf';
import { emptyLineItem, useStore } from '@/lib/store';
import type { InvoiceDocument, LineItem } from '@/lib/types';

const TERMS = [
  { label: 'On receipt', days: 0 },
  { label: 'Net 7', days: 7 },
  { label: 'Net 14', days: 14 },
  { label: 'Net 15', days: 15 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 60', days: 60 },
];

function confirm(title: string, message: string, onConfirm: () => void, destructive = true) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: title, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

export default function DocumentEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useStore((s) => s.documents[id]);

  if (!doc) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Not found' }} />
        <EmptyState icon="alert-circle-outline" title="Document not found" message="It may have been deleted." />
      </Screen>
    );
  }
  return <Editor doc={doc} />;
}

function Editor({ doc }: { doc: InvoiceDocument }) {
  const theme = useTheme();
  const profile = useStore((s) => s.profile);
  const client = useStore((s) => (doc.clientId ? s.clients[doc.clientId] : undefined));
  const update = useStore((s) => s.updateDocument);
  const { isPro, requirePro, canCreateDocument } = useProGate();
  const [busy, setBusy] = useState<'preview' | 'share' | null>(null);

  const isInvoice = doc.type === 'invoice';
  const totals = computeTotals(doc);
  const status = displayStatus(doc);
  const money = (n: number) => formatMoney(n, doc.currency);
  const patch = (p: Partial<InvoiceDocument>) => update(doc.id, p);

  const setItem = (itemId: string, p: Partial<LineItem>) =>
    patch({ items: doc.items.map((item) => (item.id === itemId ? { ...item, ...p } : item)) });

  const renderInput = { doc, client, profile, isPro };

  const run = async (kind: 'preview' | 'share') => {
    setBusy(kind);
    try {
      if (kind === 'preview') await previewDocument(renderInput);
      else {
        await shareDocumentPdf(renderInput);
        if (doc.status === 'draft') patch({ status: 'sent' });
      }
    } catch (error) {
      Alert.alert('Something went wrong', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onDuplicate = () => {
    if (!requirePro('duplicate') || !canCreateDocument()) return;
    const copy = useStore.getState().duplicateDocument(doc.id);
    if (copy) router.replace(`/document/${copy.id}`);
  };

  const onConvert = () => {
    if (!requirePro('convert')) return;
    const invoice = useStore.getState().convertEstimateToInvoice(doc.id);
    if (invoice) router.replace(`/document/${invoice.id}`);
  };

  const onDelete = () =>
    confirm('Delete', `Delete ${doc.number}? This can't be undone.`, () => {
      router.back();
      useStore.getState().deleteDocument(doc.id);
    });

  return (
    <Screen>
      <Stack.Screen options={{ title: `${isInvoice ? 'Invoice' : 'Estimate'} ${doc.number}` }} />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <StatusBadge status={status} />
          <AppText variant="caption">Updated {formatDate(doc.updatedAt.slice(0, 10))}</AppText>
        </Row>
        <AppText variant="caption">{isInvoice && totals.paid ? 'Balance due' : 'Total'}</AppText>
        <AppText variant="title">{money(isInvoice ? totals.balance : totals.total)}</AppText>
        <Row>
          <Button title="Preview" icon="eye-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'preview'} onPress={() => run('preview')} />
          <Button title="Send PDF" icon="share-outline" style={{ flex: 1 }} loading={busy === 'share'} onPress={() => run('share')} />
        </Row>
      </Card>

      <Section title="Client">
        <ListRow
          icon="person-circle-outline"
          title={client?.name ?? 'Choose client'}
          subtitle={client?.email}
          last
          onPress={() => router.push({ pathname: '/client-picker', params: { docId: doc.id } })}
        />
      </Section>

      <Section title="Details">
        <Row>
          <Field label="Number" value={doc.number} onChangeText={(number) => patch({ number })} autoCapitalize="characters" />
          <Field label="PO number" value={doc.poNumber ?? ''} onChangeText={(poNumber) => patch({ poNumber })} placeholder="Optional" />
        </Row>
        <Row>
          <DateField label="Issue date" value={doc.issueDate} onChange={(issueDate) => patch({ issueDate })} />
          <DateField label={isInvoice ? 'Due date' : 'Valid until'} value={doc.dueDate ?? ''} onChange={(dueDate) => patch({ dueDate })} />
        </Row>
        {isInvoice ? (
          <View style={styles.chips}>
            {TERMS.map((t) => {
              const selected = doc.dueDate === addDays(doc.issueDate, t.days);
              return (
                <Pressable
                  key={t.label}
                  onPress={() => patch({ dueDate: addDays(doc.issueDate, t.days) })}
                  style={[styles.chip, { borderColor: selected ? theme.tint : theme.border, backgroundColor: selected ? theme.tint : 'transparent' }]}>
                  <AppText variant="caption" color={selected ? 'onTint' : 'text'}>
                    {t.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Section>

      <Section
        title="Items"
        action={
          <Pressable onPress={() => requirePro('catalog') && router.push({ pathname: '/catalog', params: { docId: doc.id } })}>
            <Row>
              <AppText variant="caption" color="tint">
                From saved items
              </AppText>
              {!isPro ? <ProBadge /> : null}
            </Row>
          </Pressable>
        }>
        {doc.items.map((item, index) => (
          <LineItemEditor
            key={item.id}
            item={item}
            index={index}
            currency={doc.currency}
            onChange={(p) => setItem(item.id, p)}
            onRemove={() => patch({ items: doc.items.filter((i) => i.id !== item.id) })}
            onSave={() => {
              if (!requirePro('catalog')) return;
              const { id: _id, quantity: _q, ...rest } = item;
              useStore.getState().upsertCatalogItem(rest);
              Alert.alert('Saved', `"${item.description || 'Item'}" added to your saved items.`);
            }}
          />
        ))}
        <Button title="Add line item" icon="add" variant="ghost" onPress={() => patch({ items: [...doc.items, emptyLineItem()] })} />
      </Section>

      <Section title="Discount, tax & shipping">
        <Segmented
          options={[
            { value: 'percent', label: 'Discount %' },
            { value: 'amount', label: 'Discount amount' },
          ]}
          value={doc.discount.kind}
          onChange={(kind) => patch({ discount: { ...doc.discount, kind } })}
        />
        <NumberField label="Discount" value={doc.discount.value} onChange={(value) => patch({ discount: { ...doc.discount, value } })} />
        <Row>
          <Field label="Tax label" value={doc.taxLabel} onChangeText={(taxLabel) => patch({ taxLabel })} />
          <NumberField label="Tax rate %" value={doc.taxRate} onChange={(taxRate) => patch({ taxRate })} />
        </Row>
        <NumberField label="Shipping" value={doc.shipping} onChange={(shipping) => patch({ shipping })} />
      </Section>

      <Section title="Summary">
        <TotalLine label="Subtotal" value={money(totals.subtotal)} />
        {totals.discount ? <TotalLine label="Discount" value={`−${money(totals.discount)}`} /> : null}
        {totals.tax ? <TotalLine label={`${doc.taxLabel} (${doc.taxRate}%)`} value={money(totals.tax)} /> : null}
        {totals.shipping ? <TotalLine label="Shipping" value={money(totals.shipping)} /> : null}
        <TotalLine label="Total" value={money(totals.total)} strong />
        {isInvoice && totals.paid ? (
          <>
            <TotalLine label="Paid" value={`−${money(totals.paid)}`} />
            <TotalLine label="Balance due" value={money(totals.balance)} strong />
          </>
        ) : null}
      </Section>

      {isInvoice ? (
        <Section title="Payments">
          {doc.payments.length === 0 ? <AppText variant="caption">No payments recorded yet.</AppText> : null}
          {doc.payments.map((p) => (
            <ListRow
              key={p.id}
              icon="cash-outline"
              title={money(p.amount)}
              subtitle={`${formatDate(p.date)} · ${PAYMENT_METHOD_LABELS[p.method]}${p.note ? ` · ${p.note}` : ''}`}
              right={
                <Pressable onPress={() => confirm('Remove', 'Remove this payment?', () => useStore.getState().removePayment(doc.id, p.id))}>
                  <Ionicons name="trash-outline" size={18} color={theme.danger} />
                </Pressable>
              }
            />
          ))}
          <Button
            title={totals.balance > 0 ? 'Record payment' : 'Record another payment'}
            icon="add-circle-outline"
            variant="secondary"
            onPress={() => router.push({ pathname: '/payment', params: { docId: doc.id } })}
          />
        </Section>
      ) : null}

      <Section title="Notes & terms">
        <Field label="Notes" value={doc.notes} onChangeText={(notes) => patch({ notes })} multiline />
        <Field label="Terms & conditions" value={doc.terms} onChangeText={(terms) => patch({ terms })} multiline />
      </Section>

      <Section title="Signature" action={!isPro ? <ProBadge /> : undefined}>
        {doc.signature ? (
          <>
            <View style={styles.signaturePreview}>
              <Svg width="100%" height="100%" viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`}>
                <Path d={doc.signature.path} stroke="#111" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <Row>
              <Button title="Re-sign" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/signature', params: { docId: doc.id } })} />
              <Button title="Remove" variant="ghost" style={{ flex: 1 }} onPress={() => patch({ signature: undefined })} />
            </Row>
          </>
        ) : (
          <Button
            title={isInvoice ? 'Add signature' : 'Capture client signature'}
            icon="create-outline"
            variant="secondary"
            onPress={() => requirePro('signature') && router.push({ pathname: '/signature', params: { docId: doc.id } })}
          />
        )}
      </Section>

      <Section title="Template">
        <View style={styles.chips}>
          {TEMPLATES.map((t) => {
            const selected = doc.templateId === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => (!t.pro || requirePro('templates')) && patch({ templateId: t.id })}
                style={[styles.chip, { borderColor: selected ? theme.tint : theme.border, backgroundColor: selected ? theme.tint : 'transparent' }]}>
                <AppText variant="caption" color={selected ? 'onTint' : 'text'}>
                  {t.name}
                  {t.pro && !isPro ? ' 🔒' : ''}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="Actions">
        {isInvoice && doc.status === 'draft' ? <ListRow icon="paper-plane-outline" title="Mark as sent" onPress={() => patch({ status: 'sent' })} /> : null}
        {!isInvoice && doc.status !== 'converted' ? (
          <>
            <ListRow icon="swap-horizontal-outline" title="Convert to invoice" right={!isPro ? <ProBadge /> : undefined} onPress={onConvert} />
            {doc.status !== 'accepted' ? <ListRow icon="checkmark-circle-outline" title="Mark accepted" onPress={() => patch({ status: 'accepted' })} /> : null}
            {doc.status !== 'declined' ? <ListRow icon="close-circle-outline" title="Mark declined" onPress={() => patch({ status: 'declined' })} /> : null}
          </>
        ) : null}
        {doc.convertedToId ? <ListRow icon="document-text-outline" title="Open converted invoice" onPress={() => router.push(`/document/${doc.convertedToId}`)} /> : null}
        {doc.convertedFromId ? <ListRow icon="clipboard-outline" title="Open original estimate" onPress={() => router.push(`/document/${doc.convertedFromId}`)} /> : null}
        <ListRow icon="copy-outline" title="Duplicate" right={!isPro ? <ProBadge /> : undefined} onPress={onDuplicate} />
        {isInvoice && doc.status !== 'void' ? (
          <ListRow icon="ban-outline" title="Void invoice" onPress={() => confirm('Void', 'Mark this invoice as void?', () => patch({ status: 'void' }))} />
        ) : null}
        {isInvoice && doc.status === 'void' ? <ListRow icon="refresh-outline" title="Restore invoice" onPress={() => patch({ status: 'sent' })} /> : null}
        <ListRow icon="trash-outline" title="Delete" last onPress={onDelete} />
      </Section>
    </Screen>
  );
}

function LineItemEditor({
  item,
  index,
  currency,
  onChange,
  onRemove,
  onSave,
}: {
  item: LineItem;
  index: number;
  currency: string;
  onChange: (p: Partial<LineItem>) => void;
  onRemove: () => void;
  onSave: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.lineItem, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="label">Item {index + 1}</AppText>
        <Row style={{ gap: Spacing.three }}>
          <Pressable onPress={onSave} accessibilityLabel="Save to items">
            <Ionicons name="bookmark-outline" size={18} color={theme.tint} />
          </Pressable>
          <Pressable onPress={onRemove} accessibilityLabel="Remove item">
            <Ionicons name="trash-outline" size={18} color={theme.danger} />
          </Pressable>
        </Row>
      </Row>
      <Field label="Description" value={item.description} onChangeText={(description) => onChange({ description })} placeholder="e.g. Website design" />
      <Field label="Details" value={item.details ?? ''} onChangeText={(details) => onChange({ details })} placeholder="Optional" multiline style={{ minHeight: 44 }} />
      <Row>
        <NumberField label="Qty" value={item.quantity} onChange={(quantity) => onChange({ quantity })} />
        <NumberField label="Rate" value={item.unitPrice} onChange={(unitPrice) => onChange({ unitPrice })} />
        <Field label="Unit" value={item.unit ?? ''} onChangeText={(unit) => onChange({ unit })} placeholder="hrs" />
      </Row>
      <ToggleRow label="Taxable" value={item.taxable} onValueChange={(taxable) => onChange({ taxable })} />
      <AppText variant="amount" style={{ textAlign: 'right' }}>
        {formatMoney(lineTotal(item), currency)}
      </AppText>
    </View>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  // While focused, show the raw text; otherwise mirror the stored value (which term chips may change).
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const valid = !text || isValidISODate(text);
  return (
    <Field
      label={label}
      value={text}
      placeholder="YYYY-MM-DD"
      error={valid ? undefined : 'Use YYYY-MM-DD'}
      onFocus={() => setDraft(value)}
      onChangeText={(next) => {
        setDraft(next);
        if (isValidISODate(next)) onChange(next);
      }}
      onBlur={() => setDraft(null)}
      autoCorrect={false}
    />
  );
}

function TotalLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <AppText variant={strong ? 'heading' : 'body'} color={strong ? 'text' : 'textSecondary'}>
        {label}
      </AppText>
      <AppText variant={strong ? 'heading' : 'amount'}>{value}</AppText>
    </Row>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  lineItem: { gap: Spacing.two, paddingTop: Spacing.two },
  signaturePreview: {
    width: '100%',
    aspectRatio: SIGNATURE_WIDTH / SIGNATURE_HEIGHT,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
});
