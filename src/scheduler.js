import cron from 'node-cron';
import { getTodayEvents, getUpcomingEvents } from './gcal.js';
import { generateProactiveMessage } from './claude.js';
import { getTodayCount, incrementCount, getHumorLevel, getQuietUntil, isPaused } from './db.js';
import { readFileSync, existsSync } from 'fs';
import { CONFIG_PATH } from './paths.js';

function loadConfig() {
  const p = CONFIG_PATH;
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

function isInSleepWindow(config) {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const current = h * 60 + m;

  const [sh, sm] = (config.kbboy?.sleepStart || '23:00').split(':').map(Number);
  const [eh, em] = (config.kbboy?.sleepEnd   || '07:00').split(':').map(Number);
  const sleepStart = sh * 60 + sm;
  const sleepEnd   = eh * 60 + em;

  return sleepStart > sleepEnd
    ? current >= sleepStart || current < sleepEnd   // crosses midnight
    : current >= sleepStart && current < sleepEnd;
}

function isQuiet() {
  const until = getQuietUntil();
  if (!until) return false;
  return new Date(until) > new Date();
}

async function canSend(config) {
  if (isPaused()) return false;
  if (isInSleepWindow(config)) return false;
  if (isQuiet()) return false;
  const max = config.kbboy?.maxMessagesPerDay ?? 10;
  return getTodayCount() < max;
}

function isDayIncluded(days) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return !days || days.includes(today);
}

async function send(bot, chatId, type, config, extra = '') {
  if (!await canSend(config)) return;

  try {
    const [todayEvents, upcomingEvents] = await Promise.all([
      getTodayEvents(),
      getUpcomingEvents(7),
    ]);

    const msg = await generateProactiveMessage({
      type,
      config,
      humorLevel: getHumorLevel(),
      todayEvents,
      upcomingEvents,
      upcomingDates: getUpcomingImportantDates(config, 30),
      extra,
    });

    await bot.telegram.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    incrementCount();
  } catch (err) {
    console.error(`[scheduler] Error sending ${type}:`, err.message);
  }
}

function getUpcomingImportantDates(config, daysAhead) {
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

function parseCronTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return `${m} ${h} * * *`;
}

export function setupScheduler(bot, chatId) {
  const config = loadConfig();
  const dog = config.profile?.dog;
  const commute = config.commute;
  const briefTime = config.morningBriefTime || '07:00';

  // Morning brief
  cron.schedule(parseCronTime(briefTime), () => send(bot, chatId, 'morning_brief', loadConfig()));

  // Dog feeding — breakfast
  if (dog?.feedingTimes?.[0]) {
    cron.schedule(parseCronTime(dog.feedingTimes[0]), () => send(bot, chatId, 'buddy_breakfast', loadConfig()));
  }

  // Dog feeding — dinner
  if (dog?.feedingTimes?.[1]) {
    cron.schedule(parseCronTime(dog.feedingTimes[1]), () => send(bot, chatId, 'buddy_dinner', loadConfig()));
  }

  // Dog walks
  if (dog?.walkTimes) {
    const walkTypes = ['buddy_lunch_walk', 'buddy_evening_walk'];
    dog.walkTimes.slice(1).forEach((t, i) => {
      cron.schedule(parseCronTime(t), () => send(bot, chatId, walkTypes[i] || 'buddy_evening_walk', loadConfig()));
    });
  }

  // Leave for work (8:20 to give 10 min buffer)
  if (commute?.targetDepartureTime) {
    const [h, m] = commute.targetDepartureTime.split(':').map(Number);
    const bufferMin = m >= 10 ? m - 10 : 50;
    const bufferHour = m >= 10 ? h : h - 1;
    cron.schedule(`${bufferMin} ${bufferHour} * * ${commute.workDays?.map(d => d.slice(0,3)).join(',') || '1-5'}`, () => {
      if (isDayIncluded(commute.workDays)) send(bot, chatId, 'leave_for_work', loadConfig());
    });
  }

  // Gym check-in at 18:30 on gym days
  cron.schedule('30 18 * * *', () => {
    const cfg = loadConfig();
    if (isDayIncluded(cfg.gym?.schedule)) send(bot, chatId, 'gym_checkin', cfg);
  });

  // Evening skincare — 21:00
  cron.schedule('0 21 * * *', () => send(bot, chatId, 'skincare_pm', loadConfig()));

  // Wind down — 22:30
  cron.schedule('30 22 * * *', () => send(bot, chatId, 'wind_down', loadConfig()));

  // Tomorrow preview — 20:00
  cron.schedule('0 20 * * *', () => send(bot, chatId, 'tomorrow_preview', loadConfig()));

  // Weekly report card — Sunday 20:00
  cron.schedule('0 20 * * 0', () => send(bot, chatId, 'weekly_report', loadConfig()));

  // Random messages — 2 per day on configured days, at random waking hours
  cron.schedule('0 12 * * *', () => {
    const cfg = loadConfig();
    if (isDayIncluded(cfg.kbboy?.randomMessageDays)) send(bot, chatId, 'random_checkin', cfg);
  });
  cron.schedule('0 16 * * *', () => {
    const cfg = loadConfig();
    if (isDayIncluded(cfg.kbboy?.randomMessageDays)) send(bot, chatId, 'random_checkin', cfg, 'Something motivational, observational, or a light question.');
  });

  // Pre-event checker — runs every 30 min, sends reminder 60 min before events
  cron.schedule('*/30 * * * *', async () => {
    const cfg = loadConfig();
    if (!await canSend(cfg)) return;
    try {
      const events = await getUpcomingEvents(1);
      const now = new Date();
      for (const e of events) {
        if (!e.start) continue;
        const eventTime = new Date(e.start);
        const minsUntil = (eventTime - now) / 60000;
        if (minsUntil > 55 && minsUntil <= 65) {
          await send(bot, chatId, 'pre_event', cfg, `${e.title} at ${e.time}${e.location ? ' @ ' + e.location : ''}.${e.notes ? ' Notes: ' + e.notes : ''}`);
        }
      }
    } catch {}
  });

  // Important date checker — runs daily at 08:00
  cron.schedule('0 8 * * *', async () => {
    const cfg = loadConfig();
    const dates = getUpcomingImportantDates(cfg, 5);
    for (const d of dates) {
      if (d.daysUntil <= 5) {
        await send(bot, chatId, 'important_date', cfg, `${d.label} is ${d.daysUntil === 0 ? 'TODAY' : 'in ' + d.daysUntil + ' day(s)'}.`);
      }
    }
  });

  console.log('[scheduler] All jobs scheduled.');
}
