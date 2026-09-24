import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Button, Field, Row, Screen, Section } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/lib/store';

export default function BusinessProfileScreen() {
  const theme = useTheme();
  const profile = useStore((s) => s.profile);
  const update = useStore((s) => s.updateProfile);

  const pickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.6,
      base64: true,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset?.base64) {
      update({ logoDataUri: `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}` });
    }
  };

  return (
    <Screen>
      <Section title="Logo">
        {profile.logoDataUri ? (
          <View style={[styles.logoBox, { borderColor: theme.border }]}>
            <Image source={{ uri: profile.logoDataUri }} style={styles.logo} contentFit="contain" />
          </View>
        ) : null}
        <Row>
          <Button title={profile.logoDataUri ? 'Change logo' : 'Add logo'} icon="image-outline" variant="secondary" style={{ flex: 1 }} onPress={pickLogo} />
          {profile.logoDataUri ? <Button title="Remove" variant="ghost" onPress={() => update({ logoDataUri: undefined })} /> : null}
        </Row>
      </Section>

      <Section title="Business">
        <Field label="Business name" value={profile.name} onChangeText={(name) => update({ name })} />
        <Field label="Your name" value={profile.ownerName} onChangeText={(ownerName) => update({ ownerName })} />
        <Field label="Email" value={profile.email} onChangeText={(email) => update({ email })} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Phone" value={profile.phone} onChangeText={(phone) => update({ phone })} keyboardType="phone-pad" />
        <Field label="Address" value={profile.address} onChangeText={(address) => update({ address })} multiline />
        <Field label="Website" value={profile.website} onChangeText={(website) => update({ website })} autoCapitalize="none" />
        <Field label="Tax / VAT / ABN number" value={profile.taxId} onChangeText={(taxId) => update({ taxId })} />
      </Section>

      <Section title="Getting paid">
        <Field
          label="Payment instructions"
          value={profile.paymentInstructions}
          onChangeText={(paymentInstructions) => update({ paymentInstructions })}
          multiline
          placeholder={'e.g. Bank: 123-456 / Acct 7890\nZelle: you@example.com'}
          hint="Printed on every invoice."
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoBox: { borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center', backgroundColor: '#fff' },
  logo: { width: 180, height: 72 },
});
