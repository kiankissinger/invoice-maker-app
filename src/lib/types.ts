export type DocType = 'invoice' | 'estimate';

/** Stored status. "paid", "partial" and "overdue" are derived — see `displayStatus`. */
export type InvoiceStatus = 'draft' | 'sent' | 'void';
export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'converted';

export type DisplayStatus =
  | 'draft'
  | 'sent'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'void'
  | 'accepted'
  | 'declined'
  | 'converted';

export type TemplateId = 'classic' | 'modern' | 'minimal' | 'bold';

export type Discount = { kind: 'percent' | 'amount'; value: number };

export type LineItem = {
  id: string;
  description: string;
  details?: string;
  quantity: number;
  unitPrice: number;
  unit?: string;
  taxable: boolean;
};

export type PaymentMethod = 'cash' | 'check' | 'card' | 'bank' | 'paypal' | 'venmo' | 'zelle' | 'other';

export type Payment = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  method: PaymentMethod;
  note?: string;
};

export type Signature = {
  /** SVG path data, drawn in a SIGNATURE_WIDTH x SIGNATURE_HEIGHT box. */
  path: string;
  signedAt: string; // ISO timestamp
};

export type InvoiceDocument = {
  id: string;
  type: DocType;
  number: string;
  status: InvoiceStatus | EstimateStatus;
  clientId?: string;
  issueDate: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD; invoices: payment due, estimates: valid until
  poNumber?: string;
  items: LineItem[];
  discount: Discount;
  taxRate: number; // percent
  taxLabel: string;
  shipping: number;
  notes: string;
  terms: string;
  payments: Payment[];
  signature?: Signature;
  currency: string; // ISO 4217
  templateId: TemplateId;
  convertedFromId?: string;
  convertedToId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Client = {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt: string;
};

export type CatalogItem = {
  id: string;
  description: string;
  details?: string;
  unitPrice: number;
  unit?: string;
  taxable: boolean;
};

export type BusinessProfile = {
  name: string;
  ownerName: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  taxId: string;
  logoDataUri?: string;
  accentColor: string;
  currency: string;
  defaultTaxRate: number;
  taxLabel: string;
  defaultPaymentTermsDays: number;
  defaultNotes: string;
  defaultTerms: string;
  paymentInstructions: string;
  invoicePrefix: string;
  estimatePrefix: string;
  nextInvoiceNumber: number;
  nextEstimateNumber: number;
  templateId: TemplateId;
};
