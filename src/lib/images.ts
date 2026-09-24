import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';

export type CompressedImage = { dataUri: string; base64: string };

/**
 * Lets the user take or choose a photo and returns it downscaled to a small JPEG,
 * so it can live inside a synced document and a PDF. Returns null if cancelled.
 */
export async function pickImage(source: 'camera' | 'library', maxWidth = 1280): Promise<CompressedImage | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings to take photos.');
      return null;
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  if (!asset.width || asset.width > maxWidth) context.resize({ width: maxWidth });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) return null;
  return { dataUri: `data:image/jpeg;base64,${saved.base64}`, base64: saved.base64 };
}

/** Asks camera vs. library, then picks. */
export function choosePhoto(onPicked: (image: CompressedImage) => void, maxWidth?: number) {
  const run = (source: 'camera' | 'library') =>
    pickImage(source, maxWidth)
      .then((image) => image && onPicked(image))
      .catch((error) => Alert.alert('Could not add photo', (error as Error).message));
  if (Platform.OS === 'web') return void run('library');
  Alert.alert('Add photo', undefined, [
    { text: 'Take photo', onPress: () => void run('camera') },
    { text: 'Choose from library', onPress: () => void run('library') },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
