import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { APP_NAME } from '@/constants/theme';

import { renderDocumentHtml, type RenderInput } from './invoice-html';

export { SIGNATURE_HEIGHT, SIGNATURE_WIDTH, TEMPLATES } from './invoice-html';

type ExportInput = Omit<RenderInput, 'appName'>;

export async function previewDocument(input: ExportInput): Promise<void> {
  await Print.printAsync({ html: renderDocumentHtml({ ...input, appName: APP_NAME }) });
}

export async function shareDocumentPdf(input: ExportInput): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: renderDocumentHtml({ ...input, appName: APP_NAME }) });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: `${input.doc.type === 'invoice' ? 'Invoice' : 'Estimate'} ${input.doc.number}`,
  });
}
