import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { NumberField } from '@/components/number-field';
import { AppText, Button, Field, ProBadge, Row, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useProGate } from '@/hooks/use-pro-gate';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { isValidISODate, todayISO } from '@/lib/calc';
import { pickImage, type CompressedImage } from '@/lib/images';
import { useStore } from '@/lib/store';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/types';

export default function ExpenseScreen() {
  const { id, scan } = useLocalSearchParams<{ id: string; scan?: string }>();
  const theme = useTheme();
  const isNew = id === 'new';
  const existing = useStore((s) => (isNew ? undefined : s.expenses[id]));
  const currency = useStore((s) => s.profile.currency);
  const { isPro, requireCloud } = useProGate();

  const [vendor, setVendor] = useState(existing?.vendor ?? '');
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [amount, setAmount] = useState(existing?.amount ?? 0);
  const [tax, setTax] = useState(existing?.tax ?? 0);
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'Materials');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [receipt, setReceipt] = useState(existing?.receiptUri);
  const [scanning, setScanning] = useState(false);
  // Remount number fields after AI fills them so they show the new values.
  const [formKey, setFormKey] = useState(0);

  const scanImage = async (image: CompressedImage) => {
    setReceipt(image.dataUri);
    if (!isPro) return;
    setScanning(true);
    try {
      const data = await api.scanReceipt(image.base64);
      if (data.vendor) setVendor(data.vendor);
      if (data.date && isValidISODate(data.date)) setDate(data.date);
      if (data.total != null) setAmount(data.total);
      if (data.tax != null) setTax(data.tax);
      setCategory(data.category);
      setFormKey((k) => k + 1);
    } catch (e) {
      Alert.alert('Could not read the receipt', e instanceof ApiError ? e.message : 'Fill in the details by hand.');
    } finally {
      setScanning(false);
    }
  };

  const capture = async (source: 'camera' | 'library', withAi: boolean) => {
    if (withAi && !requireCloud('ai')) return;
    try {
      const image = await pickImage(source, 1600);
      if (!image) return;
      if (withAi) await scanImage(image);
      else setReceipt(image.dataUri);
    } catch (e) {
      Alert.alert('Could not add photo', (e as Error).message);
    }
  };

  // "Scan receipt" from the Money tab opens straight into the camera.
  const autoScanned = useRef(false);
  useEffect(() => {
    if (scan === '1' && !autoScanned.current) {
      autoScanned.current = true;
      void capture(Platform.OS === 'web' ? 'library' : 'camera', true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  const save = () => {
    if (!vendor.trim() || amount <= 0 || !isValidISODate(date)) {
      Alert.alert('Missing details', 'Add a vendor, an amount and a valid date.');
      return;
    }
    useStore.getState().upsertExpense({
      id: existing?.id,
      vendor: vendor.trim(),
      date,
      amount,
      tax: tax || undefined,
      currency: existing?.currency ?? currency,
      category,
      notes: notes.trim() || undefined,
      receiptUri: receipt,
    });
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New expense' : vendor || 'Expense' }} />

      <Section title="Receipt" action={!isPro ? <ProBadge /> : undefined}>
        {receipt ? (
          <View style={[styles.receipt, { borderColor: theme.border }]}>
            <Image source={{ uri: receipt }} style={StyleSheet.absoluteFill} contentFit="contain" />
          </View>
        ) : null}
        <Button
          title={scanning ? 'Reading receipt…' : 'Scan receipt with AI'}
          icon="scan-outline"
          loading={scanning}
          onPress={() => capture(Platform.OS === 'web' ? 'library' : 'camera', true)}
        />
        <Row>
          <Button title="Attach photo" icon="image-outline" variant="secondary" style={{ flex: 1 }} onPress={() => capture('library', false)} />
          {receipt ? <Button title="Remove" variant="ghost" onPress={() => setReceipt(undefined)} /> : null}
        </Row>
      </Section>

      <Section title="Details">
        <Field label="Vendor" value={vendor} onChangeText={setVendor} placeholder="e.g. Home Depot" />
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" error={isValidISODate(date) ? undefined : 'Use YYYY-MM-DD'} />
        <Row key={formKey}>
          <NumberField label="Total" value={amount} onChange={setAmount} />
          <NumberField label="Tax (optional)" value={tax} onChange={setTax} />
        </Row>
        <AppText variant="caption">Category</AppText>
        <View style={styles.chips}>
          {EXPENSE_CATEGORIES.map((c) => {
            const selected = c === category;
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.chip, { borderColor: selected ? theme.tint : theme.border, backgroundColor: selected ? theme.tint : 'transparent' }]}>
                <AppText variant="caption" color={selected ? 'onTint' : 'text'}>
                  {c}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Job, client, what it was for" />
      </Section>

      <Button title="Save expense" icon="checkmark" onPress={save} />
      {!isNew ? (
        <Button
          title="Delete expense"
          variant="ghost"
          onPress={() => {
            router.back();
            useStore.getState().deleteExpense(id);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  receipt: { width: '100%', aspectRatio: 3 / 4, borderWidth: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
});
