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
    CREATE TABLE IF NOT EXISTS routines (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      emoji  TEXT DEFAULT '✅',
      time   TEXT,
      days   TEXT DEFAULT 'daily',
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS routine_logs (
      routine_id INTEGER NOT NULL,
      date       TEXT NOT NULL,
      status     TEXT DEFAULT 'pending',
      PRIMARY KEY (routine_id, date)
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      fire_at TEXT NOT NULL,
      urgent  INTEGER DEFAULT 0,
      sent    INTEGER DEFAULT 0
    );
  `);
}

// ── Routines ──────────────────────────────────────────────────────
export function getAllRoutines() {
  return getDb().prepare('SELECT * FROM routines WHERE active = 1 ORDER BY time ASC, id ASC').all();
}

export function getRoutineById(id) {
  return getDb().prepare('SELECT * FROM routines WHERE id = ?').get(id);
}

export function getRoutineByName(name) {
  return getDb().prepare("SELECT * FROM routines WHERE active = 1 AND LOWER(name) LIKE LOWER(?) LIMIT 1").get(`%${name}%`);
}

export function addRoutine({ name, emoji = '✅', time = null, days = 'daily' }) {
  return getDb().prepare('INSERT INTO routines (name, emoji, time, days) VALUES (?, ?, ?, ?)').run(name, emoji, time, days);
}

export function removeRoutine(id) {
  getDb().prepare('UPDATE routines SET active = 0 WHERE id = ?').run(id);
}

export function logRoutine(routineId, status = 'done') {
  const today = new Date().toISOString().split('T')[0];
  getDb().prepare(`
    INSERT INTO routine_logs (routine_id, date, status) VALUES (?, ?, ?)
    ON CONFLICT(routine_id, date) DO UPDATE SET status = excluded.status
  `).run(routineId, today, status);
}

export function getTodayRoutineLogs() {
  const today = new Date().toISOString().split('T')[0];
  return getDb().prepare(`
    SELECT r.*, COALESCE(l.status, 'pending') as status
    FROM routines r
    LEFT JOIN routine_logs l ON l.routine_id = r.id AND l.date = ?
    WHERE r.active = 1
    ORDER BY r.time ASC, r.id ASC
  `).all(today);
}

export function getRoutineStreak(routineId) {
  const logs = getDb().prepare(`
    SELECT date, status FROM routine_logs
    WHERE routine_id = ? AND status = 'done'
    ORDER BY date DESC
  `).all(routineId);

  if (!logs.length) return 0;
  let streak = 0;
  let cursor = new Date(); cursor.setHours(0,0,0,0);
  for (const log of logs) {
    const logDate = new Date(log.date + 'T00:00:00');
    const diff = Math.round((cursor - logDate) / 86400000);
    if (diff > 1) break;
    streak++;
    cursor = logDate;
  }
  return streak;
}

// ── Reminders ─────────────────────────────────────────────────────
export function addReminder({ message, fireAt, urgent = false }) {
  return getDb().prepare('INSERT INTO reminders (message, fire_at, urgent) VALUES (?, ?, ?)').run(message, fireAt, urgent ? 1 : 0);
}

export function getPendingReminders() {
  const now = new Date().toISOString();
  return getDb().prepare("SELECT * FROM reminders WHERE sent = 0 AND fire_at <= ?").all(now);
}

export function markReminderSent(id) {
  getDb().prepare('UPDATE reminders SET sent = 1 WHERE id = ?').run(id);
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
