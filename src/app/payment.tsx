import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NumberField } from '@/components/number-field';
import { AppText, Button, Field, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { computeTotals, isValidISODate, todayISO } from '@/lib/calc';
import { formatMoney, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { PaymentMethod } from '@/lib/types';

const METHODS = Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][];

export default function PaymentScreen() {
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const theme = useTheme();
  const doc = useStore((s) => s.documents[docId]);
  const balance = doc ? Math.max(0, computeTotals(doc).balance) : 0;

  const [amount, setAmount] = useState(balance);
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [note, setNote] = useState('');

  if (!doc) return null;

  const valid = amount > 0 && isValidISODate(date);

  const save = () => {
    useStore.getState().addPayment(doc.id, { amount, date, method, note: note.trim() || undefined });
    router.back();
  };

  return (
    <Screen>
      <AppText variant="caption">
        Balance due on {doc.number}: {formatMoney(balance, doc.currency)}
      </AppText>
      <Section title="Payment">
        <NumberField label="Amount" value={amount} onChange={setAmount} autoFocus />
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" error={isValidISODate(date) ? undefined : 'Use YYYY-MM-DD'} />
        <AppText variant="caption">Method</AppText>
        <View style={styles.chips}>
          {METHODS.map(([value, label]) => {
            const selected = value === method;
            return (
              <Pressable
                key={value}
                onPress={() => setMethod(value)}
                style={[styles.chip, { borderColor: selected ? theme.tint : theme.border, backgroundColor: selected ? theme.tint : 'transparent' }]}>
                <AppText variant="caption" color={selected ? 'onTint' : 'text'}>
                  {label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <Field label="Note" value={note} onChangeText={setNote} placeholder="e.g. Check #1042" />
      </Section>
      <Button title="Save payment" icon="checkmark" disabled={!valid} onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
});
