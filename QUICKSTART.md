# Quick Start Guide

## Local Development (Windows/WSL)

### Option 1: Automated Setup

```bash
# Make script executable
chmod +x setup.sh

# Run setup script (installs dependencies and creates .env)
./setup.sh
```

### Option 2: Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Create .env file
cp .env.example .env

# 3. Edit .env and add your API keys
nano .env

# 4. Run development server
npm run dev
```

## VPS/Production Setup (Ubuntu)

### Upgrade Node.js (if needed) [this has been done]

Your VPS is running Node 18.19.1, but we need Node 20+:

```bash
# Remove old Node.js
sudo apt-get remove -y nodejs npm

# Add NodeSource repository for Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node 20
sudo apt-get install -y nodejs

# Verify
node -v  # Should show v20.x.x
npm -v   # Should show v10.x.x
```

### Install Dependencies

```bash
cd /path/to/my-tiny-project

# Clean install
rm -rf node_modules package-lock.json
npm install

# Or use the setup script
chmod +x setup.sh
./setup.sh
```

## Fixing Common Issues

### Issue: "ERESOLVE could not resolve" (Zod conflict)

**Solution:** Updated package.json to use zod v3 instead of v4

```bash
# Clean install after package.json update
rm -rf node_modules package-lock.json
npm install
```

### Issue: "Unsupported engine" (Node version)

**Solution:** Upgrade to Node 20+

```bash
# On Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node -v
```

### Issue: "Module not found: better-sqlite3"

**Solution:** Install after fixing Node version and zod

```bash
npm install better-sqlite3 @types/better-sqlite3
```

## Development Commands

```bash
# Start development server with hot reload
npm run dev

# Type check only (no compilation)
npm run lint

# Build for production
npm run build

# Run production build
npm start
```

## Environment Variables

Create `.env` file:

```env
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_from_@BotFather
GOOGLE_AI_API_KEY=your_gemini_api_key_from_ai.google.dev

# Optional (has sensible defaults)
PORT=3001
NODE_ENV=development
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
SQLITE_DB_PATH=./data
```

## Verify Installation

```bash
# Check Node version
node -v  # Should be v20.x.x or higher

# Check dependencies
npm list better-sqlite3
npm list @mysten/sui
npm list zod  # Should be v3.x.x

# Test TypeScript compilation
npm run lint

# Start development server
npm run dev
```

## Database Location

- **Local (WSL/Windows)**: `./data/users.db`
- **Docker**: `/data/users.db` (volume mounted)
- **Production VPS**: `/var/lib/ai-copilot/data/users.db` (recommended)

## Next Steps

1. ✅ Fix Node version (v20+)
2. ✅ Fix package.json dependencies
3. ✅ Install dependencies
4. ⏳ Configure .env with API keys
5. ⏳ Test with `npm run dev`
6. ⏳ Set up Telegram webhook (production only)

## Troubleshooting

### WSL-specific issues

If you see permission errors in WSL:

```bash
# Fix permissions
sudo chown -R $USER:$USER ./data
chmod -R 755 ./data
```

### VPS-specific issues

If SQLite3 native module fails to build:

```bash
# Install build tools
sudo apt-get update
sudo apt-get install -y build-essential python3

# Rebuild
npm rebuild better-sqlite3
```

### Port already in use

```bash
# Find process using port 3001
lsof -i :3001  # Linux/Mac
netstat -ano | findstr :3001  # Windows

# Kill the process or change PORT in .env
```

## Docker Deployment

For full Docker setup, see `DOCKER_SETUP.md`

```bash
# Quick Docker start
docker-compose up -d

# View logs
docker-compose logs -f
```
