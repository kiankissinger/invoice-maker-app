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
  /** 'stripe' payments are written by the server when a client pays online. */
  source?: 'manual' | 'stripe';
};

export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export type Recurrence = {
  active: boolean;
  frequency: RecurrenceFrequency;
  /** Issue date of the first occurrence; later dates are computed from it so month-ends don't drift. */
  anchorDate: string;
  /** Occurrences generated so far (the original invoice is occurrence 0). */
  count: number;
  nextIssueDate: string;
  endDate?: string;
  /** Email each new invoice to the client automatically. */
  autoSend: boolean;
};

export type ReminderSettings = {
  enabled: boolean;
  daysBefore: number; // 0 = off
  onDueDate: boolean;
  everyDaysAfter: number; // 0 = off
  maxAfter: number;
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
  /** Hosted invoice link (set once the document has been shared through the server). */
  shareUrl?: string;
  sentAt?: string; // ISO timestamp of the last email send
  lastSentTo?: string;
  viewedAt?: string; // ISO timestamp the client first opened the hosted link
  remindersEnabled?: boolean; // default true
  allowOnlinePayment?: boolean; // default true
  recurrence?: Recurrence;
  recurringParentId?: string;
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
  updatedAt?: string;
};

export type CatalogItem = {
  id: string;
  description: string;
  details?: string;
  unitPrice: number;
  unit?: string;
  taxable: boolean;
  updatedAt?: string;
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
  reminders: ReminderSettings;
  /** IANA zone, used by the server to send reminders at a sensible local time. */
  timeZone?: string;
  /** Unset until the user first edits their profile, so a fresh device never overwrites the cloud copy. */
  updatedAt?: string;
};

/** Record kinds exchanged with the sync server. */
export type SyncType = 'document' | 'client' | 'catalog' | 'profile';

export type SyncChange = {
  type: SyncType;
  id: string;
  updatedAt: string;
  deleted: boolean;
  data: unknown;
};
