import { google } from 'googleapis';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { TOKENS_PATH } from './paths.js';

function getAuth() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  if (!existsSync(TOKENS_PATH)) return null;

  const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/callback'
  );
  auth.setCredentials(tokens);

  auth.on('tokens', (refreshed) => {
    const merged = { ...tokens, ...refreshed };
    writeFileSync(TOKENS_PATH, JSON.stringify(merged, null, 2));
  });

  return auth;
}

export function isAuthenticated() {
  return !!getAuth();
}

export async function getTodayEvents() {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const cal = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end   = new Date(now); end.setHours(23, 59, 59, 999);

    const res = await cal.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map(formatEvent);
  } catch {
    return [];
  }
}

export async function getUpcomingEvents(days = 7) {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const cal = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const end = new Date(); end.setDate(end.getDate() + days);

    const res = await cal.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });

    return (res.data.items || []).map(formatEvent);
  } catch {
    return [];
  }
}

export async function getEventsAroundTime(isoTime, windowMinutes = 60) {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const cal = google.calendar({ version: 'v3', auth });
    const center = new Date(isoTime);
    const start = new Date(center.getTime() - windowMinutes * 60000);
    const end   = new Date(center.getTime() + windowMinutes * 60000);

    const res = await cal.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map(formatEvent);
  } catch {
    return [];
  }
}

function formatEvent(e) {
  const start = e.start?.dateTime || e.start?.date || '';
  const end   = e.end?.dateTime   || e.end?.date   || '';
  return {
    title:    e.summary || 'Untitled',
    start,
    end,
    location: e.location || null,
    notes:    e.description || null,
    allDay:   !e.start?.dateTime,
    time:     start ? new Date(start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'All day',
  };
}
