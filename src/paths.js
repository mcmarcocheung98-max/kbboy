import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// On Railway: set DATA_DIR=/data and mount a persistent volume there.
// Locally: falls back to the repo root.
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..');

export const DB_PATH      = join(DATA_DIR, 'kbboy.db');
export const CONFIG_PATH  = join(DATA_DIR, 'config.json');
export const TOKENS_PATH  = join(DATA_DIR, 'tokens.json');
export const MEMORY_DIR   = join(DATA_DIR, 'memory');
export const PERSONA_PATH = join(__dirname, '../kbboy-persona.md');

// Ensure runtime dirs exist
if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
