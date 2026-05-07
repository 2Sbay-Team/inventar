// Repository layer over Dexie. Each function takes the InventarDB
// instance as its first argument so unit tests can inject a fresh
// fake-indexeddb-backed instance per case (see `db/db.test.ts` for the
// pattern). Application code uses the `db` singleton from `db/db.ts`.

export * from './internal-code';
export * from './quantity';
export * from './profile';
export * from './photos';
export * from './movements';
export * from './variants';
export * from './articles';
export * from './expenses';
