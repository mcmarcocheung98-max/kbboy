import { setHumorLevel, getHumorLevel, setQuietUntil, setPaused, setState, getState } from './db.js';
import { wipeTopic, listTopics, readLog } from './memory.js';
import { getTodayEvents, getUpcomingEvents } from './gcal.js';
import { generateProactiveMessage } from './claude.js';
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
        `/humor [0-100] — set humor dial (currently ${getHumorLevel()}/100)\n` +
        `/quiet [1-24]h — quiet mode for N hours\n` +
        `/dnd — do not disturb until tomorrow morning\n` +
        `/pause — pause all messages\n` +
        `/resume — resume messages\n` +
        `/sleep [HH:MM] [HH:MM] — update sleep window\n` +
        `/mute buddy [Xh] — pause dog reminders\n` +
        `/calendar — show upcoming events\n` +
        `/today — today's brief\n` +
        `/report — weekly report card\n` +
        `/memory — list all topic logs\n` +
        `/forget [topic] — wipe a topic log\n` +
        `/update — re-run onboarding to update your settings\n` +
        `/timezone [city] — update timezone\n`,
        { parse_mode: 'Markdown' }
      );

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

    default:
      return ctx.reply(`Unknown command. Type /help to see what I can do.`);
  }
}
