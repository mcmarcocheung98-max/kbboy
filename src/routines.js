import { getAllRoutines, getTodayRoutineLogs, getRoutineStreak, getRoutineByName } from './db.js';

const ALL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// Parse days string — 'daily', 'weekdays', 'weekends', or 'Mon,Wed,Fri'
export function parseDays(input) {
  if (!input || input === 'daily') return 'daily';
  if (input === 'weekdays') return 'Monday,Tuesday,Wednesday,Thursday,Friday';
  if (input === 'weekends') return 'Saturday,Sunday';
  return input.split(/[,\s]+/).map(d => {
    const match = ALL_DAYS.find(day => day.toLowerCase().startsWith(d.toLowerCase()));
    return match || d;
  }).filter(Boolean).join(',');
}

export function isDueToday(routine) {
  if (routine.days === 'daily') return true;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return routine.days.split(',').includes(today);
}

export function formatTodayRoutines(logs) {
  const due = logs.filter(r => isDueToday(r));
  if (!due.length) return 'No routines scheduled for today.';

  const done    = due.filter(r => r.status === 'done');
  const skipped = due.filter(r => r.status === 'skipped');
  const pending = due.filter(r => r.status === 'pending');

  const lines = due.map(r => {
    const icon = r.status === 'done' ? '✅' : r.status === 'skipped' ? '⏭' : '⬜';
    const time = r.time ? ` (${r.time})` : '';
    return `${icon} ${r.emoji} ${r.name}${time}`;
  });

  const summary = `${done.length}/${due.length} done`;
  return `*Today's Routines* — ${summary}\n\n${lines.join('\n')}`;
}

export function formatAllRoutines(routines) {
  if (!routines.length) return 'No routines set up yet.\n\nUse /routine add [name] [time] [days]';
  return '*Your Routines*\n\n' + routines.map((r, i) =>
    `${i + 1}. ${r.emoji} *${r.name}*${r.time ? ' — ' + r.time : ''}  _${r.days === 'daily' ? 'every day' : r.days}_`
  ).join('\n');
}

export function formatStreaks(routines) {
  if (!routines.length) return 'No routines yet.';
  const lines = routines.map(r => {
    const streak = getRoutineStreak(r.id);
    const bar    = streak > 0 ? '🔥'.repeat(Math.min(streak, 7)) : '—';
    return `${r.emoji} *${r.name}*: ${streak} day streak ${bar}`;
  });
  return '*Routine Streaks*\n\n' + lines.join('\n');
}

// Parse natural language reminder time
// Supports: "in 30min", "in 2h", "3pm", "9:30am", "tomorrow 9am"
export function parseReminderTime(input) {
  const now = new Date();
  const lower = input.toLowerCase().trim();

  // "in X min" or "in Xm"
  const minMatch = lower.match(/^in\s+(\d+)\s*(min|m|minutes?)$/);
  if (minMatch) {
    const d = new Date(now.getTime() + parseInt(minMatch[1]) * 60000);
    return d.toISOString();
  }

  // "in X hour" or "in Xh"
  const hrMatch = lower.match(/^in\s+(\d+)\s*(h|hr|hours?)$/);
  if (hrMatch) {
    const d = new Date(now.getTime() + parseInt(hrMatch[1]) * 3600000);
    return d.toISOString();
  }

  // "tomorrow [time]" — recursive: strip "tomorrow" and parse the time part
  const tmrMatch = lower.match(/^tomorrow\s+(.+)$/);
  if (tmrMatch) {
    const iso = parseReminderTime(tmrMatch[1]);
    if (iso) {
      const d = new Date(iso);
      d.setDate(d.getDate() + 1);
      return d.toISOString();
    }
  }

  // "3pm", "9am", "3:30pm", "9:30am"
  const timeMatch = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    let h = parseInt(timeMatch[1]);
    const m = parseInt(timeMatch[2] || '0');
    const ampm = timeMatch[3];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1); // next occurrence if past
    return d.toISOString();
  }

  return null;
}

export function formatReminderTime(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  const diffMin = Math.round((d - now) / 60000);
  if (diffMin < 60) return `in ${diffMin} min`;
  if (diffMin < 1440) return `at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
  return `tomorrow at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
}
