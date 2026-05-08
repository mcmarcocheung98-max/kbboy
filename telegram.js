import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  isOnboarded, getHumorLevel, addMessage,
  getRecentMessages, incrementCount, getState, setState,
} from './src/db.js';
import { detectTopic, appendToLog, topicExists, createTopic, readLog, KNOWN_TOPICS } from './src/memory.js';
import { chat, chatWithImage, summariseForMemory } from './src/claude.js';
import { handleOnboarding } from './src/onboarding.js';
import { handleCommand } from './src/commands.js';
import { setupScheduler } from './src/scheduler.js';
import { getTodayEvents, getUpcomingEvents } from './src/gcal.js';
import { textToVoicePath, cleanupVoiceFile, isVoiceAvailable } from './src/voice.js';
import { CONFIG_PATH } from './src/paths.js';

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_ID  = parseInt(process.env.TELEGRAM_ALLOWED_ID || '0');

if (!BOT_TOKEN)  { console.error('TELEGRAM_BOT_TOKEN not set');  process.exit(1); }
if (!ALLOWED_ID) { console.error('TELEGRAM_ALLOWED_ID not set'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

function loadConfig() {
  return existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : {};
}

function getUpcomingImportantDates(config, daysAhead = 30) {
  const now = new Date();
  return (config.importantDates || []).reduce((acc, d) => {
    const thisYear = new Date(now.getFullYear(), d.month - 1, d.day);
    const nextYear = new Date(now.getFullYear() + 1, d.month - 1, d.day);
    const target   = thisYear >= now ? thisYear : nextYear;
    const days     = Math.ceil((target - now) / 86400000);
    if (days <= daysAhead) acc.push({ ...d, daysUntil: days });
    return acc;
  }, []).sort((a, b) => a.daysUntil - b.daysUntil);
}

// Shared reply helper — sends text + optional voice
async function sendReply(ctx, text) {
  await ctx.reply(text);

  if (getState('voice_enabled', false) && isVoiceAvailable()) {
    try {
      await ctx.sendChatAction('record_voice');
      const voicePath = await textToVoicePath(text);
      if (voicePath) {
        await ctx.replyWithVoice({ source: voicePath });
        cleanupVoiceFile(voicePath);
      }
    } catch (err) {
      console.error('[voice] Send error:', err.message);
    }
  }
}

// Shared KBboy chat logic
async function kbboyChat(ctx, userMessage, imageBase64 = null, mimeType = 'image/jpeg') {
  await ctx.sendChatAction('typing');

  const config       = loadConfig();
  const humorLevel   = getHumorLevel();
  const history      = getRecentMessages(20);
  const topic        = detectTopic(userMessage || '');
  const topicLog     = topic ? readLog(topic, 5) : null;

  let todayEvents = [], upcomingEvents = [], upcomingDates = [];
  try {
    [todayEvents, upcomingEvents] = await Promise.all([getTodayEvents(), getUpcomingEvents(7)]);
    upcomingDates = getUpcomingImportantDates(config, 30);
  } catch {}

  const shared = { config, humorLevel, todayEvents, upcomingEvents, upcomingDates };

  let reply;
  try {
    if (imageBase64) {
      reply = await chatWithImage({ imageBase64, mimeType, caption: userMessage, history, ...shared });
    } else {
      reply = await chat({ userMessage, history, topicLog, topicName: topic, ...shared });
    }
  } catch (err) {
    console.error('[chat] Error:', err.message);
    return ctx.reply(`Something went wrong la. Try again?`);
  }

  // Persist
  addMessage('user',      userMessage || '[image]', topic || 'none');
  addMessage('assistant', reply,                    topic || 'none');
  incrementCount();

  // Log to topic memory
  if (topic && userMessage) {
    summariseForMemory({ userMessage, botResponse: reply, topic })
      .then(summary => {
        if (!topicExists(topic)) createTopic(topic);
        appendToLog(topic, summary);
      })
      .catch(() => {});
  }

  await sendReply(ctx, reply);
}

// ── Whitelist middleware ──────────────────────────────────────────
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_ID) return;
  return next();
});

// ── Text messages ─────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // Commands
  if (text.startsWith('/')) {
    const [rawCmd, ...args] = text.slice(1).split(' ');
    const command = rawCmd.toLowerCase();

    if (command === 'start') {
      if (isOnboarded()) return ctx.reply(`Already set up. What do you need?\n\nType /help for commands.`);
      setState('onboarding_history', []);
      setState('onboarding_data', {});
      const result = await handleOnboarding('', []);
      setState('onboarding_history', [
        { role: 'user',      content: 'Hi, I want to set up KBboy.' },
        { role: 'assistant', content: result.reply },
      ]);
      return ctx.reply(result.reply);
    }

    if (command === 'help' && !isOnboarded()) return ctx.reply(`Not set up yet. Send /start to begin.`);
    return handleCommand(ctx, command, args);
  }

  // Onboarding
  if (!isOnboarded()) {
    const history = getState('onboarding_history', []);
    const result  = await handleOnboarding(text, history);
    setState('onboarding_history', [
      ...history,
      { role: 'user',      content: text },
      { role: 'assistant', content: result.reply },
    ]);
    await ctx.reply(result.reply);
    if (result.done) setupScheduler(bot, ctx.chat.id);
    return;
  }

  await kbboyChat(ctx, text);
});

// ── Photo messages ────────────────────────────────────────────────
bot.on('photo', async (ctx) => {
  if (!isOnboarded()) return ctx.reply(`Set up first — send /start.`);

  await ctx.sendChatAction('typing');

  // Get highest resolution photo
  const photo  = ctx.message.photo[ctx.message.photo.length - 1];
  const caption = ctx.message.caption || '';

  try {
    const file    = await ctx.telegram.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    const res    = await fetch(fileUrl);
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    await kbboyChat(ctx, caption || 'What do you see?', base64, 'image/jpeg');
  } catch (err) {
    console.error('[photo] Error:', err.message);
    await ctx.reply(`Couldn't read the image la. Try again?`);
  }
});

// ── Document (image files sent as files) ─────────────────────────
bot.on('document', async (ctx) => {
  if (!isOnboarded()) return ctx.reply(`Set up first — send /start.`);

  const doc = ctx.message.document;
  if (!doc.mime_type?.startsWith('image/')) {
    return ctx.reply(`I can read images. For other files, just describe what you need.`);
  }

  await ctx.sendChatAction('typing');

  try {
    const file    = await ctx.telegram.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const res     = await fetch(fileUrl);
    const buffer  = await res.arrayBuffer();
    const base64  = Buffer.from(buffer).toString('base64');
    const caption = ctx.message.caption || 'What do you see?';

    await kbboyChat(ctx, caption, base64, doc.mime_type);
  } catch (err) {
    console.error('[document] Error:', err.message);
    await ctx.reply(`Couldn't read that image. Try again?`);
  }
});

// Graceful shutdown
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

async function main() {
  console.log('[kbboy] Starting...');

  if (isOnboarded()) {
    setupScheduler(bot, ALLOWED_ID);
    console.log('[kbboy] Scheduler running.');
  }

  await bot.launch();
  console.log('[kbboy] KBboy is live. Waiting for messages...');
}

main().catch(console.error);
