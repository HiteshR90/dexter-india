/**
 * SQLite storage for portfolio holdings and snapshots.
 * Uses bun:sqlite (preferred) with better-sqlite3 fallback.
 * DB file: ~/.dexter/portfolio.db
 */

import { join } from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import type { Holding } from './csv-parser.js';

const DB_DIR = join(homedir(), '.dexter');
const DB_PATH = join(DB_DIR, 'portfolio.db');

/** Minimal DB abstraction matching bun:sqlite's API */
type SqliteQuery<T> = {
  all(...params: unknown[]): T[];
  get(...params: unknown[]): T | null;
  run(...params: unknown[]): void;
};

type SqliteDatabase = {
  exec(sql: string): void;
  query<T>(sql: string): SqliteQuery<T>;
  close(): void;
};

const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    quantity REAL NOT NULL DEFAULT 0,
    avg_price REAL NOT NULL DEFAULT 0,
    last_price REAL NOT NULL DEFAULT 0,
    sector TEXT DEFAULT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_value REAL NOT NULL DEFAULT 0,
    total_pnl REAL NOT NULL DEFAULT 0,
    snapshot_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_holdings_symbol ON holdings(symbol);
  CREATE INDEX IF NOT EXISTS idx_snapshots_at ON portfolio_snapshots(snapshot_at DESC);
`;

let _db: SqliteDatabase | null = null;

async function openSqlite(path: string): Promise<SqliteDatabase> {
  // Prefer bun:sqlite when running under Bun; fall back to better-sqlite3 for Node.js
  try {
    const sqlite = await import('bun:sqlite');
    const DatabaseCtor = sqlite.Database as new (dbPath: string) => SqliteDatabase;
    return new DatabaseCtor(path);
  } catch {
    const mod = await import('better-sqlite3');
    const Database = mod.default;
    const raw = new Database(path);
    return {
      exec: (sql: string) => raw.exec(sql),
      query: <T>(sql: string): SqliteQuery<T> => {
        const stmt = raw.prepare(sql);
        return {
          all: (...params: unknown[]) => stmt.all(...params) as T[],
          get: (...params: unknown[]) => (stmt.get(...params) as T) ?? null,
          run: (...params: unknown[]) => { stmt.run(...params); },
        };
      },
      close: () => raw.close(),
    };
  }
}

async function getDb(): Promise<SqliteDatabase> {
  if (_db) return _db;

  mkdirSync(DB_DIR, { recursive: true });
  _db = await openSqlite(DB_PATH);
  _db.exec(CREATE_SCHEMA);
  return _db;
}

export interface StoredHolding {
  id: number;
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number;
  lastPrice: number;
  sector: string | null;
  uploadedAt: string;
}

export interface PortfolioSnapshot {
  id: number;
  totalValue: number;
  totalPnl: number;
  snapshotAt: string;
}

type HoldingRow = {
  id: number;
  symbol: string;
  name: string;
  quantity: number;
  avg_price: number;
  last_price: number;
  sector: string | null;
  uploaded_at: string;
};

type SnapshotRow = {
  id: number;
  total_value: number;
  total_pnl: number;
  snapshot_at: string;
};

/**
 * Save holdings to the database. Replaces all existing holdings (full refresh).
 */
export async function saveHoldings(holdings: Holding[]): Promise<{ count: number }> {
  const db = await getDb();

  db.query('DELETE FROM holdings').run();

  const insert = db.query<void>(
    'INSERT INTO holdings (symbol, name, quantity, avg_price, last_price, sector) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const h of holdings) {
    insert.run(h.symbol, h.name, h.quantity, h.avgPrice, h.currentPrice ?? 0, h.sector ?? null);
  }

  return { count: holdings.length };
}

/**
 * Get all current holdings from the database.
 */
export async function getHoldings(): Promise<StoredHolding[]> {
  const db = await getDb();
  const rows = db
    .query<HoldingRow>('SELECT id, symbol, name, quantity, avg_price, last_price, sector, uploaded_at FROM holdings ORDER BY symbol')
    .all();

  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    quantity: r.quantity,
    avgPrice: r.avg_price,
    lastPrice: r.last_price ?? 0,
    sector: r.sector,
    uploadedAt: r.uploaded_at,
  }));
}

/**
 * Save a portfolio snapshot (total value and P&L at a point in time).
 */
export async function saveSnapshot(totalValue: number, totalPnl: number): Promise<PortfolioSnapshot> {
  const db = await getDb();

  db.query<void>('INSERT INTO portfolio_snapshots (total_value, total_pnl) VALUES (?, ?)').run(totalValue, totalPnl);

  const row = db
    .query<SnapshotRow>('SELECT id, total_value, total_pnl, snapshot_at FROM portfolio_snapshots ORDER BY id DESC LIMIT 1')
    .get();

  return {
    id: row!.id,
    totalValue: row!.total_value,
    totalPnl: row!.total_pnl,
    snapshotAt: row!.snapshot_at,
  };
}

/**
 * Get the most recent portfolio snapshot.
 */
export async function getLatestSnapshot(): Promise<PortfolioSnapshot | null> {
  const db = await getDb();
  const row = db
    .query<SnapshotRow>('SELECT id, total_value, total_pnl, snapshot_at FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT 1')
    .get();

  if (!row) return null;

  return {
    id: row.id,
    totalValue: row.total_value,
    totalPnl: row.total_pnl,
    snapshotAt: row.snapshot_at,
  };
}
