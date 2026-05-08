import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  isOnboarded, getHumorLevel, addMessage,
  getRecentMessages, incrementCount, getTodayCount,
  getState, setState,
} from './src/db.js';
import { detectTopic, appendToLog, topicExists, createTopic, readLog, KNOWN_TOPICS } from './src/memory.js';
import { chat, summariseForMemory } from './src/claude.js';
import { handleOnboarding } from './src/onboarding.js';
import { handleCommand } from './src/commands.js';
import { setupScheduler } from './src/scheduler.js';
import { getTodayEvents, getUpcomingEvents } from './src/gcal.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_ID = parseInt(process.env.TELEGRAM_ALLOWED_ID || '0');

if (!BOT_TOKEN) { console.error('TELEGRAM_BOT_TOKEN not set'); process.exit(1); }
if (!ALLOWED_ID) { console.error('TELEGRAM_ALLOWED_ID not set'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

import { CONFIG_PATH } from './src/paths.js';

function loadConfig() {
  return existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : {};
}

function getUpcomingImportantDates(config, daysAhead = 30) {
  const now = new Date();
  return (config.importantDates || []).reduce((acc, d) => {
    const thisYear = new Date(now.getFullYear(), d.month - 1, d.day);
    const nextYear = new Date(now.getFullYear() + 1, d.month - 1, d.day);
    const target = thisYear >= now ? thisYear : nextYear;
    const days = Math.ceil((target - now) / 86400000);
    if (days <= daysAhead) acc.push({ ...d, daysUntil: days });
    return acc;
  }, []).sort((a, b) => a.daysUntil - b.daysUntil);
}

// Whitelist middleware — silently ignore strangers
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId !== ALLOWED_ID) return;
  return next();
});

// Handle all text messages
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // Route commands
  if (text.startsWith('/')) {
    const [rawCmd, ...args] = text.slice(1).split(' ');
    const command = rawCmd.toLowerCase();

    // Commands that work before onboarding
    if (command === 'start') {
      if (isOnboarded()) {
        return ctx.reply(`Already set up. What do you need?\n\nType /help for commands.`);
      }
      setState('onboarding_history', []);
      setState('onboarding_data', {});
      const result = await handleOnboarding('', []);
      setState('onboarding_history', [
        { role: 'user', content: 'Hi, I want to set up KBboy.' },
        { role: 'assistant', content: result.reply },
      ]);
      return ctx.reply(result.reply);
    }

    if (command === 'help' && !isOnboarded()) {
      return ctx.reply(`Not set up yet. Send /start to begin.`);
    }

    return handleCommand(ctx, command, args);
  }

  // Onboarding flow
  if (!isOnboarded()) {
    const history = getState('onboarding_history', []);
    const result = await handleOnboarding(text, history);

    const updatedHistory = [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: result.reply },
    ];
    setState('onboarding_history', updatedHistory);

    await ctx.reply(result.reply);
    if (result.done) {
      setupScheduler(bot, ctx.chat.id);
    }
    return;
  }

  // Main KBboy chat
  await ctx.sendChatAction('typing');

  const config = loadConfig();
  const humorLevel = getHumorLevel();
  const history = getRecentMessages(20);
  const topic = detectTopic(text);
  const topicLog = topic ? readLog(topic, 5) : null;

  let todayEvents = [], upcomingEvents = [], upcomingDates = [];
  try {
    [todayEvents, upcomingEvents] = await Promise.all([getTodayEvents(), getUpcomingEvents(7)]);
    upcomingDates = getUpcomingImportantDates(config, 30);
  } catch {}

  let reply;
  try {
    reply = await chat({
      userMessage: text,
      history,
      config,
      humorLevel,
      todayEvents,
      upcomingEvents,
      upcomingDates,
      topicLog,
      topicName: topic,
    });
  } catch (err) {
    console.error('[chat] Error:', err.message);
    return ctx.reply(`Something went wrong la. Try again?`);
  }

  // Persist conversation
  addMessage('user', text, topic || 'none');
  addMessage('assistant', reply, topic || 'none');
  incrementCount();

  // Log to topic memory asynchronously
  if (topic) {
    summariseForMemory({ userMessage: text, botResponse: reply, topic })
      .then(summary => {
        if (!topicExists(topic)) createTopic(topic);
        appendToLog(topic, summary);
      })
      .catch(() => {});
  }

  // Handle new topic detection — ask to track
  const isNewTopic = topic && !topicExists(topic) && !Object.keys(KNOWN_TOPICS).includes(topic);
  if (isNewTopic) {
    const label = topic.replace(/_/g, ' ');
    await ctx.reply(reply);
    return ctx.reply(`New topic detected: *${label}*. Want me to start tracking this? Reply "yes" or "no".`, { parse_mode: 'Markdown' });
  }

  return ctx.reply(reply);
});

// Handle new topic confirmation replies
bot.hears(/^yes$/i, async (ctx) => {
  const pending = getState('pending_topic', null);
  if (pending) {
    createTopic(pending);
    setState('pending_topic', null);
    return ctx.reply(`Done. I'll track ${pending.replace(/_/g, ' ')} from now on.`);
  }
});

bot.hears(/^no$/i, async (ctx) => {
  setState('pending_topic', null);
});

// Graceful shutdown
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Start
async function main() {
  console.log('[kbboy] Starting...');

  if (isOnboarded()) {
    const chatId = parseInt(process.env.TELEGRAM_ALLOWED_ID);
    setupScheduler(bot, chatId);
    console.log('[kbboy] Scheduler running.');
  }

  await bot.launch();
  console.log('[kbboy] KBboy is live. Waiting for messages...');
}

main().catch(console.error);
