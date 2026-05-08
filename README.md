# KBboy

Your personal life assistant Telegram bot — powered by Claude AI.

KBboy knows your routines, reads your Google Calendar, remembers your conversations across topics, texts you proactively, reads photos you send, and replies with voice. Personality inspired by TARS from *Interstellar* with a 28-year-old Asian voice and an adjustable humor dial.

---

## What KBboy Does

### Proactive — texts you without being asked
KBboy messages you throughout the day on a schedule:

| Time | Message |
|---|---|
| 7:00 AM | Morning brief — gym, commute, Buddy, calendar, important dates |
| 7:05 AM | Buddy breakfast reminder |
| 8:20 AM | Leave for work reminder (work days only) |
| 12:30 PM | Buddy midday walk |
| 12:00 / 16:00 | Random check-in, hot take, or cultural reference |
| Routine time | Nudge if routine is still pending at its scheduled time |
| Pre-event (1hr) | Calendar event heads up |
| 6:00 PM | Buddy dinner |
| 6:30 PM | Gym check-in (gym days only) |
| 7:00 PM | Buddy evening walk |
| 8:00 PM | Tomorrow preview + important date alerts (within 5 days) |
| 9:00 PM | Evening skincare reminder |
| 10:30 PM | Wind down + sleep nudge |
| Sunday 8:00 PM | Weekly report card |
| Any time | Reminder fires at the exact minute you set it |

All messages respect your **sleep window** (default 11 PM–7 AM) and a **daily message cap** (default 10/day). Reminders and routine nudges bypass the daily cap — they're intentional.

### Reactive — answers anything
- Ask about your day, routines, calendar, diet, gym, skincare, commute, dog
- Send a photo — KBboy sees it and reacts in his voice
- Full conversation history (last 20 turns) gives context to every reply
- Long-term topic memory means he remembers things across days and weeks

### Routines — track daily habits
Set up recurring habits with optional times and day schedules. KBboy nudges you when it's time and tracks your streak.

```
/routine                        → today's status with tap-to-mark buttons
/routine add 🏋 Gym 06:30 weekdays
/routine add 💊 Vitamins        → daily, no time
/routine done Gym               → mark done by name
/routine skip Vitamins          → mark skipped
/routine streak                 → 🔥 streak counts
/routine all                    → full list
/routine remove Gym             → delete
```

### Reminders — one-shot push notifications
Natural language time parsing, fires to the minute:

```
/remind in 30min take meds
/remind 9pm call mom
/remind tomorrow 9am dentist appointment
/remind in 2h check oven
```

### Memory — knows your history
Every conversation is classified by topic and summarised into a persistent log:

| Topic | What gets logged |
|---|---|
| `gym` | PRs, injuries, skipped days, consistency |
| `health` | Sleep, energy, pain, illness |
| `diet` | Meals, macros, how you feel after eating |
| `music` | Songs, playlists, moods |
| `basketball` | Games, performance, scores |
| `relationship` | Important moments, dates, dynamics |
| `work` | Projects, blockers, wins, deadlines |
| `projects` | Side projects, ideas, build progress |
| `mental_health` | Stress, mood patterns, reflective thoughts |
| `skincare` | Routine consistency, product reactions |
| `dog` | Buddy's habits, vet visits, notes |
| `commute` | Route changes, delays |
| New topic | Auto-detected and created on the fly |

KBboy references these logs naturally: *"You mentioned knee pain two weeks ago — how's it feeling?"*

---

## Personality

KBboy is not a generic assistant. He has a distinct voice:

- **28-year-old Asian (HK background)** — casual English with Cantonese flair (`la`, `wah`, `aiya`, `ah`)
- **TARS-inspired humor dial** — adjustable from 0 (dead serious) to 100 (full cinematic chaos)
- **Interstellar references** — woven naturally when relevant, never forced
- **Cultural depth** — NBA, HK food, gym culture, skincare, anime, memes
- **Calls things out** — doesn't just validate everything, has opinions
- **Remembers your wins** — celebrates without being cringe about it
- **No filler phrases** — never says "Great question!" or "Certainly!"

### Humor dial examples

Same message ("you skipped gym") at different levels:

| Level | Response |
|---|---|
| 0 | *"Gym session missed. Reschedule tomorrow."* |
| 25 | *"No gym today. Worth making up tomorrow."* |
| 50 | *"Skipped gym la. Don't make it a habit."* |
| 75 *(default)* | *"Oh interesting. You skipped gym. Bold choice Marco. Very brave."* |
| 100 | *"Spectacular. Truly. Cooper crossed a black hole, Mann betrayed his crew, Brand flew to Edmunds' planet alone — and you couldn't make it to Equinox. History will remember this day."* |

---

## Setup

### 1. Prerequisites

- Node.js 22+
- A Telegram account
- An Anthropic API key — [console.anthropic.com](https://console.anthropic.com)

### 2. Get your Telegram credentials

**Bot token** — message [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts

**Your user ID** — message [@userinfobot](https://t.me/userinfobot) → it replies with your numeric ID

### 3. Environment variables

Copy `.env.example` to `.env` and fill in:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=          # from @BotFather
TELEGRAM_ALLOWED_ID=         # from @userinfobot (numeric)

# Railway persistent storage
DATA_DIR=/data               # set this in Railway, leave blank for local

# Optional — enables voice replies
OPENAI_API_KEY=              # from platform.openai.com

# Optional — enables Google Calendar
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### 4. Run locally

```bash
npm install
npm run dev
```

Then message your bot `/start` on Telegram.

### 5. Deploy to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → select this repo
3. In your service → **Variables** tab — add all env vars from above, plus `DATA_DIR=/data`
4. In your service → **Volumes** tab → **Add Volume** → mount path: `/data`
5. Railway deploys automatically

The persistent volume at `/data` stores:
```
/data/
  kbboy.db       ← conversation history, routines, reminders, settings
  config.json    ← your profile (written during onboarding)
  tokens.json    ← Google Calendar tokens
  memory/
    gym.md
    health.md
    diet.md
    ... (auto-created per topic)
```

Everything survives redeployments. The only risk is deleting the Railway service itself — use `/backup` to get a copy of your memory logs anytime.

---

## Google Calendar (optional)

Connects KBboy to your real live calendar instead of a static JSON file.

**Setup:**

```bash
# Add to .env first:
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...

npm run setup:calendar
```

This opens your browser, you authorize the app, tokens are saved to `tokens.json` (gitignored). The bot auto-refreshes tokens silently.

**How to get credentials:**
1. [console.cloud.google.com](https://console.cloud.google.com) → Create project
2. Enable **Google Calendar API**
3. OAuth consent screen → External → add your Gmail as test user
4. Credentials → Create OAuth client ID → **Desktop app**
5. Copy Client ID and Client Secret to `.env`

---

## Voice Replies (optional)

KBboy can send audio voice messages using OpenAI TTS (`nova` voice — young, natural, 1.05x speed).

**Setup:**
1. Add `OPENAI_API_KEY` to Railway env vars
2. Message the bot: `/voice on`

Voice is automatically stripped of markdown before synthesis. Responses longer than 500 characters are truncated for audio. Text reply is always sent alongside the voice message.

---

## Commands

| Command | What it does |
|---|---|
| `/start` | Begin onboarding (first time only) |
| `/help` | Show all commands |
| **Routines** | |
| `/routine` | Today's status with quick tap buttons |
| `/routine add [emoji] name [HH:MM] [days]` | Add a routine |
| `/routine done [name]` | Mark a routine done |
| `/routine skip [name]` | Mark a routine skipped |
| `/routine streak` | Streak counts per routine |
| `/routine all` | All routines and their schedules |
| `/routine remove [name]` | Delete a routine |
| **Reminders** | |
| `/remind [time] [message]` | One-shot reminder (fires to the minute) |
| **Settings** | |
| `/humor [0-100]` | Adjust humor dial |
| `/voice on\|off` | Toggle voice replies (needs `OPENAI_API_KEY`) |
| `/quiet [Xh]` | Quiet mode for X hours |
| `/dnd` | Do not disturb until 7 AM tomorrow |
| `/pause` | Pause all proactive messages |
| `/resume` | Resume proactive messages |
| `/sleep HH:MM HH:MM` | Update sleep window |
| `/mute buddy [Xh]` | Pause dog reminders |
| `/timezone [city]` | Update your timezone |
| `/update` | Re-run onboarding to change your settings |
| **Info** | |
| `/today` | Regenerate today's brief |
| `/calendar` | Show events for next 14 days |
| `/report` | Weekly report card with grades |
| `/memory` | List all active topic logs |
| `/backup` | DM yourself all memory logs |
| `/forget [topic]` | Wipe a topic log (fresh start) |

---

## How It All Works

```
Your message (text or photo)
        ↓
Telegram Bot API
        ↓
telegram.js — routes message type
        ↓
src/claude.js — builds system prompt:
  ├── kbboy-persona.md     (personality + humor level)
  ├── today's context      (date, gym day, work day)
  ├── your profile         (config.json)
  ├── calendar events      (Google Calendar or local)
  ├── important dates      (next 30 days)
  ├── topic memory log     (last 5 entries for detected topic)
  └── conversation history (last 20 turns from SQLite)
        ↓
Claude API (Sonnet for chat/images, Haiku for proactive messages)
        ↓
Reply sent as text + optional voice message
        ↓
Conversation saved to SQLite
Topic summary saved to memory/[topic].md
```

### Memory system (3-tier)

| Tier | What | Storage |
|---|---|---|
| Working memory | Last 20 conversation turns | SQLite `messages` table |
| Topic logs | Summaries of past conversations by topic | `memory/[topic].md` files |
| Config | Your profile, routines, preferences | `config.json` |

Topic detection uses keyword matching across 13 built-in topics. New topics are auto-detected and created when you talk about something new.

### Routine + reminder system

| Component | How it works |
|---|---|
| Routines | Stored in SQLite with name, emoji, time, days schedule |
| Completion | Logged per day as done / skipped / pending |
| Streaks | Counted backward from today through consecutive done days |
| Nudges | Cron checks every minute — fires at exact routine time if still pending |
| Reminders | Stored with ISO fire_at timestamp, poller fires within 1 minute |
| Quick buttons | `/routine` shows Telegram inline keyboard for one-tap check-off |

---

## Known Limitations

- **Timezone:** The server runs in UTC (Railway default). All scheduled messages and reminder times are interpreted in UTC, not your local timezone. If you're in HK (+8), set times 8 hours earlier than you actually want them. A proper timezone offset fix is planned.
- **Streak counter:** Only accurate for daily routines. Routines scheduled on specific days (e.g. Mon/Wed/Fri) will show streak=0 due to the gap between log dates. Fix planned.
- **Cron times are fixed at startup:** Changing your morning brief time or dog feeding schedule via `/update` requires restarting the Railway service to take effect. Settings like humor level, sleep window, quiet mode, and pause update instantly.

---

## File Structure

```
kbboy/
├── telegram.js          main bot — message routing, photo/voice, inline buttons
├── setup-calendar.js    one-time Google Calendar OAuth
├── kbboy-persona.md     KBboy's personality, voice, and humor examples
├── railway.json         Railway deployment config
├── nixpacks.toml        Node.js build config
├── .env.example         env var template
└── src/
    ├── paths.js         DATA_DIR abstraction (local vs Railway)
    ├── db.js            SQLite via node:sqlite — all tables and queries
    ├── routines.js      routine formatting, day parsing, reminder time parsing
    ├── memory.js        topic log read/write + keyword detection
    ├── gcal.js          Google Calendar API wrapper
    ├── claude.js        AI brain — chat, vision, proactive, memory summary
    ├── voice.js         OpenAI TTS → Telegram voice message
    ├── onboarding.js    conversational setup flow
    ├── scheduler.js     node-cron proactive + reminder poller + routine nudges
    └── commands.js      all /command handlers
```

---

## Cost estimate (personal use)

| Service | Plan | Est. cost |
|---|---|---|
| Railway | Hobby | ~$5/month |
| Telegram Bot API | Free | $0 |
| Google Calendar API | Free tier | $0 |
| Claude API (Sonnet + Haiku) | Pay per use | ~$10–15/month |
| OpenAI TTS | Pay per use | ~$1–3/month |
| **Total** | | **~$16–23/month** |

Claude API breakdown: ~30 conversations/day × 30 days, ~3k tokens input + ~500 tokens output per message. Proactive messages use the cheaper Haiku model.

---

## Multi-User Readiness

KBboy is currently **single-user** by design (one `TELEGRAM_ALLOWED_ID`, one database, one config). The architecture needed to support multiple users is documented here for when that work begins:

**What needs to change:**

| Component | Current | Multi-user |
|---|---|---|
| Auth | One hardcoded `TELEGRAM_ALLOWED_ID` | Allowlist table in DB, admin-managed |
| Database tables | No `user_id` column | Add `chat_id` to messages, routines, routine_logs, reminders, state |
| Config | Single `config.json` | Per-user `config/{chat_id}.json` or users table |
| Memory logs | `memory/gym.md` | `memory/{chat_id}/gym.md` |
| Google Calendar | Single `tokens.json` | Per-user token storage |
| Scheduler | One `setupScheduler(bot, chatId)` call | One scheduler per active user |
| State keys | Flat: `humor_level`, `paused` | Namespaced: `{chatId}:humor_level` or user_id foreign key |

The SQLite schema is the deepest refactor — every query needs a `WHERE chat_id = ?` clause added. Everything else is relatively mechanical once that's done.
