import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { NumberField } from '@/components/number-field';
import { AppText, Button, Section, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { depositStatus } from '@/lib/calc';
import { formatMoney } from '@/lib/format';
import { choosePhoto } from '@/lib/images';
import { newId, useStore } from '@/lib/store';
import type { InvoiceDocument } from '@/lib/types';

const MAX_PHOTOS = 12;

export function PhotosSection({ doc }: { doc: InvoiceDocument }) {
  const theme = useTheme();
  const update = useStore((s) => s.updateDocument);
  const photos = doc.photos ?? [];

  const add = () =>
    choosePhoto((image) => {
      const current = useStore.getState().documents[doc.id]?.photos ?? [];
      update(doc.id, { photos: [...current, { id: newId(), uri: image.dataUri }] });
    });

  return (
    <Section title="Photos">
      {photos.length === 0 ? (
        <AppText variant="caption">Add before/after shots or site photos. They appear on the PDF and the client’s link.</AppText>
      ) : (
        <View style={styles.grid}>
          {photos.map((photo) => (
            <View key={photo.id} style={styles.tile}>
              <Image source={{ uri: photo.uri }} style={styles.image} contentFit="cover" />
              <Pressable
                accessibilityLabel="Remove photo"
                onPress={() => update(doc.id, { photos: photos.filter((p) => p.id !== photo.id) })}
                style={[styles.remove, { backgroundColor: theme.background }]}>
                <Ionicons name="close" size={16} color={theme.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {photos.length < MAX_PHOTOS ? <Button title="Add photo" icon="camera-outline" variant="secondary" onPress={add} /> : null}
    </Section>
  );
}

export function DepositSection({ doc }: { doc: InvoiceDocument }) {
  const update = useStore((s) => s.updateDocument);
  const kind = doc.deposit ? doc.deposit.kind : 'none';
  const { amount, outstanding } = depositStatus(doc);

  return (
    <Section title="Deposit">
      <Segmented
        options={[
          { value: 'none', label: 'None' },
          { value: 'percent', label: 'Percent' },
          { value: 'amount', label: 'Amount' },
        ]}
        value={kind}
        onChange={(next) =>
          update(doc.id, { deposit: next === 'none' ? undefined : { kind: next, value: doc.deposit?.value ?? (next === 'percent' ? 25 : 0) } })
        }
      />
      {doc.deposit ? (
        <>
          <NumberField
            key={doc.deposit.kind}
            label={doc.deposit.kind === 'percent' ? 'Deposit %' : 'Deposit amount'}
            value={doc.deposit.value}
            onChange={(value) => update(doc.id, { deposit: { ...doc.deposit!, value } })}
          />
          <AppText variant="caption">
            {outstanding > 0
              ? `Deposit due: ${formatMoney(outstanding, doc.currency)}. Clients can pay it online from the link.`
              : `Deposit of ${formatMoney(amount, doc.currency)} is paid.`}
          </AppText>
        </>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { width: '31%', aspectRatio: 1 },
  image: { width: '100%', height: '100%', borderRadius: 8 },
  remove: { position: 'absolute', top: 4, right: 4, borderRadius: 12, padding: 2 },
});
