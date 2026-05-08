import { getState, setState } from './db.js';
import { onboardingChat } from './claude.js';
import { writeFileSync } from 'fs';
import { CONFIG_PATH } from './paths.js';

// Ordered onboarding steps — each step collects one piece of config
const STEPS = [
  { key: 'name',             prompt: 'intro',         configPath: 'profile.name' },
  { key: 'age',              prompt: 'age',            configPath: 'profile.age' },
  { key: 'city',             prompt: 'city',           configPath: 'profile.timezone' },
  { key: 'work_days',        prompt: 'work_days',      configPath: 'commute.workDays' },
  { key: 'commute',          prompt: 'commute',        configPath: 'commute.method' },
  { key: 'leave_time',       prompt: 'leave_time',     configPath: 'commute.targetDepartureTime' },
  { key: 'gym_days',         prompt: 'gym_days',       configPath: 'gym.schedule' },
  { key: 'gym_goals',        prompt: 'gym_goals',      configPath: 'gym.goals' },
  { key: 'diet_goals',       prompt: 'diet_goals',     configPath: 'diet.goals' },
  { key: 'supplements',      prompt: 'supplements',    configPath: 'diet.supplements' },
  { key: 'skincare_am',      prompt: 'skincare_am',    configPath: 'skincare.morningRoutine' },
  { key: 'skincare_pm',      prompt: 'skincare_pm',    configPath: 'skincare.eveningRoutine' },
  { key: 'has_dog',          prompt: 'has_dog',        configPath: 'profile.hasDog' },
  { key: 'dog_info',         prompt: 'dog_info',       configPath: 'profile.dog', conditional: data => data.has_dog === true },
  { key: 'important_dates',  prompt: 'important_dates',configPath: 'importantDates' },
  { key: 'interests',        prompt: 'interests',      configPath: 'profile.interests' },
  { key: 'brief_time',       prompt: 'brief_time',     configPath: 'morningBriefTime' },
  { key: 'humor_level',      prompt: 'humor_level',    configPath: 'kbboy.humorLevel' },
  { key: 'sensitive_topics', prompt: 'sensitive',      configPath: 'kbboy.sensitiveTopics' },
];

function stepContext(data) {
  const done = Object.keys(data).filter(k => k !== 'step');
  const remaining = STEPS.filter(s => !done.includes(s.key) && (!s.conditional || s.conditional(data)));
  return `Collected so far: ${JSON.stringify(data, null, 2)}\nRemaining to collect: ${remaining.map(s => s.key).join(', ')}`;
}

function nextStep(data) {
  return STEPS.find(s => {
    if (data[s.key] !== undefined) return false;
    if (s.conditional && !s.conditional(data)) return false;
    return true;
  });
}

function stepSystemHint(step) {
  const hints = {
    intro:          "Introduce yourself as KBboy and ask for their name. Warm, casual, KBboy voice.",
    age:            "Ask how old they are.",
    city:           "Ask what city/timezone they're in — explain you need it for scheduling.",
    work_days:      "Ask which days they work.",
    commute:        "Ask how they commute to work (transit, drive, walk, WFH).",
    leave_time:     "Ask what time they usually leave for work.",
    gym_days:       "Ask which days they go to the gym. If they don't gym, that's fine — note it.",
    gym_goals:      "Ask what their fitness goals are. Keep it casual.",
    diet_goals:     "Ask about diet goals or restrictions.",
    supplements:    "Ask if they take any supplements.",
    skincare_am:    "Ask about their morning skincare steps. Keep the vibe chill.",
    skincare_pm:    "Ask about their evening skincare routine.",
    has_dog:        "Ask if they have a dog.",
    dog_info:       "Ask for the dog's name, breed, and feeding/walk schedule.",
    important_dates:"Ask about important dates to remember — birthdays, anniversaries, etc.",
    interests:      "Ask what they're into — basketball, music, etc.",
    brief_time:     "Ask what time they want their morning brief.",
    humor_level:    "Tell them KBboy has an adjustable humor dial from 0 (dead serious) to 100 (full TARS chaos). Ask where they want to set it.",
    sensitive:      "Ask if they want KBboy to track sensitive topics like mental health and relationships — explain these stay extra private.",
  };
  return hints[step?.prompt] || 'Continue the onboarding naturally.';
}

export function isOnboardingDone() {
  return getState('onboarded', false) === true;
}

export async function handleOnboarding(userText, history) {
  const data = getState('onboarding_data', {});
  const step = nextStep(data);

  if (!step) {
    return finalise(data);
  }

  const context = `${stepContext(data)}\n\nCurrent step to collect: ${step.key}\nHint: ${stepSystemHint(step)}`;

  // Attempt to extract answer from user text if we have a previous step
  if (history.length > 1 && userText) {
    const extracted = await extractAnswer(step.key, userText, data);
    if (extracted !== null) {
      data[step.key] = extracted;
      setState('onboarding_data', data);

      // Check if all done after saving
      const nextS = nextStep(data);
      if (!nextS) {
        return finalise(data);
      }
    }
  }

  const updatedContext = `${stepContext(data)}\n\nNext to collect: ${nextStep(data)?.key || 'done'}\nHint: ${stepSystemHint(nextStep(data))}`;

  const messages = history.length === 0
    ? [{ role: 'user', content: 'Hi, I want to set up KBboy.' }]
    : [...history, { role: 'user', content: userText }];

  const reply = await onboardingChat({ history: messages, systemContext: updatedContext });
  return { reply, done: false };
}

async function extractAnswer(stepKey, text, data) {
  // Simple extraction heuristics — no extra API call
  const lower = text.toLowerCase().trim();

  if (stepKey === 'has_dog') {
    if (/yes|yeah|yep|i do|got (a |one)|have (a |one)|his name|her name/i.test(lower)) return true;
    if (/no|nope|don't|don't|nah/i.test(lower)) return false;
    return null;
  }

  if (stepKey === 'humor_level') {
    const n = parseInt(lower.match(/\d+/)?.[0]);
    if (!isNaN(n)) return Math.max(0, Math.min(100, n));
    if (/max|full|chaos|100/i.test(lower)) return 100;
    if (/default|normal|75/i.test(lower)) return 75;
    return null;
  }

  if (stepKey === 'work_days') {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const found = days.filter(d => lower.includes(d.toLowerCase()));
    if (found.length) return found;
    if (/mon.*(fri|fri)/i.test(lower) || /weekday/i.test(lower)) return ['Monday','Tuesday','Wednesday','Thursday','Friday'];
    return null;
  }

  if (stepKey === 'gym_days') {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const found = days.filter(d => lower.includes(d.toLowerCase()));
    if (found.length) return found;
    if (/don't|dont|not|skip|none|no gym/i.test(lower)) return [];
    return null;
  }

  if (stepKey === 'sensitive_topics') {
    if (/yes|yeah|sure|track|go ahead/i.test(lower)) return ['mental_health', 'relationship'];
    if (/no|nope|nah|skip/i.test(lower)) return [];
    return null;
  }

  // For free-text fields, accept whatever they typed if it's substantive
  if (text.length > 2) return text.trim();

  return null;
}

async function finalise(data) {
  // Build and write config.json from collected data
  const config = buildConfig(data);
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  setState('onboarded', true);
  setState('humor_level', data.humor_level ?? 75);

  return {
    reply: `Aight ${data.name || 'Marco'}, you're all set up. KBboy is live 🤙\n\nHumor: ${data.humor_level ?? 75}/100. Morning brief at ${data.brief_time || '7:00 AM'}.\n\nType anything to start, or /help to see what I can do.`,
    done: true,
  };
}

function buildConfig(data) {
  const dogDefault = {
    name: 'Buddy',
    breed: 'Dog',
    age: 2,
    feedingTimes: ['07:00', '18:00'],
    walkTimes: ['07:30', '12:30', '19:00'],
    notes: 'Grain-free kibble',
  };

  return {
    profile: {
      name: data.name || 'Marco',
      age: data.age || 28,
      timezone: cityToTimezone(data.city || 'San Francisco'),
      hasDog: data.has_dog ?? false,
      interests: data.interests || '',
      dog: data.has_dog ? parseDogInfo(data.dog_info) : dogDefault,
    },
    importantDates: parseImportantDates(data.important_dates),
    gym: {
      schedule: data.gym_days || [],
      goals: data.gym_goals || '',
      currentSplit: 'Push/Pull/Legs',
      notes: '',
    },
    diet: {
      goals: data.diet_goals || '',
      targetCalories: 2200,
      targetProteinG: 160,
      restrictions: [],
      supplements: parseList(data.supplements),
    },
    skincare: {
      morningRoutine: parseList(data.skincare_am),
      eveningRoutine: parseList(data.skincare_pm),
      weeklyTreatments: [],
      notes: '',
    },
    commute: {
      home: data.city || '',
      work: '',
      method: data.commute || '',
      workDays: data.work_days || ['Monday','Tuesday','Wednesday','Thursday','Friday'],
      targetDepartureTime: data.leave_time || '08:30',
      targetArrivalTime: '',
      notes: '',
    },
    morningBriefTime: data.brief_time || '07:00',
    eveningBriefTime: '20:00',
    kbboy: {
      humorLevel: data.humor_level ?? 75,
      sensitiveTopics: data.sensitive_topics ?? [],
      sleepStart: '23:00',
      sleepEnd: '07:00',
      maxMessagesPerDay: 10,
      randomMessageDays: ['Monday','Wednesday','Friday','Saturday','Sunday'],
    },
  };
}

function cityToTimezone(city) {
  const map = {
    'san francisco': 'America/Los_Angeles',
    'los angeles': 'America/Los_Angeles',
    'new york': 'America/New_York',
    'chicago': 'America/Chicago',
    'hong kong': 'Asia/Hong_Kong',
    'london': 'Europe/London',
    'toronto': 'America/Toronto',
    'vancouver': 'America/Vancouver',
    'sydney': 'Australia/Sydney',
    'singapore': 'Asia/Singapore',
    'tokyo': 'Asia/Tokyo',
  };
  const key = city.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (key.includes(k)) return v;
  }
  return 'America/Los_Angeles';
}

function parseList(text) {
  if (!text) return [];
  if (Array.isArray(text)) return text;
  return text.split(/[,\n;]/).map(s => s.trim()).filter(Boolean);
}

function parseDogInfo(text) {
  if (!text || typeof text !== 'string') return {
    name: 'Buddy', breed: 'Dog', age: 2,
    feedingTimes: ['07:00','18:00'], walkTimes: ['07:30','12:30','19:00'], notes: '',
  };
  return { name: text, breed: 'Dog', age: 2, feedingTimes: ['07:00','18:00'], walkTimes: ['07:30','12:30','19:00'], notes: text };
}

function parseImportantDates(text) {
  if (!text || typeof text !== 'string') return [];
  // Return raw for now — advanced parsing would need NLP
  return [{ label: text, month: 1, day: 1, recurring: true }];
}
