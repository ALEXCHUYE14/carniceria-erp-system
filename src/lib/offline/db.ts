// =====================================================================
// IndexedDB (Dexie) — caché local del catálogo y cola de mutaciones offline
// =====================================================================
import Dexie, { type Table } from 'dexie';
import type {
  BusinessSettings, Category, Customer, CutType, InventoryLot, OutboxEntry, Product,
} from '@/types';

export interface KV {
  key: string;
  value: unknown;
}

export class CarniDB extends Dexie {
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  cutTypes!: Table<CutType, string>;
  customers!: Table<Customer, string>;
  lots!: Table<InventoryLot, string>;
  outbox!: Table<OutboxEntry, string>;
  kv!: Table<KV, string>;

  constructor() {
    super('carniceria-erp');
    this.version(1).stores({
      products: 'id, category_id, barcode, sku, name, active',
      categories: 'id, sort_order',
      cutTypes: 'id, sort_order',
      customers: 'id, full_name, doc_number',
      lots: 'id, lot_number, product_id, status',
      outbox: 'id, kind, status, created_at',
      kv: 'key',
    });
  }
}

export const db = new CarniDB();

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export async function cacheSettings(s: BusinessSettings) {
  await setKV('business_settings', s);
}

/** Reemplaza el contenido de una tabla local con datos frescos del servidor. */
export async function replaceTable<T>(table: Table<T, string>, rows: T[]) {
  await db.transaction('rw', table, async () => {
    await table.clear();
    await table.bulkPut(rows);
  });
}
