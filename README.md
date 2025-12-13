# Caishen - AI Copilot Wallet for Sui

> **Status:** Active Development | **Version:** 0.4.1  
> **Deployed:** caishen.iseethereaper.com

A Telegram-first AI wallet assistant for the Sui blockchain with zkLogin (Google OAuth), Slush/Wallet Standard support, AI-driven natural language intents, and a React-based signing web dApp.

---

## 🚀 Quick Start

### Prerequisites
- **Python 3.11+** (bot backend)
- **Node.js 20+** (web dApp)
- **PostgreSQL 16** (database)
- **Docker** (recommended for deployment)

### Local Development

```bash
# 1. Bot (Python/aiogram)
cd bot
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env  # Configure: TELEGRAM_BOT_TOKEN, POSTGRES_*, GEMINI_API_KEY
python -m src.bot.bot

# 2. Web dApp (React/Vite)
cd services/web-dapp
npm install
cp .env.example .env  # Configure: VITE_API_BASE_URL, VITE_GOOGLE_CLIENT_ID, VITE_SUI_NETWORK
npm run dev

# 3. Database
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=caishen postgres:16
psql -U postgres -d caishen -f database/init/001_schema.sql
```

📖 **Full guides:** [QUICKSTART.md](./QUICKSTART.md) | [INSTALLATION.md](./INSTALLATION.md)

---

## ⚡ Features

- 💬 **Natural Language Interface** - Chat or voice commands powered by Gemini 2.0 Flash
- 🔐 **zkLogin + Wallet Standard** - Google OAuth zkLogin or connect Slush/any Sui wallet
- 🔗 **Persistent Wallet Linking** - Bind Telegram account to wallet via secure web flow
- 💰 **Sui Blockchain Integration** - Balance, send, NFTs, transaction history
- 🎯 **AI Function Calling** - 5+ tools: balance, send, contacts, history, portfolio
- 📱 **Contact Management** - Store friendly names for addresses (database + on-chain registry)
- 📜 **Smart Contracts** - Batch transfers, contact registry, spending guardrails (Move)
- 🎤 **Voice Input** - Gemini multimodal transcription (replaces Whisper)

---

## 🏗️ Architecture (v0.4.1)

```
┌─────────────────┐     HTTPS/Webhook    ┌──────────────────┐
│   Telegram      │ ─────────────────────▶│  nginx (SSL)     │
│   Users         │                       │  Port 443/80     │
└─────────────────┘                       └────────┬─────────┘
                                                   │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
                    │  Python Bot     │  │  PostgreSQL     │  │  React Web dApp │
                    │  (aiogram)      │<<│  Database       │  │  (Vite)         │
                    │  Port 3001      │  │  Port 5432      │  │  Static Build   │
                    └────────┬────────┘  └─────────────────┘  └────────┬────────┘
                             │                                          │
                             │ Sui RPC                                  │ zkLogin OAuth
                             ▼                                          ▼
                    ┌─────────────────┐                        ┌─────────────────┐
                    │  Sui Blockchain │                        │  Mysten Labs    │
                    │  (testnet)      │                        │  Salt/Prover    │
                    └─────────────────┘                        └─────────────────┘
```

### Tech Stack
- **Bot:** Python 3.11, aiogram, aiohttp, httpx (Sui RPC), google-genai (Gemini)
- **Web dApp:** React 18, Vite, @mysten/dapp-kit, @mysten/sui/zklogin
- **Database:** PostgreSQL 16 (users, wallet_links, contacts, linking_sessions)
- **Chain:** Sui testnet/mainnet via JSON-RPC
- **AI:** Gemini 2.0 Flash (NLP + voice transcription + function calling)
- **Infra:** nginx (reverse proxy + SSL), Docker Compose

---

## 🔄 User Flow

### 1. Wallet Linking (One-Time Setup)

```
User sends /start in Telegram
         ↓
Bot creates 15-min token, returns link:
https://caishen.iseethereaper.com/link/@username?token=abc123
         ↓
User chooses on web page:
  [Create zkLogin wallet]  or  [Connect Slush/other wallet]
         ↓
If zkLogin: Google OAuth → Mysten salt/prover → zkLogin address
If Slush: Wallet Standard connection → address
         ↓
Telegram Login Widget verifies Telegram account (HMAC)
         ↓
Bot API binds: telegram_id + wallet_address + zkLogin salt/sub
         ↓
Done! Now user can use /balance, /send, /history, AI commands
```

### 2. Daily Usage (After Linking)

```bash
# Balance check
User: "/balance"
Bot: "💰 Your balance: 1,234.56 SUI"

# Natural language send
User: "Send 10 SUI to Alice"
Bot: [Gemini parses intent] → [Builds unsigned tx] → [Returns signing link]
User clicks link → Web dApp opens → Wallet signs → Tx confirmed

# Voice command
User: [🎤 Voice note] "What's my transaction history?"
Bot: [Gemini transcribes] → [Fetches history] → "📜 Last 5 transactions..."

# Contact management
User: "/contacts add Alice 0x1234..."
Bot: "✅ Added Alice"
User: "Send 5 SUI to Alice"
Bot: [Resolves Alice → 0x1234...] → [Builds tx]
```

---

## 📜 Smart Contracts (Move)

On-chain smart contracts deployed to Sui. See [SMART_CONTRACTS.md](./SMART_CONTRACTS.md) for full documentation.

| Contract | Purpose | Key Benefit | Status |
|----------|---------|-------------|--------|
| **BatchTransfer** | Multi-recipient payments | "Pay 10 people" in 1 tx | ✅ Implemented, but not used yet |
| **ContactRegistry** | On-chain address book | Portable, shared contacts | ✅ Implemented, but not used yet |
| **SpendingGuardian** | Rate-limited transfers | Anti-theft, spending limits | ✅ Implemented, but not used yet |

### Quick Commands

```bash
# Build contracts
cd move && sui move build

# Run tests
sui move test

# Deploy to testnet
sui client publish --gas-budget 100000000
```

### Example Use Cases

```
"Send 5 SUI to alice, bob, and carol"    → BatchTransfer.batch_send_sui()
"Add alice as 0x123..."                   → ContactRegistry.add_contact()
"Set my daily limit to 100 SUI"           → SpendingGuardian.set_limit()
"Freeze my account"                       → SpendingGuardian.freeze()
```

---

## 📂 Project Structure

```
.
├── bot/                                # Python Telegram Bot
│   ├── src/
│   │   ├── bot/
│   │   │   ├── bot.py                  # Main bot entry point (aiogram)
│   │   │   └── handlers/               # Command handlers
│   │   ├── services/
│   │   │   ├── gemini.py               # Gemini AI integration
│   │   │   └── sui.py                  # Sui RPC client (httpx)
│   │   ├── database/
│   │   │   └── postgres.py             # PostgreSQL connection
│   │   └── utils/
│   │       └── audio_processor.py      # Voice transcription
│   ├── requirements.txt
│   └── Dockerfile
│
├── services/
│   ├── web-dapp/                       # React Signing Interface
│   │   ├── src/
│   │   │   ├── App.tsx                 # Main app with wallet connection
│   │   │   ├── LinkPage.tsx            # /link/:handle page (zkLogin/Slush)
│   │   │   └── main.tsx                # Vite entry point
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── transaction-builder/            # (Legacy - now in bot)
│   ├── user-service/                   # (Legacy - now in bot)
│   ├── zklogin-service/                # (External Mysten APIs)
│   ├── nlp-service/                    # (Now Gemini in bot)
│   └── notification-service/           # (Future - webhooks)
│
├── move/                               # Smart Contracts (Sui Move)
│   ├── sources/
│   │   ├── batch_transfer.move         # Multi-recipient transfers
│   │   ├── contact_registry.move       # On-chain address book
│   │   └── spending_guardian.move      # Rate-limited spending
│   ├── tests/
│   └── Move.toml
│
├── database/
│   └── init/
│       └── 001_schema.sql              # PostgreSQL schema (users, wallet_links, contacts)
│
├── nginx/
│   ├── nginx.conf                      # Main nginx config (SSL termination)
│   ├── caishen.iseethereaper.com.conf  # Site-specific config
│   └── ssl/                            # SSL certificates (Let's Encrypt)
│
├── docker-compose.yml                  # Multi-service orchestration
├── .env.example                        # Environment template
└── README.md                           # This file
```

---

## 🛠️ Development

### Bot Development (Python)

```bash
cd bot
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Run with hot reload
python -m src.bot.bot

# Run tests
pytest tests/
```

### Web dApp Development (Node.js)

```bash
cd services/web-dapp
npm install
npm run dev  # Runs on http://localhost:5173

# Build for production
npm run build  # Output: out/
```

### Smart Contracts (Move)

```bash
cd move
sui move build
sui move test
sui client publish --gas-budget 100000000
```

---

## 🔐 Environment Variables

### Bot (.env)

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_from_BotFather
TELEGRAM_WEBHOOK_SECRET=random_secret_for_webhook_validation
WEBHOOK_BASE_URL=https://caishen.iseethereaper.com
WEBAPP_URL=https://caishen.iseethereaper.com

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=caishen
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password

# AI
GEMINI_API_KEY=your_google_ai_api_key

# Sui
SUI_NETWORK=testnet  # or mainnet
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
```

### Web dApp (.env)

```env
VITE_API_BASE_URL=https://caishen.iseethereaper.com
VITE_TELEGRAM_BOT_USERNAME=your_bot_username
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
VITE_SUI_NETWORK=testnet
VITE_ZKLOGIN_SALT_SERVICE_URL=https://salt.api.mystenlabs.com/get_salt
VITE_ZKLOGIN_PROVER_URL=https://prover-dev.mystenlabs.com/v1  # testnet
```

---

## 🚢 Deployment

### Docker Compose (Recommended)

```bash
# 1. Clone and configure
git clone https://github.com/your-org/caishen.git
cd caishen
cp .env.example .env
# Edit .env with production values

# 2. Build and deploy
docker-compose up -d --build

# 3. Sync web dApp static files
docker-compose exec web-dapp npm run build
sudo rsync -av --delete services/web-dapp/out/ /var/www/caishen/web/

# 4. Set webhook
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -d "url=https://caishen.iseethereaper.com/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"

# 5. Reload nginx
sudo systemctl reload nginx
```

### Manual VPS Deployment

See [DEPLOY_TO_VPS.md](./DEPLOY_TO_VPS.md) for detailed instructions.

---

## 🧪 Testing

```bash
# Bot tests (Python)
cd bot && pytest

# Move contract tests
cd move && sui move test

# Web dApp tests
cd services/web-dapp && npm test
```

---

## 🐛 Troubleshooting

### Expired Token (Web dApp)

**Error:** "Token expired or invalid"

**Cause:** Linking token is valid for 15 minutes only

**Fix:** Return to Telegram bot and run `/start` again for a fresh link

### Webhook 404/405

**Error:** Telegram webhook returns 404 or 405

**Cause:** nginx not proxying correctly to bot on port 3001

**Fix:**
```bash
# Check nginx config
sudo nginx -t

# Verify bot is running
docker-compose logs telegram-bot

# Check port binding
sudo netstat -tlnp | grep 3001
```

### Chat Not Found

**Error:** "Chat not found" when bot tries to message user

**Cause:** User never sent `/start` to bot

**Fix:** User must initiate conversation with bot first

### zkLogin Setup Failed

**Error:** Google OAuth fails or prover errors

**Fix:**
1. Verify `VITE_GOOGLE_CLIENT_ID` matches OAuth consent screen
2. Add authorized redirect URI: `https://caishen.iseethereaper.com/*`
3. Check Mysten prover URL matches network (testnet vs mainnet)

### Invalid Parameters

**Error:** Gemini function call fails with "invalid parameters"

**Cause:** Tool schema mismatch or missing required fields

**Fix:** Check `bot/src/services/gemini.py` tool definitions match handlers

### Static Build Not Updating

**Error:** Web dApp shows old version after deployment

**Fix:**
```bash
# Force rebuild and sync
cd services/web-dapp
rm -rf out/
npm run build
sudo rsync -av --delete out/ /var/www/caishen/web/
sudo systemctl reload nginx
```

---

## 📚 Documentation

- 📖 [Product Specification](./AI_Copilot_Wallet_Product_Specification_with_zklogin_microservices.md) - Complete architecture and design
- ✅ [Implementation Status](./IMPLEMENTATION_STATUS.md) - Development progress (188 checkpoints)
- 🚀 [Quick Start Guide](./QUICKSTART.md) - Fast-track setup
- 📦 [Installation Guide](./INSTALLATION.md) - Detailed setup steps
- 🏗️ [Smart Contracts](./SMART_CONTRACTS.md) - Move contracts documentation
- 🐳 [Docker Setup](./DOCKER_SETUP.md) - Container orchestration
- 🌐 [VPS Deployment](./DEPLOY_TO_VPS.md) - Production deployment guide

---

## 🗺️ Roadmap

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for detailed checkpoints.

**Phase 1: Foundation** (🚧 In Progress - ~60% complete)
- ✅ Python bot with aiogram
- ✅ Gemini AI integration
- ✅ Sui RPC client
- ✅ PostgreSQL database
- 🚧 Transaction builder
- 🚧 NFT service

**Phase 2: Smart Contracts** (✅ Complete)
- ✅ BatchTransfer contract
- ✅ ContactRegistry contract
- ✅ SpendingGuardian contract
- ⏸️ Deployment to testnet
- ⏸️ Bot integration

**Phase 3: Web dApp** (🚧 In Progress - ~70% complete)
- ✅ React + Vite setup
- ✅ zkLogin flow
- ✅ Wallet Standard connection
- ✅ Telegram verification
- 🚧 Transaction signing UI
- 📋 Transaction history view

**Phase 4: Production** (📋 Planned)
- 📋 Rate limiting
- 📋 Error monitoring (Sentry)
- 📋 Analytics
- 📋 Backup/restore
- 📋 Multi-language support

---

## 🤝 Contributing

This is an active development project. Contributions welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📝 License

MIT License - see [LICENSE](./LICENSE) file

---

## 📞 Support & Resources

- **Sui Documentation:** https://docs.sui.io/
- **Telegram Bot API:** https://core.telegram.org/bots/api
- **Google Gemini:** https://ai.google.dev/gemini-api/docs
- **Mysten zkLogin:** https://docs.sui.io/concepts/cryptography/zklogin
- **Project Issues:** https://github.com/Sui-Romanian-Hackathon/Caishen/issues

---

**Built with ❤️ for the Sui ecosystem**
- `src/services/llm/toolHandlers.ts` — tool execution stubs hooking Sui/contact services.
- `src/services/sui/client.ts` — SuiClient factory pinned to `SUI_RPC_URL`.
- `src/services/sui/suiService.ts` — balance lookups via Sui JSON-RPC.
- `src/services/sui/txBuilder.ts` — unsigned transaction building for SUI, tokens, NFTs (SDK-based).
- `src/services/sui/utils.ts` — metadata cache + amount conversions.
- `src/services/sui/nftService.ts` — NFT listing (ownership view + display metadata).
- `src/services/sui/historyService.ts` — transaction history fetcher with basic sent/received classification.
- `src/services/contacts/contactStore.ts` — in-memory contacts and resolution helper.
- `src/utils/security.ts` — bcrypt hashing + nonce helper.
- `src/utils/logger.ts` — pino logger config.

## Infrastructure quick start

- Docker/Docker Compose definitions for all microservices + infra live in `docker-compose.yml` (nginx front-end, api-gateway, Telegram gateway, NLP, transaction-builder, user, notification, Redis). SQLite3 is used instead of Postgres to fit the 2GB footprint.
- nginx reverse proxy configs are in `nginx/nginx.conf` (public) and `nginx/api-gateway.conf` (internal service mesh). Self-signed cert instructions are in `nginx/ssl/README.md`.
- For now, zkLogin uses external Mysten Labs services (salt + prover); no local zklogin-service container.
- See `DOCKER_SETUP.md` for WSL-friendly commands, SSL generation steps, and the 2GB-optimized deployment notes.

## Tooling

- Lint: `npm run lint`
- Format: `npm run format`
- Type check: `npm run check`
- Build: `npm run build`

## Next steps (suggested)

- Wire `llmService` to OpenAI/Gemini (function calling) using the schemas from the spec.
- Extend Sui layer for transaction building (send SUI/tokens, NFTs) and deep-link generation to the signing dApp (bytes are already built).
- Persist sessions/contacts in SQLite/Redis (per the 2GB compose) instead of memory; reuse `tokenService` helpers to store only hashed secrets.
- Add end-to-end tests around the webhook flow and Telegram client mocking.
- Harden RPC usage (timeouts/retries), expand history/NFT queries via indexer, and add rate limiting.
