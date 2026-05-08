import { Markup } from 'telegraf';
import {
  setHumorLevel, getHumorLevel, setQuietUntil, setPaused, setState, getState,
  getAllRoutines, getRoutineByName, addRoutine, removeRoutine, logRoutine,
  getTodayRoutineLogs, addReminder,
} from './db.js';
import { parseDays, formatTodayRoutines, formatAllRoutines, formatStreaks, parseReminderTime, formatReminderTime, isDueToday } from './routines.js';
import { wipeTopic, listTopics, readLog } from './memory.js';
import { getTodayEvents, getUpcomingEvents } from './gcal.js';
import { generateProactiveMessage } from './claude.js';
import { isVoiceAvailable } from './voice.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { CONFIG_PATH } from './paths.js';

function loadConfig() {
  return existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : {};
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export async function handleCommand(ctx, command, args) {
  const config = loadConfig();
  const name = config.profile?.name || 'Marco';

  switch (command) {

    case 'help':
      return ctx.reply(
        `*KBboy Commands*\n\n` +
        `*Routines & Reminders*\n` +
        `/routine — today's status\n` +
        `/routine add [emoji] name [time] [days] — add routine\n` +
        `/routine streak — streak counts\n` +
        `/remind [time] [message] — one-shot reminder\n\n` +
        `*Settings*\n` +
        `/humor [0-100] — humor dial (currently ${getHumorLevel()}/100)\n` +
        `/voice on|off — voice replies${isVoiceAvailable() ? '' : ' (needs OPENAI_API_KEY)'}\n` +
        `/quiet [1-24]h — quiet mode for N hours\n` +
        `/dnd — do not disturb until tomorrow 7am\n` +
        `/pause / /resume — toggle proactive messages\n` +
        `/sleep HH:MM HH:MM — update sleep window\n` +
        `/mute buddy [Xh] — pause dog reminders\n` +
        `/timezone [city] — update timezone\n\n` +
        `*Info*\n` +
        `/calendar — upcoming events\n` +
        `/today — today's brief\n` +
        `/report — weekly report card\n` +
        `/memory — topic logs\n` +
        `/backup — all memory logs\n` +
        `/forget [topic] — wipe a topic log\n` +
        `/update — redo onboarding\n`,
        { parse_mode: 'Markdown' }
      );

    case 'voice': {
      if (!isVoiceAvailable()) {
        return ctx.reply(`Voice replies need OPENAI_API_KEY set in your Railway env vars.\nAdd it and redeploy — then /voice on will work.`);
      }
      const setting = args[0]?.toLowerCase();
      if (setting === 'on') {
        setState('voice_enabled', true);
        return ctx.reply(`Voice on. I'll send audio replies from now on la.`);
      }
      if (setting === 'off') {
        setState('voice_enabled', false);
        return ctx.reply(`Voice off. Text only.`);
      }
      const current = getState('voice_enabled', false);
      return ctx.reply(`Voice is currently ${current ? 'ON' : 'OFF'}.\nUse /voice on or /voice off.`);
    }

    case 'backup': {
      const topics = listTopics();
      if (!topics.length) return ctx.reply('No memory logs yet.');
      let backup = `*KBboy Memory Backup*\n\n`;
      for (const topic of topics) {
        const log = readLog(topic, 10);
        if (log) backup += `*${topic.toUpperCase()}*\n${log}\n\n`;
      }
      // Split if too long for Telegram (4096 char limit)
      if (backup.length <= 4000) {
        return ctx.reply(backup, { parse_mode: 'Markdown' });
      }
      // Send in chunks
      const chunks = backup.match(/.{1,4000}/gs) || [];
      for (const chunk of chunks) await ctx.reply(chunk, { parse_mode: 'Markdown' });
      return;
    }

    case 'humor': {
      const level = parseInt(args[0]);
      if (isNaN(level) || level < 0 || level > 100) {
        return ctx.reply(`Humor is currently ${getHumorLevel()}/100.\nUse /humor [0-100] to change it.\n0 = pure signal, 100 = full TARS chaos.`);
      }
      setHumorLevel(level);
      const quips = {
        0:   "Alright. Zero humor. Just facts from here.",
        25:  "25. Mostly serious. I'll save the jokes.",
        50:  "50. Balanced mode. Warm but efficient.",
        75:  "75. This is where I live. Default KBboy.",
        100: "100. Full TARS mode. Do not go gentle into that good night, Marco.",
      };
      const quip = quips[level] || `Humor set to ${level}/100.`;
      return ctx.reply(quip);
    }

    case 'quiet': {
      const hours = parseFloat(args[0]) || 2;
      const until = new Date(Date.now() + hours * 3600000).toISOString();
      setQuietUntil(until);
      return ctx.reply(`Quiet mode on for ${hours}h. I'll leave you alone la.`);
    }

    case 'dnd': {
      const tomorrow7am = new Date();
      tomorrow7am.setDate(tomorrow7am.getDate() + 1);
      tomorrow7am.setHours(7, 0, 0, 0);
      setQuietUntil(tomorrow7am.toISOString());
      return ctx.reply(`DND until tomorrow 7am. Night ${name}.`);
    }

    case 'pause':
      setPaused(true);
      return ctx.reply(`All proactive messages paused. Say /resume when you're back.`);

    case 'resume':
      setPaused(false);
      setQuietUntil(null);
      return ctx.reply(`We're back. What did I miss?`);

    case 'sleep': {
      const [start, end] = args;
      if (!start || !end) return ctx.reply('Usage: /sleep HH:MM HH:MM\nExample: /sleep 23:00 07:00');
      config.kbboy = config.kbboy || {};
      config.kbboy.sleepStart = start;
      config.kbboy.sleepEnd = end;
      saveConfig(config);
      return ctx.reply(`Sleep window updated: ${start} → ${end}. No messages during that window.`);
    }

    case 'mute': {
      if (args[0] === 'buddy') {
        const hours = parseFloat(args[1]) || 4;
        setState('mute_buddy_until', new Date(Date.now() + hours * 3600000).toISOString());
        return ctx.reply(`Buddy reminders paused for ${hours}h.`);
      }
      return ctx.reply(`Usage: /mute buddy [hours]`);
    }

    case 'calendar': {
      const events = await getUpcomingEvents(14);
      if (!events.length) return ctx.reply('No events in the next 14 days.');
      const lines = events.map(e =>
        `*${formatDate(e.start?.split('T')[0] || '')}* ${e.time}\n${e.title}${e.location ? '\n📍 ' + e.location : ''}`
      ).join('\n\n');
      return ctx.reply(`📅 *Next 14 Days*\n\n${lines}`, { parse_mode: 'Markdown' });
    }

    case 'today': {
      const [todayEvents, upcomingEvents] = await Promise.all([getTodayEvents(), getUpcomingEvents(7)]);
      const msg = await generateProactiveMessage({
        type: 'morning_brief',
        config,
        humorLevel: getHumorLevel(),
        todayEvents,
        upcomingEvents,
        upcomingDates: [],
      });
      return ctx.reply(msg);
    }

    case 'report': {
      const [todayEvents, upcomingEvents] = await Promise.all([getTodayEvents(), getUpcomingEvents(7)]);
      const msg = await generateProactiveMessage({
        type: 'weekly_report',
        config,
        humorLevel: getHumorLevel(),
        todayEvents,
        upcomingEvents,
        upcomingDates: [],
      });
      return ctx.reply(msg);
    }

    case 'memory': {
      const topics = listTopics();
      if (!topics.length) return ctx.reply('No memory logs yet. Talk to me about your gym, diet, work, etc.');
      return ctx.reply(`*Memory Logs*\n\n${topics.map(t => `• ${t}`).join('\n')}\n\nUse /forget [topic] to wipe one.`, { parse_mode: 'Markdown' });
    }

    case 'forget': {
      const topic = args[0];
      if (!topic) return ctx.reply('Usage: /forget [topic]\nExample: /forget gym');
      const topics = listTopics();
      if (!topics.includes(topic)) return ctx.reply(`No log found for "${topic}". Topics: ${topics.join(', ')}`);
      wipeTopic(topic);
      return ctx.reply(`${topic} memory wiped. Fresh start.`);
    }

    case 'update':
      setState('onboarded', false);
      setState('onboarding_data', {});
      setState('onboarding_history', []);
      return ctx.reply(`Starting over. Let's update your setup ${name}.`);

    case 'timezone': {
      const city = args.join(' ');
      if (!city) return ctx.reply('Usage: /timezone [city]\nExample: /timezone Hong Kong');
      config.profile = config.profile || {};
      config.profile.timezone = city;
      saveConfig(config);
      return ctx.reply(`Timezone updated to ${city}.`);
    }

    case 'routine': {
      const sub = args[0]?.toLowerCase();

      if (!sub || sub === 'list') {
        const logs = getTodayRoutineLogs();
        const due = logs.filter(r => isDueToday(r));
        const pending = due.filter(r => r.status === 'pending');
        const keyboard = pending.length
          ? Markup.inlineKeyboard(pending.map(r => [
              Markup.button.callback(`✅ ${r.name}`, `routine_done:${r.id}`),
              Markup.button.callback(`⏭ Skip`, `routine_skip:${r.id}`),
            ]))
          : {};
        return ctx.reply(formatTodayRoutines(logs), { parse_mode: 'Markdown', ...keyboard });
      }

      if (sub === 'all') {
        const routines = getAllRoutines();
        return ctx.reply(formatAllRoutines(routines), { parse_mode: 'Markdown' });
      }

      if (sub === 'streak' || sub === 'streaks') {
        const routines = getAllRoutines();
        return ctx.reply(formatStreaks(routines), { parse_mode: 'Markdown' });
      }

      if (sub === 'add') {
        const rest = args.slice(1);
        let emoji = '✅', startIdx = 0;
        if (rest[0] && /^\p{Emoji}/u.test(rest[0])) { emoji = rest[0]; startIdx = 1; }

        const timeIdx = rest.findIndex((a, i) => i >= startIdx && /^\d{1,2}:\d{2}$/.test(a));
        const daysIdx = rest.findIndex((a, i) => i >= startIdx && /^(daily|weekdays|weekends|mon|tue|wed|thu|fri|sat|sun)/i.test(a));

        const nameEnd = Math.min(
          timeIdx >= 0 ? timeIdx : rest.length,
          daysIdx >= 0 ? daysIdx : rest.length,
        );
        const routineName = rest.slice(startIdx, nameEnd).join(' ');
        if (!routineName) return ctx.reply('Usage: /routine add [emoji] name [HH:MM] [days]\nExample: /routine add 🏋 Gym 06:30 weekdays');

        const time = timeIdx >= 0 ? rest[timeIdx] : null;
        const days = daysIdx >= 0 ? parseDays(rest.slice(daysIdx).join(' ')) : 'daily';

        addRoutine({ name: routineName, emoji, time, days });
        return ctx.reply(
          `Added ${emoji} *${routineName}*${time ? ' at ' + time : ''}  _${days === 'daily' ? 'every day' : days}_`,
          { parse_mode: 'Markdown' }
        );
      }

      if (sub === 'done') {
        const routineName = args.slice(1).join(' ');
        if (!routineName) return ctx.reply('Usage: /routine done [name]');
        const routine = getRoutineByName(routineName);
        if (!routine) return ctx.reply(`No routine found matching "${routineName}"`);
        logRoutine(routine.id, 'done');
        return ctx.reply(`${routine.emoji} *${routine.name}* — done ✅`, { parse_mode: 'Markdown' });
      }

      if (sub === 'skip') {
        const routineName = args.slice(1).join(' ');
        if (!routineName) return ctx.reply('Usage: /routine skip [name]');
        const routine = getRoutineByName(routineName);
        if (!routine) return ctx.reply(`No routine found matching "${routineName}"`);
        logRoutine(routine.id, 'skipped');
        return ctx.reply(`${routine.emoji} *${routine.name}* — skipped ⏭`, { parse_mode: 'Markdown' });
      }

      if (sub === 'remove' || sub === 'delete') {
        const routineName = args.slice(1).join(' ');
        if (!routineName) return ctx.reply('Usage: /routine remove [name]');
        const routine = getRoutineByName(routineName);
        if (!routine) return ctx.reply(`No routine found matching "${routineName}"`);
        removeRoutine(routine.id);
        return ctx.reply(`Removed ${routine.emoji} *${routine.name}*.`, { parse_mode: 'Markdown' });
      }

      return ctx.reply(
        `*Routine Commands*\n\n` +
        `/routine — today's status (with quick buttons)\n` +
        `/routine all — all routines\n` +
        `/routine streak — streak counts\n` +
        `/routine add [emoji] name [HH:MM] [days] — add new\n` +
        `/routine done [name] — mark done\n` +
        `/routine skip [name] — mark skipped\n` +
        `/routine remove [name] — delete`,
        { parse_mode: 'Markdown' }
      );
    }

    case 'remind': {
      if (!args.length) {
        return ctx.reply(
          'Usage: /remind [time] [message]\n\nExamples:\n' +
          '/remind in 30min take meds\n' +
          '/remind 9pm call mom\n' +
          '/remind tomorrow 9am dentist appointment'
        );
      }

      let fireAt = null, messageStart = 1;

      if (args[0].toLowerCase() === 'in' && args[1]) {
        fireAt = parseReminderTime(`in ${args[1]}`);
        messageStart = 2;
      } else if (args[0].toLowerCase() === 'tomorrow' && args[1]) {
        fireAt = parseReminderTime(`tomorrow ${args[1]}`);
        messageStart = 2;
      } else {
        fireAt = parseReminderTime(args[0]);
        messageStart = 1;
      }

      if (!fireAt) return ctx.reply(`Couldn't parse that time. Try:\n/remind in 30min [message]\n/remind 9pm [message]\n/remind tomorrow 9am [message]`);

      const message = args.slice(messageStart).join(' ');
      if (!message) return ctx.reply('Need a message after the time.\nExample: /remind in 30min take meds');

      addReminder({ message, fireAt });
      return ctx.reply(`⏰ Reminder set — ${formatReminderTime(fireAt)}\n"${message}"`);
    }

    case 'fixsetup': {
      const cfg = loadConfig();
      if (!cfg.profile?.name) {
        return ctx.reply(`config.json is missing or empty — can't restore. You'll need to run /start once to rebuild it. Sorry la.`);
      }
      setState('onboarded', true);
      return ctx.reply(`Fixed. You're marked as set up again, ${cfg.profile.name}. Try sending a photo now.`);
    }

    default:
      return ctx.reply(`Unknown command. Type /help to see what I can do.`);
  }
}
