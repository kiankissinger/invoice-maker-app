import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { SignaturePad } from '@/components/signature-pad';
import { AppText, Button, Row, Screen } from '@/components/ui';
import { useStore } from '@/lib/store';

export default function SignatureScreen() {
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const [path, setPath] = useState('');
  const [padKey, setPadKey] = useState(0);
  const onChange = useCallback((next: string) => setPath(next), []);

  const save = () => {
    useStore.getState().updateDocument(docId, { signature: { path, signedAt: new Date().toISOString() } });
    router.back();
  };

  return (
    <Screen scrollEnabled={false}>
      <AppText variant="caption">Sign inside the box. Hand the phone to your client to capture their approval.</AppText>
      <SignaturePad key={padKey} onChange={onChange} />
      <Row>
        <Button
          title="Clear"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => {
            setPath('');
            setPadKey((k) => k + 1);
          }}
        />
        <Button title="Save" icon="checkmark" style={{ flex: 1 }} disabled={!path} onPress={save} />
      </Row>
    </Screen>
  );
}
