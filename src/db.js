// Uses Node.js built-in sqlite (available in Node 22+, no install needed)
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './paths.js';

let _db;

function getDb() {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    initSchema(_db);
  }
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      role    TEXT NOT NULL,
      content TEXT NOT NULL,
      topic   TEXT DEFAULT 'none',
      ts      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_count (
      date  TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export function getState(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM state WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setState(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

export function addMessage(role, content, topic = 'none') {
  getDb().prepare('INSERT INTO messages (role, content, topic) VALUES (?, ?, ?)').run(role, content, topic);
}

export function getRecentMessages(limit = 20) {
  return getDb()
    .prepare('SELECT role, content FROM messages ORDER BY id DESC LIMIT ?')
    .all(limit)
    .reverse();
}

export function getTodayCount() {
  const today = new Date().toISOString().split('T')[0];
  const row = getDb().prepare('SELECT count FROM daily_count WHERE date = ?').get(today);
  return row ? row.count : 0;
}

export function incrementCount() {
  const today = new Date().toISOString().split('T')[0];
  getDb().prepare(`
    INSERT INTO daily_count (date, count) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET count = count + 1
  `).run(today);
}

export const isOnboarded    = ()      => getState('onboarded', false) === true;
export const getHumorLevel  = ()      => getState('humor_level', 75);
export const setHumorLevel  = (lvl)   => setState('humor_level', Math.max(0, Math.min(100, Number(lvl))));
export const getQuietUntil  = ()      => getState('quiet_until', null);
export const setQuietUntil  = (iso)   => setState('quiet_until', iso);
export const isPaused       = ()      => getState('paused', false) === true;
export const setPaused      = (val)   => setState('paused', val);
