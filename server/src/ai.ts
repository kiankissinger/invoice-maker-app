import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { EXPENSE_CATEGORIES } from '../../src/lib/types';
import { HttpError } from './context';

const MODEL = 'claude-opus-5';

export const receiptSchema = z.object({
  vendor: z.string().nullable(),
  date: z.string().nullable().describe('Purchase date as YYYY-MM-DD'),
  total: z.number().nullable().describe('Grand total paid, including tax'),
  tax: z.number().nullable().describe('Sales tax / VAT amount, if shown'),
  currency: z.string().nullable().describe('ISO 4217 code, e.g. USD'),
  category: z.enum(EXPENSE_CATEGORIES),
});
export type ReceiptData = z.infer<typeof receiptSchema>;

export const draftSchema = z.object({
  items: z.array(
    z.object({
      description: z.string(),
      details: z.string().nullable(),
      quantity: z.number(),
      unitPrice: z.number(),
      unit: z.string().nullable(),
      taxable: z.boolean(),
    })
  ),
  notes: z.string().nullable().describe('Optional short note for the client, or null'),
});
export type DraftData = z.infer<typeof draftSchema>;

export type DraftContext = {
  description: string;
  currency: string;
  businessName?: string;
  /** The user's saved items, so drafts reuse their real prices and wording. */
  catalog: { description: string; unitPrice: number; unit?: string }[];
};

export interface AiService {
  scanReceipt(image: { data: string; mediaType: 'image/jpeg' | 'image/png' }): Promise<ReceiptData>;
  draftItems(context: DraftContext): Promise<DraftData>;
}

export function createAiService(apiKey: string | undefined): AiService | null {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });

  const run = async <T extends z.ZodType>(schema: T, content: Anthropic.Beta.BetaContentBlockParam[], system: string): Promise<z.infer<T>> => {
    let response;
    try {
      response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Short, well-specified extraction: low effort keeps it fast for someone waiting in the app.
        output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: 'user', content }],
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new HttpError(429, 'ai_busy', 'The assistant is busy. Try again in a moment.');
      if (error instanceof Anthropic.APIError) {
        console.error('Claude API error', error.status, error.message);
        throw new HttpError(502, 'ai_failed', 'The assistant is unavailable right now.');
      }
      throw error;
    }
    if (response.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused', 'The assistant could not help with that request.');
    if (!response.parsed_output) throw new HttpError(502, 'ai_failed', 'The assistant returned an unexpected answer.');
    return response.parsed_output as z.infer<T>;
  };

  return {
    scanReceipt: ({ data, mediaType }) =>
      run(
        receiptSchema,
        [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: 'Extract the expense details from this receipt.' },
        ],
        'You read receipts for a small-business bookkeeping app. Report what the receipt shows; use null for anything that is not visible. ' +
          'Pick the closest category for the purchase.'
      ),
    draftItems: ({ description, currency, businessName, catalog }) =>
      run(
        draftSchema,
        [
          {
            type: 'text',
            text: [
              businessName ? `Business: ${businessName}` : '',
              `Currency: ${currency}`,
              catalog.length
                ? `Saved items (reuse these names and prices when they fit):\n${catalog
                    .map((c) => `- ${c.description}: ${c.unitPrice}${c.unit ? ` per ${c.unit}` : ''}`)
                    .join('\n')}`
                : '',
              `Job description from the business owner:\n"""\n${description}\n"""`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        'You turn a tradesperson or freelancer\'s quick job description into clear invoice line items. ' +
          'Use prices and quantities the owner states; when a price is not given, use the matching saved item price, otherwise 0 so the owner fills it in. ' +
          'Never invent extra work. Keep descriptions short and professional; put specifics in details. Labor and services are usually not taxable; parts and materials usually are.'
      ),
  };
}
