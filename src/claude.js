import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { PERSONA_PATH } from './paths.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function loadPersona() {
  const p = PERSONA_PATH;
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

function humorDescription(level) {
  if (level === 0)       return 'Zero humor. Pure signal. Facts and action only. No jokes, no personality, just answers.';
  if (level <= 25)       return 'Mostly serious. Occasional dry wit, nothing forced.';
  if (level <= 50)       return 'Balanced. Warm, direct, light personality.';
  if (level <= 75)       return 'Default KBboy. Playful, dry roasts, calls things out with flair. Interstellar refs when relevant.';
  if (level < 100)       return 'High energy. Frequent humor, bold observations, more cultural references.';
  return 'Full TARS mode. Maximally entertaining. Cinematic roasts, Interstellar references everywhere, still helpful but unhinged.';
}

function buildSystemPrompt(config, humorLevel, contextBlock) {
  const persona = loadPersona();
  return `${persona}

---

HUMOR SETTING: ${humorLevel}/100
${humorDescription(humorLevel)}

---

${contextBlock}

---

RULES:
- Never say "Great question", "Certainly", "Of course", "As an AI", "I'd be happy to help"
- Always address Marco by name occasionally, not every message
- Keep responses tight — no padding, no filler
- Use Cantonese flair naturally (la, wah, aiya, ah) — don't force it
- Health/medical suggestions always framed as suggestions, not facts
- End serious topics with warmth, not a lecture
`.trim();
}

function buildContextBlock(config, todayEvents, upcomingEvents, upcomingDates, topicLog, topicName) {
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const gymDay = config.gym?.schedule?.includes(dayName) ?? false;
  const workDay = config.commute?.workDays?.includes(dayName) ?? false;

  const eventsStr = todayEvents.length
    ? todayEvents.map(e => `  ${e.time}: ${e.title}${e.location ? ' @ ' + e.location : ''}${e.notes ? ' — ' + e.notes : ''}`).join('\n')
    : '  None';

  const upcomingStr = upcomingEvents.length
    ? upcomingEvents.map(e => `  ${e.time} ${e.start?.split('T')[0] || ''}: ${e.title}`).join('\n')
    : '  None';

  const datesStr = upcomingDates.length
    ? upcomingDates.map(d => `  ${d.label} — in ${d.daysUntil} day(s)`).join('\n')
    : '  None';

  const memorySection = topicLog
    ? `\nMEMORY — ${(topicName || '').toUpperCase()}:\n${topicLog}`
    : '';

  return `TODAY: ${dayName}, ${dateStr} at ${timeStr}
GYM DAY: ${gymDay ? 'Yes (' + (config.gym?.currentSplit || '') + ')' : 'Rest day'}
WORK DAY: ${workDay ? 'Yes — leave by ' + (config.commute?.targetDepartureTime || '8:30') : 'No'}

PROFILE:
  Name: ${config.profile?.name || 'Marco'}
  Dog: ${config.profile?.dog?.name || 'Buddy'} (${config.profile?.dog?.breed || ''})
  Feed times: ${config.profile?.dog?.feedingTimes?.join(', ') || '7:00, 18:00'}
  Walk times: ${config.profile?.dog?.walkTimes?.join(', ') || '7:30, 12:30, 19:00'}

TODAY'S CALENDAR:
${eventsStr}

UPCOMING (7 days):
${upcomingStr}

IMPORTANT DATES (next 30 days):
${datesStr}

GYM: ${config.gym?.schedule?.join(', ') || 'Mon/Wed/Fri'} | Goals: ${config.gym?.goals || ''}
DIET: ${config.diet?.goals || ''} | Target: ${config.diet?.targetCalories || 2200} kcal / ${config.diet?.targetProteinG || 160}g protein
SUPPLEMENTS: ${config.diet?.supplements?.join(', ') || ''}
SKINCARE AM: ${config.skincare?.morningRoutine?.join(' → ') || ''}
SKINCARE PM: ${config.skincare?.eveningRoutine?.join(' → ') || ''}
COMMUTE: ${config.commute?.method || ''} | Leave: ${config.commute?.targetDepartureTime || '8:30'}${memorySection}`.trim();
}

export async function chat({ userMessage, history, config, humorLevel, todayEvents, upcomingEvents, upcomingDates, topicLog, topicName }) {
  const contextBlock = buildContextBlock(config, todayEvents, upcomingEvents, upcomingDates, topicLog, topicName);
  const systemPrompt = buildSystemPrompt(config, humorLevel, contextBlock);

  const messages = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  return response.content[0].text;
}

export async function generateProactiveMessage({ type, config, humorLevel, todayEvents, upcomingEvents, upcomingDates, extra = '' }) {
  const contextBlock = buildContextBlock(config, todayEvents, upcomingEvents, upcomingDates, null, null);
  const systemPrompt = buildSystemPrompt(config, humorLevel, contextBlock);

  const prompts = {
    morning_brief:     'Give Marco a sharp, personalized morning brief. Top 3 things he needs to know or do today. Keep it punchy. Max 5 lines.',
    buddy_breakfast:   'Send a quick reminder that Buddy needs breakfast. One or two lines max. KBboy voice.',
    buddy_lunch_walk:  'Remind Marco about Buddy\'s midday walk. One line. Maybe a light comment.',
    buddy_dinner:      'Buddy\'s dinner time reminder. One line.',
    buddy_evening_walk:'Buddy\'s evening walk time. One line.',
    leave_for_work:    `It's almost time to leave for work. Check BART status. Remind Marco to leave by ${config.commute?.targetDepartureTime}. Two lines max.`,
    gym_checkin:       'Check in with Marco after his gym session today. Ask how it went. One or two lines. Keep it casual.',
    skincare_pm:       'Remind Marco about his evening skincare routine. One line. Low-key.',
    wind_down:         'Send Marco a wind-down message for the night. Acknowledge the day. Nudge him toward sleep. Max 3 lines.',
    tomorrow_preview:  `Give Marco a quick heads up about tomorrow. Check his calendar and routines. Two to three lines max.`,
    weekly_report:     'Generate Marco\'s weekly report card with grades (A/B/C/D) for: Gym, Diet, Sleep, Skincare, Buddy care, Work. Be honest and specific. Reference what you know from context. Keep it tight and real.',
    random_checkin:    `Send a spontaneous check-in message. Could be a hot take, a question, an observation about his week, a cultural reference, or just vibes. Keep it short and natural. ${extra}`,
    pre_event:         `Marco has an upcoming event. ${extra} Give him a quick heads up. Practical info, max 2 lines.`,
    important_date:    `${extra} Give Marco a reminder about this. If it's a birthday or anniversary, suggest something practical. Two lines max.`,
  };

  const userPrompt = prompts[type] || prompts.random_checkin;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text;
}

export async function summariseForMemory({ userMessage, botResponse, topic }) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    system: 'Summarise the following conversation exchange into one or two factual sentences for a memory log. Be specific. No fluff.',
    messages: [{
      role: 'user',
      content: `Topic: ${topic}\nUser: ${userMessage}\nAssistant: ${botResponse}`,
    }],
  });

  return response.content[0].text.trim();
}

export async function onboardingChat({ history, systemContext }) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `You are KBboy, a personal AI assistant onboarding a new user named Marco (or whatever name they give).
Your job is to collect setup information through natural conversation.
Be warm, casual, direct — KBboy voice. Use light Cantonese flair when it fits.
Ask one or two questions at a time. Never list all questions at once.
When the user gives you an answer, confirm it briefly and move to the next topic.

Current setup state:
${systemContext}`,
    messages: history,
  });

  return response.content[0].text;
}

export async function chatWithImage({ imageBase64, mimeType = 'image/jpeg', caption, history, config, humorLevel, todayEvents, upcomingEvents, upcomingDates }) {
  const contextBlock = buildContextBlock(config, todayEvents, upcomingEvents, upcomingDates, null, null);
  const systemPrompt = buildSystemPrompt(config, humorLevel, contextBlock);

  const messages = [
    ...history,
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imageBase64 },
        },
        {
          type: 'text',
          text: caption || 'What do you see? React in KBboy voice.',
        },
      ],
    },
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  return response.content[0].text;
}

export { buildContextBlock, buildSystemPrompt };
