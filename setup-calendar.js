#!/usr/bin/env node
/**
 * One-time Google Calendar OAuth setup.
 * Run: npm run setup:calendar
 *
 * Requirements:
 *   GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 *
 * How to get credentials:
 *   1. Go to console.cloud.google.com
 *   2. Create a project → Enable Google Calendar API
 *   3. OAuth consent screen → External → Add your email as test user
 *   4. Credentials → Create OAuth client ID → Desktop app
 *   5. Copy Client ID and Client Secret into .env
 */
import { google } from 'googleapis';
import { createServer } from 'http';
import { writeFileSync } from 'fs';
import dotenv from 'dotenv';
import { TOKENS_PATH } from './src/paths.js';

dotenv.config();
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('\n❌  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not found in .env\n');
  console.log('Steps:');
  console.log('  1. Go to console.cloud.google.com');
  console.log('  2. Create project → Enable Google Calendar API');
  console.log('  3. OAuth consent → External → add your email as test user');
  console.log('  4. Credentials → Create OAuth client ID → Desktop app');
  console.log('  5. Add to .env:\n     GOOGLE_CLIENT_ID=...\n     GOOGLE_CLIENT_SECRET=...\n');
  process.exit(1);
}

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

console.log('\n📅  Google Calendar Setup\n');
console.log('Opening browser for authorization...');
console.log('If it doesn\'t open, visit this URL:\n');
console.log(authUrl + '\n');

// Try to open browser
try {
  const { default: open } = await import('open');
  await open(authUrl);
} catch {}

// Spin up a local server to catch the OAuth callback
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400); res.end('No code received.'); return;
  }

  try {
    const { tokens } = await auth.getToken(code);
    writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>✅ KBboy connected to Google Calendar!</h2><p>You can close this tab.</p>');

    console.log('\n✅  Tokens saved to tokens.json');
    console.log('Google Calendar is now connected to KBboy.\n');

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500); res.end('Auth failed: ' + err.message);
    console.error('Auth error:', err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(3000, () => {
  console.log('Waiting for authorization on http://localhost:3000...\n');
});
