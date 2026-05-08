import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { MEMORY_DIR } from './paths.js';

export const KNOWN_TOPICS = {
  gym:           ['gym', 'workout', 'lift', 'squat', 'deadlift', 'bench', 'press', 'cardio', 'run', 'leg day', 'push day', 'pull day', 'pr', 'reps', 'sets', 'exercise', 'training', 'protein shake', 'pre-workout', 'gains', 'muscle', 'cut', 'bulk'],
  health:        ['sick', 'pain', 'injury', 'sleep', 'tired', 'fatigue', 'energy', 'doctor', 'medicine', 'symptom', 'knee', 'back', 'shoulder', 'headache', 'ill', 'fever', 'recovery', 'rest', 'sore', 'ache'],
  diet:          ['eat', 'food', 'meal', 'calorie', 'macro', 'protein', 'carb', 'fat', 'hungry', 'lunch', 'dinner', 'breakfast', 'snack', 'diet', 'nutrition', 'cook', 'recipe', 'restaurant', 'cheat meal', 'supplement', 'creatine', 'whey'],
  music:         ['song', 'music', 'listen', 'spotify', 'playlist', 'artist', 'album', 'track', 'vibe', 'bop', 'concert', 'band', 'rap', 'hiphop', 'rnb', 'pop'],
  basketball:    ['basketball', 'nba', 'warriors', 'curry', 'game', 'play', 'court', 'ball', 'hoop', 'shot', 'score', 'dribble', 'pass', 'rebound', 'pickup', 'league'],
  relationship:  ['relationship', 'girlfriend', 'boyfriend', 'date', 'dating', 'love', 'partner', 'friend', 'family', 'mom', 'dad', 'parent', 'girl', 'guy', 'crush', 'breakup', 'drama', 'fight', 'argument'],
  work:          ['work', 'job', 'office', 'meeting', 'boss', 'colleague', 'deadline', 'career', 'email', 'client', 'salary', 'promotion', 'interview', 'slack', 'standup', 'sprint'],
  projects:      ['project', 'build', 'code', 'app', 'side project', 'startup', 'idea', 'launch', 'ship', 'deploy', 'github', 'api', 'feature', 'bug', 'design'],
  mental_health: ['stress', 'anxiety', 'mental', 'mood', 'emotion', 'overwhelm', 'burnout', 'sad', 'happy', 'depressed', 'therapy', 'mindset', 'motivation', 'pressure', 'overthink', 'feel like', 'feeling'],
  skincare:      ['skincare', 'skin', 'moisturizer', 'retinol', 'cleanser', 'sunscreen', 'spf', 'serum', 'acne', 'breakout', 'face wash', 'toner', 'mask', 'routine'],
  dog:           ['buddy', 'dog', 'walk', 'feed', 'vet', 'paw', 'puppy', 'pet', 'leash', 'bark', 'treat', 'grooming'],
  commute:       ['bart', 'muni', 'commute', 'train', 'bus', 'late', 'traffic', 'lyft', 'uber', 'transit', 'station', 'delay', 'walk to work'],
};

export function detectTopic(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const [topic, keywords] of Object.entries(KNOWN_TOPICS)) {
    const score = keywords.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = topic; }
  }

  return bestScore > 0 ? best : null;
}

function topicPath(topic) {
  return join(MEMORY_DIR, `${topic}.md`);
}

export function topicExists(topic) {
  return existsSync(topicPath(topic));
}

export function createTopic(topic) {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  const label = topic.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  writeFileSync(topicPath(topic), `# ${label}\n\n`);
}

export function appendToLog(topic, summary) {
  if (!topicExists(topic)) createTopic(topic);
  const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const entry = `\n## ${ts}\n${summary.trim()}\n`;
  const current = readFileSync(topicPath(topic), 'utf8');
  writeFileSync(topicPath(topic), current + entry);
}

export function readLog(topic, limit = 5) {
  if (!topicExists(topic)) return null;
  const content = readFileSync(topicPath(topic), 'utf8');
  const sections = content.split(/\n## /).filter(s => s.trim() && !s.startsWith('#'));
  const recent = sections.slice(-limit);
  if (!recent.length) return null;
  return recent.map(s => `## ${s.trim()}`).join('\n\n');
}

export function listTopics() {
  if (!existsSync(MEMORY_DIR)) return [];
  return readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
}

export function wipeTopic(topic) {
  if (topicExists(topic)) {
    const label = topic.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    writeFileSync(topicPath(topic), `# ${label}\n\n`);
  }
}
