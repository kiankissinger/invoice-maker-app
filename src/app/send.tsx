import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { AppText, Button, Field, Screen, Section } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { emailToClient } from '@/lib/cloud';
import { useStore } from '@/lib/store';

export default function SendScreen() {
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const doc = useStore((s) => s.documents[docId]);
  const client = useStore((s) => (doc?.clientId ? s.clients[doc.clientId] : undefined));
  const [to, setTo] = useState(doc?.lastSentTo ?? client?.email ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (!doc) return null;
  const label = doc.type === 'invoice' ? 'invoice' : 'estimate';

  const send = async () => {
    setBusy(true);
    try {
      await emailToClient(doc.id, to.trim(), message.trim() || undefined);
      if (client && !client.email) useStore.getState().upsertClient({ ...client, email: to.trim() });
      router.back();
    } catch (e) {
      Alert.alert('Could not send', e instanceof ApiError ? e.message : 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <AppText variant="caption">
        Your client gets an email with a link to view the {label}
        {doc.type === 'invoice' ? ', download it as a PDF and pay online (if Stripe is connected)' : ' and download it as a PDF'}. Replies go
        to your business email.
      </AppText>
      <Section title="Email">
        <Field label="To" value={to} onChangeText={setTo} keyboardType="email-address" autoCapitalize="none" autoFocus={!to} />
        <Field label="Message (optional)" value={message} onChangeText={setMessage} multiline placeholder="Thanks for your business!" />
      </Section>
      <Button title={`Send ${label}`} icon="paper-plane-outline" loading={busy} disabled={!/.+@.+\..+/.test(to.trim())} onPress={send} />
    </Screen>
  );
}
