import OpenAI from 'openai';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Voice replies via OpenAI TTS — optional feature
// Enable: set OPENAI_API_KEY in Railway env vars, then /voice on in Telegram
// Voice: 'nova' — young, natural, fits KBboy's energy

let _client;
function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export function isVoiceAvailable() {
  return !!process.env.OPENAI_API_KEY;
}

function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-•]\s/gm, '')
    .trim();
}

export async function textToVoicePath(text) {
  const client = getClient();
  if (!client) return null;

  try {
    const clean     = stripMarkdown(text);
    const truncated = clean.length > 500 ? clean.slice(0, 497) + '...' : clean;

    const mp3 = await client.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: truncated,
      speed: 1.05,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    const path   = join(tmpdir(), `kbboy-${Date.now()}.mp3`);
    writeFileSync(path, buffer);
    return path;
  } catch (err) {
    console.error('[voice] TTS error:', err.message);
    return null;
  }
}

export function cleanupVoiceFile(path) {
  try { if (path && existsSync(path)) unlinkSync(path); } catch {}
}
