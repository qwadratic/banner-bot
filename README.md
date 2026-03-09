# Banner Bot

Telegram bot built with TypeScript and [mtcute](https://mtcute.dev).

## Setup

1. Copy `.env.example` to `.env` and fill in the values:
   - `BOT_TOKEN` — from [@BotFather](https://t.me/BotFather)
   - `API_ID` / `API_HASH` — from [my.telegram.org/apps](https://my.telegram.org/apps)
   - `DEV_TG_ID` — your Telegram user ID
   - `OPENROUTER_API_KEY` — from [OpenRouter](https://openrouter.ai)

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Run with pm2 (recommended for auto-restart):
   ```bash
   pm2 start npm --name banner-bot -- run start
   ```

   Or run directly:
   ```bash
   npm start
   ```

## Process Manager

The bot uses `process.exit(0)` for restart/update commands. A process manager that restarts on exit code `0` is required for these features to work.

Recommended: [pm2](https://pm2.keymetrics.io/)

```bash
npm install -g pm2
pm2 start npm --name banner-bot -- run start
pm2 save
```

## Dev Harness

Send any message to the bot from the `DEV_TG_ID` account to access the dev panel with:

- **Status** — uptime, Node version, env var checks
- **Health check** — tests all configured AI models via OpenRouter
- **Restart** — restarts the bot process
- **Update & restart** — git pull + npm install + restart
- **User mode** — interact with the bot as a normal user
