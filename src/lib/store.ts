import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { addDays, countThisMonth, formatDocNumber, todayISO } from './calc';
import type {
  BusinessProfile,
  CatalogItem,
  Client,
  DocType,
  Expense,
  InvoiceDocument,
  LineItem,
  Payment,
  SyncChange,
  SyncType,
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
  reminders: { enabled: true, daysBefore: 3, onDueDate: true, everyDaysAfter: 7, maxAfter: 3 },
  lateFee: { enabled: false, kind: 'percent', value: 1.5, graceDays: 7 },
};

const nowISO = () => new Date().toISOString();
const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};
const key = (type: SyncType, id: string) => `${type}:${id}`;

export function emptyLineItem(): LineItem {
  return { id: newId(), description: '', quantity: 1, unitPrice: 0, taxable: true };
}

type State = {
  hydrated: boolean;
  profile: BusinessProfile;
  documents: Record<string, InvoiceDocument>;
  clients: Record<string, Client>;
  catalog: Record<string, CatalogItem>;
  expenses: Record<string, Expense>;
  /** Documents created this calendar month; drives the free-tier limit so deleting documents doesn't reset it. */
  createdThisMonth: { month: string; count: number };
  /** "type:id" -> deletion time, so deletes can be synced. */
  tombstones: Record<string, string>;
  syncMeta: { cursor: number; pushedUpTo: string | null };
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
  upsertExpense: (expense: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Expense;
  deleteExpense: (id: string) => void;
  resetAll: () => void;
  /** Local changes made after `since` (everything when null), for pushing to the server. */
  collectChanges: (since: string | null) => SyncChange[];
  /** Merges server changes, keeping any local copy that is newer. */
  applyRemote: (changes: SyncChange[]) => void;
  setSyncMeta: (meta: Partial<State['syncMeta']>) => void;
};

const initialData = {
  profile: DEFAULT_PROFILE,
  documents: {},
  clients: {},
  catalog: {},
  expenses: {},
  createdThisMonth: { month: '', count: 0 },
  tombstones: {},
  syncMeta: { cursor: 0, pushedUpTo: null },
};

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => {
      /** Allocates the next number for a type and bumps the counter. */
      const takeNumber = (type: DocType): string => {
        const { profile } = get();
        if (type === 'invoice') {
          set({ profile: { ...profile, nextInvoiceNumber: profile.nextInvoiceNumber + 1, updatedAt: nowISO() } });
          return formatDocNumber(profile.invoicePrefix, profile.nextInvoiceNumber);
        }
        set({ profile: { ...profile, nextEstimateNumber: profile.nextEstimateNumber + 1, updatedAt: nowISO() } });
        return formatDocNumber(profile.estimatePrefix, profile.nextEstimateNumber);
      };

      const insert = (doc: InvoiceDocument) =>
        set((s) => ({
          documents: { ...s.documents, [doc.id]: doc },
          createdThisMonth: {
            month: todayISO().slice(0, 7),
            count: countThisMonth(s.createdThisMonth, todayISO()) + 1,
          },
        }));

      return {
        hydrated: false,
        ...initialData,

        updateProfile: (patch) =>
          set((s) => ({ profile: { ...s.profile, ...patch, timeZone: deviceTimeZone(), updatedAt: nowISO() } })),

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
            return { documents: rest, tombstones: { ...s.tombstones, [key('document', id)]: nowISO() } };
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
            items: source.items.filter((item) => item.id !== 'late-fee').map((item) => ({ ...item, id: newId() })),
            payments: [],
            signature: undefined,
            convertedFromId: undefined,
            convertedToId: undefined,
            shareUrl: undefined,
            sentAt: undefined,
            lastSentTo: undefined,
            viewedAt: undefined,
            recurrence: undefined,
            recurringParentId: undefined,
            approval: undefined,
            lateFeeAppliedAt: undefined,
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
            withholdingRate: estimate.withholdingRate,
            withholdingLabel: estimate.withholdingLabel,
            photos: estimate.photos,
            // Deposits paid against the estimate count towards the invoice.
            payments: estimate.payments,
            signature: estimate.signature,
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
            createdAt: existing?.createdAt ?? nowISO(),
            updatedAt: nowISO(),
          };
          set((s) => ({ clients: { ...s.clients, [client.id]: client } }));
          return client;
        },

        deleteClient: (id) =>
          set((s) => {
            const { [id]: _removed, ...rest } = s.clients;
            return { clients: rest, tombstones: { ...s.tombstones, [key('client', id)]: nowISO() } };
          }),

        upsertCatalogItem: (input) => {
          const item: CatalogItem = { ...input, id: input.id ?? newId(), updatedAt: nowISO() };
          set((s) => ({ catalog: { ...s.catalog, [item.id]: item } }));
          return item;
        },

        deleteCatalogItem: (id) =>
          set((s) => {
            const { [id]: _removed, ...rest } = s.catalog;
            return { catalog: rest, tombstones: { ...s.tombstones, [key('catalog', id)]: nowISO() } };
          }),

        upsertExpense: (input) => {
          const existing = input.id ? get().expenses[input.id] : undefined;
          const expense: Expense = {
            ...input,
            id: existing?.id ?? newId(),
            createdAt: existing?.createdAt ?? nowISO(),
            updatedAt: nowISO(),
          };
          set((s) => ({ expenses: { ...s.expenses, [expense.id]: expense } }));
          return expense;
        },

        deleteExpense: (id) =>
          set((s) => {
            const { [id]: _removed, ...rest } = s.expenses;
            return { expenses: rest, tombstones: { ...s.tombstones, [key('expense', id)]: nowISO() } };
          }),

        resetAll: () => set({ ...initialData }),

        collectChanges: (since) => {
          const { documents, clients, catalog, expenses, profile, tombstones } = get();
          const newer = (updatedAt?: string) => !!updatedAt && (!since || updatedAt > since);
          const changes: SyncChange[] = [];
          const add = (type: SyncType, items: Record<string, { id: string; updatedAt?: string }>) => {
            for (const item of Object.values(items)) {
              if (newer(item.updatedAt)) changes.push({ type, id: item.id, updatedAt: item.updatedAt!, deleted: false, data: item });
            }
          };
          add('document', documents);
          add('client', clients);
          add('catalog', catalog);
          add('expense', expenses);
          if (newer(profile.updatedAt)) {
            changes.push({ type: 'profile', id: 'profile', updatedAt: profile.updatedAt!, deleted: false, data: { ...profile, id: 'profile' } });
          }
          for (const [k, deletedAt] of Object.entries(tombstones)) {
            if (!newer(deletedAt)) continue;
            const [type, ...rest] = k.split(':');
            changes.push({ type: type as SyncType, id: rest.join(':'), updatedAt: deletedAt, deleted: true, data: null });
          }
          return changes;
        },

        applyRemote: (changes) =>
          set((s) => {
            const documents = { ...s.documents };
            const clients = { ...s.clients };
            const catalog = { ...s.catalog };
            const expenses = { ...s.expenses };
            const tombstones = { ...s.tombstones };
            let profile = s.profile;
            const tables: Record<Exclude<SyncType, 'profile'>, Record<string, { updatedAt?: string }>> = {
              document: documents,
              client: clients,
              catalog,
              expense: expenses,
            };

            for (const change of changes) {
              const k = key(change.type, change.id);
              const local = change.type === 'profile' ? profile : tables[change.type][change.id];
              // A newer local edit or delete wins; it will be pushed on the next sync.
              if (local?.updatedAt && local.updatedAt > change.updatedAt) continue;
              if (tombstones[k] && tombstones[k] > change.updatedAt) continue;

              if (change.type === 'profile') {
                if (!change.deleted) {
                  const { id: _id, ...data } = change.data as BusinessProfile & { id?: string };
                  profile = { ...DEFAULT_PROFILE, ...data };
                }
              } else if (change.deleted) {
                delete tables[change.type][change.id];
              } else {
                tables[change.type][change.id] = change.data as { updatedAt?: string };
              }
              delete tombstones[k];
            }
            return { documents, clients, catalog, expenses, profile, tombstones };
          }),

        setSyncMeta: (meta) => set((s) => ({ syncMeta: { ...s.syncMeta, ...meta } })),
      };
    },
    {
      name: 'invoice-maker-store',
      version: 4,
      storage: createJSONStorage(() => AsyncStorage),
      migrate: (persisted, version) => {
        const state = persisted as State;
        if (version < 2) {
          // v2 adds sync: stamp existing clients/items so they get uploaded on first sync.
          const stamp = <T extends { updatedAt?: string }>(items: Record<string, T> = {}) =>
            Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { ...item, updatedAt: item.updatedAt ?? nowISO() }]));
          state.clients = stamp(state.clients);
          state.catalog = stamp(state.catalog);
          state.tombstones = {};
          state.syncMeta = { cursor: 0, pushedUpTo: null };
          if (state.profile && (state.profile.name || state.profile.email)) state.profile.updatedAt = nowISO();
        }
        if (version < 3) state.expenses = state.expenses ?? {};
        if (version < 4) {
          // v4 switches the free tier from 3 documents ever to 3 per month; start everyone fresh.
          delete (state as { documentsCreated?: number }).documentsCreated;
          state.createdThisMonth = { month: '', count: 0 };
        }
        return state;
      },
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
