import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { addDays, formatDocNumber, todayISO } from './calc';
import type {
  BusinessProfile,
  CatalogItem,
  Client,
  DocType,
  InvoiceDocument,
  LineItem,
  Payment,
} from './types';

export const newId = () => randomUUID();

export const DEFAULT_PROFILE: BusinessProfile = {
  name: '',
  ownerName: '',
  email: '',
  phone: '',
  address: '',
  website: '',
  taxId: '',
  accentColor: '#2563EB',
  currency: 'USD',
  defaultTaxRate: 0,
  taxLabel: 'Tax',
  defaultPaymentTermsDays: 14,
  defaultNotes: 'Thank you for your business!',
  defaultTerms: '',
  paymentInstructions: '',
  invoicePrefix: 'INV',
  estimatePrefix: 'EST',
  nextInvoiceNumber: 1,
  nextEstimateNumber: 1,
  templateId: 'classic',
};

export function emptyLineItem(): LineItem {
  return { id: newId(), description: '', quantity: 1, unitPrice: 0, taxable: true };
}

type State = {
  hydrated: boolean;
  profile: BusinessProfile;
  documents: Record<string, InvoiceDocument>;
  clients: Record<string, Client>;
  catalog: Record<string, CatalogItem>;
  /** Lifetime count; drives the free-tier limit so deleting documents doesn't reset it. */
  documentsCreated: number;
};

type Actions = {
  updateProfile: (patch: Partial<BusinessProfile>) => void;
  createDocument: (type: DocType, init?: Partial<InvoiceDocument>) => InvoiceDocument;
  updateDocument: (id: string, patch: Partial<InvoiceDocument>) => void;
  deleteDocument: (id: string) => void;
  duplicateDocument: (id: string) => InvoiceDocument | undefined;
  convertEstimateToInvoice: (id: string) => InvoiceDocument | undefined;
  addPayment: (docId: string, payment: Omit<Payment, 'id'>) => void;
  removePayment: (docId: string, paymentId: string) => void;
  upsertClient: (client: Omit<Client, 'id' | 'createdAt'> & { id?: string }) => Client;
  deleteClient: (id: string) => void;
  upsertCatalogItem: (item: Omit<CatalogItem, 'id'> & { id?: string }) => CatalogItem;
  deleteCatalogItem: (id: string) => void;
  resetAll: () => void;
};

const initialData = {
  profile: DEFAULT_PROFILE,
  documents: {},
  clients: {},
  catalog: {},
  documentsCreated: 0,
};

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => {
      /** Allocates the next number for a type and bumps the counter. */
      const takeNumber = (type: DocType): string => {
        const { profile } = get();
        if (type === 'invoice') {
          set({ profile: { ...profile, nextInvoiceNumber: profile.nextInvoiceNumber + 1 } });
          return formatDocNumber(profile.invoicePrefix, profile.nextInvoiceNumber);
        }
        set({ profile: { ...profile, nextEstimateNumber: profile.nextEstimateNumber + 1 } });
        return formatDocNumber(profile.estimatePrefix, profile.nextEstimateNumber);
      };

      const insert = (doc: InvoiceDocument) =>
        set((s) => ({
          documents: { ...s.documents, [doc.id]: doc },
          documentsCreated: s.documentsCreated + 1,
        }));

      return {
        hydrated: false,
        ...initialData,

        updateProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),

        createDocument: (type, init) => {
          const { profile } = get();
          const now = new Date().toISOString();
          const issueDate = todayISO();
          const doc: InvoiceDocument = {
            id: newId(),
            type,
            number: takeNumber(type),
            status: 'draft',
            issueDate,
            dueDate: addDays(issueDate, type === 'invoice' ? profile.defaultPaymentTermsDays : 30),
            items: [emptyLineItem()],
            discount: { kind: 'percent', value: 0 },
            taxRate: profile.defaultTaxRate,
            taxLabel: profile.taxLabel,
            shipping: 0,
            notes: profile.defaultNotes,
            terms: profile.defaultTerms,
            payments: [],
            currency: profile.currency,
            templateId: profile.templateId,
            createdAt: now,
            updatedAt: now,
            ...init,
          };
          insert(doc);
          return doc;
        },

        updateDocument: (id, patch) =>
          set((s) => {
            const existing = s.documents[id];
            if (!existing) return s;
            return {
              documents: {
                ...s.documents,
                [id]: { ...existing, ...patch, updatedAt: new Date().toISOString() },
              },
            };
          }),

        deleteDocument: (id) =>
          set((s) => {
            const { [id]: _removed, ...rest } = s.documents;
            return { documents: rest };
          }),

        duplicateDocument: (id) => {
          const source = get().documents[id];
          if (!source) return undefined;
          const issueDate = todayISO();
          const now = new Date().toISOString();
          const copy: InvoiceDocument = {
            ...source,
            id: newId(),
            number: takeNumber(source.type),
            status: 'draft',
            issueDate,
            dueDate: addDays(issueDate, get().profile.defaultPaymentTermsDays),
            items: source.items.map((item) => ({ ...item, id: newId() })),
            payments: [],
            signature: undefined,
            convertedFromId: undefined,
            convertedToId: undefined,
            createdAt: now,
            updatedAt: now,
          };
          insert(copy);
          return copy;
        },

        convertEstimateToInvoice: (id) => {
          const estimate = get().documents[id];
          if (!estimate || estimate.type !== 'estimate') return undefined;
          if (estimate.convertedToId && get().documents[estimate.convertedToId]) {
            return get().documents[estimate.convertedToId];
          }
          const invoice = get().createDocument('invoice', {
            clientId: estimate.clientId,
            poNumber: estimate.poNumber,
            items: estimate.items.map((item) => ({ ...item, id: newId() })),
            discount: estimate.discount,
            taxRate: estimate.taxRate,
            taxLabel: estimate.taxLabel,
            shipping: estimate.shipping,
            notes: estimate.notes,
            terms: estimate.terms,
            currency: estimate.currency,
            templateId: estimate.templateId,
            convertedFromId: estimate.id,
          });
          get().updateDocument(estimate.id, { status: 'converted', convertedToId: invoice.id });
          return invoice;
        },

        addPayment: (docId, payment) => {
          const doc = get().documents[docId];
          if (!doc) return;
          get().updateDocument(docId, {
            payments: [...doc.payments, { ...payment, id: newId() }],
            status: doc.status === 'draft' ? 'sent' : doc.status,
          });
        },

        removePayment: (docId, paymentId) => {
          const doc = get().documents[docId];
          if (!doc) return;
          get().updateDocument(docId, { payments: doc.payments.filter((p) => p.id !== paymentId) });
        },

        upsertClient: (input) => {
          const existing = input.id ? get().clients[input.id] : undefined;
          const client: Client = {
            ...existing,
            ...input,
            id: existing?.id ?? newId(),
            createdAt: existing?.createdAt ?? new Date().toISOString(),
          };
          set((s) => ({ clients: { ...s.clients, [client.id]: client } }));
          return client;
        },

        deleteClient: (id) =>
          set((s) => {
            const { [id]: _removed, ...rest } = s.clients;
            return { clients: rest };
          }),

        upsertCatalogItem: (input) => {
          const item: CatalogItem = { ...input, id: input.id ?? newId() };
          set((s) => ({ catalog: { ...s.catalog, [item.id]: item } }));
          return item;
        },

        deleteCatalogItem: (id) =>
          set((s) => {
            const { [id]: _removed, ...rest } = s.catalog;
            return { catalog: rest };
          }),

        resetAll: () => set({ ...initialData }),
      };
    },
    {
      name: 'invoice-maker-store',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<State>;
        // Merge the profile so newly added settings get defaults on upgrade.
        return { ...current, ...saved, profile: { ...DEFAULT_PROFILE, ...saved.profile } };
      },
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    }
  )
);
