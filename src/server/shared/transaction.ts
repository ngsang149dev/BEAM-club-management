import type { Database, DbExecutor } from './db';

export type TransactionContext = DbExecutor;

export interface TransactionRunner {
  runInTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export class DrizzleTransactionRunner implements TransactionRunner {
  constructor(private readonly db: Database) {}

  runInTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }
}
