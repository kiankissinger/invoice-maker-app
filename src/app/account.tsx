import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';

import { AppText, Button, Card, Field, ListRow, Screen, Section } from '@/components/ui';
import { useProGate } from '@/hooks/use-pro-gate';
import { deleteAccount, signIn, signOut, useAccount } from '@/lib/account';
import { api, ApiError, apiConfigured } from '@/lib/api';
import { syncNow, useSyncStatus } from '@/lib/sync';

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

export default function AccountScreen() {
  const user = useAccount((s) => s.user);
  return user ? <SignedIn email={user.email} /> : <SignInForm />;
}

function SignInForm() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!apiConfigured()) {
    return (
      <Screen>
        <AppText variant="caption">Cloud features need a server. Set EXPO_PUBLIC_API_URL and restart the app.</AppText>
      </Screen>
    );
  }

  const sendCode = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.startLogin(email.trim());
      setStep('code');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await signIn(email.trim(), code.trim());
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <AppText variant="heading">Sign in to sync and get paid</AppText>
      <AppText variant="caption">
        Back up your invoices, use them on all your devices, email invoices, accept card payments and send automatic reminders. No password
        needed.
      </AppText>
      <Section title={step === 'email' ? 'Your email' : 'Enter the code'}>
        {step === 'email' ? (
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoFocus
            error={error}
            onSubmitEditing={sendCode}
          />
        ) : (
          <>
            <AppText variant="caption">We sent a 6-digit code to {email.trim()}.</AppText>
            <Field
              label="Code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
              error={error}
              onSubmitEditing={verify}
            />
          </>
        )}
      </Section>
      {step === 'email' ? (
        <Button title="Email me a code" icon="mail-outline" loading={busy} disabled={!/.+@.+\..+/.test(email)} onPress={sendCode} />
      ) : (
        <>
          <Button title="Sign in" icon="log-in-outline" loading={busy} disabled={code.trim().length !== 6} onPress={verify} />
          <Button title="Use a different email" variant="ghost" onPress={() => setStep('email')} />
        </>
      )}
    </Screen>
  );
}

function SignedIn({ email }: { email: string }) {
  const { isPro } = useProGate();
  const { syncing, lastSyncedAt, error } = useSyncStatus();

  const confirmDelete = () => {
    const run = async () => {
      try {
        await deleteAccount();
        router.back();
      } catch (e) {
        Alert.alert('Could not delete account', errorMessage(e));
      }
    };
    const message = 'This permanently deletes your cloud data and signs you out. Documents stay on this device.';
    if (Platform.OS === 'web') {
      if (window.confirm(message)) void run();
      return;
    }
    Alert.alert('Delete account?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const status = !isPro
    ? 'Sync is included with Pro.'
    : syncing
      ? 'Syncing…'
      : error
        ? error
        : lastSyncedAt
          ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}`
          : 'Not synced yet';

  return (
    <Screen>
      <Card>
        <ListRow icon="person-circle-outline" title={email} subtitle="Signed in" last />
      </Card>
      <Section title="Cloud sync">
        <AppText variant="caption" color={error ? 'danger' : 'textSecondary'}>
          {status}
        </AppText>
        {isPro ? (
          <Button title="Sync now" icon="sync-outline" variant="secondary" loading={syncing} onPress={() => void syncNow()} />
        ) : (
          <Button title="Upgrade to Pro" icon="sparkles" onPress={() => router.push({ pathname: '/paywall', params: { feature: 'cloud' } })} />
        )}
      </Section>
      <Button
        title="Sign out"
        variant="secondary"
        onPress={async () => {
          await signOut();
          router.back();
        }}
      />
      <Button title="Delete account" variant="ghost" onPress={confirmDelete} />
    </Screen>
  );
}
