# Installation Guide

> **Quick Start:** For a faster setup, see [QUICKSTART.md](./QUICKSTART.md)

## Prerequisites

- **Node.js 20+** (not 18 or lower - see upgrade instructions below)
- npm or pnpm
- OpenSSL (for development SSL certificates)
- Ubuntu/Debian or WSL2 (for Linux compatibility)

## Node.js Version Requirements

**⚠️ IMPORTANT:** better-sqlite3 v11+ requires Node.js 20 or higher.

### Check Your Current Version

```bash
node -v
```

### Upgrade Node.js to v20 (Ubuntu/Debian/WSL)

```bash
# Remove old Node.js
sudo apt-get remove -y nodejs npm

# Add NodeSource repository for Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node 20
sudo apt-get install -y nodejs

# Verify installation
node -v  # Should show v20.x.x
npm -v   # Should show v10.x.x
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Install SQLite3 (Required for Persistence)

**Note:** After updating package.json to use zod v3, this should work:

```bash
# Clean install (recommended)
rm -rf node_modules package-lock.json
npm install

# better-sqlite3 and @types/better-sqlite3 are now in package.json
```

If you see dependency conflicts:
```bash
npm install --legacy-peer-deps
```

> **Note:** The application will run with a stub implementation if better-sqlite3 fails to install, but data will not persist.

### 3. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` and configure:

```env
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
GOOGLE_AI_API_KEY=your_gemini_api_key

# Optional (has defaults)
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
SQLITE_DB_PATH=./data
PORT=3001
```

### 4. Get API Keys

#### Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Follow the prompts to create your bot
4. Copy the HTTP API token

#### Google AI API Key (Gemini)

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Get API Key"
3. Create a new project or select existing
4. Copy the API key

### 5. Run Development Server

```bash
npm run dev
```

The server will start on `http://localhost:3001` by default.

### 6. Set Up Telegram Webhook (Production)

For production deployment, you need to set up a webhook:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://caishen.iseethereaper.com/api/telegram/webhook"}'
```

## Database

The application uses SQLite3 for lightweight persistence:

- **Database files**: `./data/users.db`, `./data/transactions.db`
- **Schema**: Auto-initialized on first run
- **WAL mode**: Enabled for better concurrency

### Manual Database Access

```bash
# Install sqlite3 CLI
npm install -g sqlite3

# Access users database
sqlite3 ./data/users.db

# List tables
sqlite> .tables

# View schema
sqlite> .schema users

# Query data
sqlite> SELECT * FROM users;
```

### Backup

```bash
# Create backup
cp ./data/users.db ./data/users.db.backup

# Or use sqlite3
sqlite3 ./data/users.db ".backup ./data/users.db.backup"
```

## Development

### Type Checking

```bash
npm run check
```

### Build Production

```bash
npm run build
npm start
```

## Troubleshooting

### "better-sqlite3 not found"

Install the package:
```bash
npm install better-sqlite3
```

### "Cannot find module '@mysten/sui.js'"

The package should be `@mysten/sui` (unified SDK). Update package.json:
```bash
npm uninstall @mysten/sui.js
npm install @mysten/sui
```

### Telegram webhook not working

1. Check your HTTPS certificate is valid
2. Verify webhook URL is publicly accessible
3. Check Telegram Bot API logs:
```bash
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

## Production Deployment

See `DOCKER_SETUP.md` for Docker deployment instructions.

### Memory Requirements

- **Minimum**: 512MB RAM
- **Recommended**: 1GB RAM
- **With all services**: 2GB RAM (includes nginx, Redis)

### Environment Variables (Production)

```env
NODE_ENV=production
SQLITE_DB_PATH=/data
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
ZKLOGIN_PROVER_URL=https://prover.mystenlabs.com/v1
```
