# AI Copilot Wallet for Sui

> **Status:** Active Development | **Version:** 0.3.0 (2GB RAM Optimized + Smart Contracts)

A Telegram-based AI wallet assistant for the Sui blockchain, featuring natural language transaction building, zkLogin authentication, and Gemini AI integration.

## 🚀 Quick Start

**Prerequisites:** Node.js 20+ required (Node 18 is too old)

```bash
# Automated setup (includes Node upgrade on Ubuntu/WSL)
chmod +x setup.sh && ./setup.sh

# Or manual
npm install
cp .env.example .env
# Edit .env with your API keys
npm run dev
```

📖 **Full guide:** [QUICKSTART.md](./QUICKSTART.md)

## ⚡ Features

- 💬 **Natural Language Interface** - Telegram bot powered by Gemini 2.0 Flash
- 🔐 **zkLogin Authentication** - Google OAuth with zero-knowledge proofs (via Mysten Labs APIs)
- 💰 **Sui Blockchain Integration** - Send SUI, tokens, NFTs with AI-driven function calling
- 🗃️ **Lightweight Storage** - SQLite3 for 2GB RAM servers (~50MB footprint)
- 🎯 **AI Function Calling** - 7 Gemini tools executing Sui SDK operations
- 📱 **Contact Management** - Store and resolve wallet addresses by friendly names
- 📜 **Smart Contracts** - On-chain batch transfers, contact registry, spending limits (Move)

## 🏗️ Architecture (2GB RAM Optimized)

```
Telegram Bot (Node.js + Express)
  ↓
Gemini AI (Function Calling with 7 Tools)
  ↓
Sui SDK (@mysten/sui v1.14+)
  ↓
SQLite3 (users.db + transactions.db)
  +
External Mysten Labs zkLogin APIs
```

### Why 2GB Optimized?

This architecture targets VPS servers with limited RAM:

- ✅ **SQLite3** instead of PostgreSQL (~400MB saved)
- ✅ **External zkLogin APIs** instead of local prover service (~200MB saved)
- ✅ **Total footprint:** ~800MB (down from ~1.5GB)

See [AI_Copilot_Wallet_Product_Specification_with_zklogin_microervices.md](./AI_Copilot_Wallet_Product_Specification_with_zklogin_microervices.md) for full architecture details.

## 📜 Smart Contracts (Move)

On-chain smart contracts for advanced blockchain operations. See [SMART_CONTRACTS.md](./SMART_CONTRACTS.md) for full documentation.

| Contract | Purpose | Key Benefit |
|----------|---------|-------------|
| **BatchTransfer** | Multi-recipient payments | "Pay 10 people" in one tx |
| **ContactRegistry** | On-chain address book | Portable, shared contacts |
| **SpendingGuardian** | Rate-limited transfers | Anti-theft, spending limits |

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
"Send 5 SUI to alice, bob, and carol"    → BatchTransfer
"Add alice as 0x123..."                   → ContactRegistry
"Set my daily limit to 100 SUI"           → SpendingGuardian
"Freeze my account"                       → SpendingGuardian
```

## 📦 Dependencies

**Core:**
- `@mysten/sui` ^1.14.0 (unified SDK - replaces deprecated @mysten/sui.js)
- `better-sqlite3` ^11.7.0 (Node 18+) or ^12.5.0 (Node 20+ recommended)
- `zod` ^4.1.13 (schema validation for Gemini function calling)
- `express` ^5.2.1
- `axios` ^1.13.2

**AI/NLP:**
- Google Gemini 2.0 Flash (via `@google/generative-ai`)

**External Services:**
- Mysten Labs zkLogin APIs:
  - Salt: `https://salt.api.mystenlabs.com/get_salt`
  - Prover (testnet): `https://prover-dev.mystenlabs.com/v1`
  - Prover (mainnet): `https://prover.mystenlabs.com/v1`

## 🔧 Setup

### 1. Node.js Version

**⚠️ CRITICAL:** Requires Node.js 20+ (not 18)

```bash
# Check version
node -v

# Upgrade on Ubuntu/WSL
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Or use automated setup
./setup.sh
```

### 2. Install Dependencies


```bash
# Clean install (recommended after package.json changes)
rm -rf node_modules package-lock.json
npm install
```

**Known issues:**
- ⚠️ If better-sqlite3 fails to install - upgrade to Node 20+ first

### 3. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with required values:

```env
# Required
TELEGRAM_BOT_TOKEN=your_token_from_@BotFather
GOOGLE_AI_API_KEY=your_gemini_api_key

# Optional (has defaults)
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
SQLITE_DB_PATH=./data
PORT=3001
TELEGRAM_WEBHOOK_SECRET=random_string_for_security
```

### 4. Run Development Server

```bash
npm run dev
```

**Verify:**
- Server starts on port 3001
- SQLite databases created in `./data/` directory
- No import errors or dependency warnings

## 📂 Project Structure

```
.
├── move/                           # Smart Contracts (Sui Move)
│   ├── Move.toml                   # Package manifest
│   └── sources/
│       ├── batch_transfer.move     # Multi-recipient transfers
│       ├── contact_registry.move   # On-chain address book
│       └── spending_guardian.move  # Rate-limited spending
│
├── src/
│   ├── index.ts                    # Server bootstrap + webhook registration
│   ├── server.ts                   # Express app setup
│   ├── config/
│   │   └── env.ts                  # Environment validation (zod schemas)
│   ├── routes/
│   │   └── telegram.ts             # Telegram webhook endpoint
│   ├── services/
│   │   ├── database/
│   │   │   └── sqlite.ts           # SQLite database layer
│   │   ├── telegram/
│   │   │   ├── telegramClient.ts   # Telegram Bot API client
│   │   │   ├── updateHandler.ts    # Command routing (/start, /balance, etc.)
│   │   │   └── webhook.ts          # Webhook registration
│   │   ├── llm/
│   │   │   ├── llmService.ts       # Main LLM orchestration
│   │   │   ├── geminiClient.ts     # Gemini API integration
│   │   │   ├── tools.ts            # Tool definitions (7+ tools with schemas)
│   │   │   └── toolHandlers.ts     # Tool execution logic
│   │   ├── sui/
│   │   │   ├── client.ts           # Sui RPC client (@mysten/sui)
│   │   │   ├── suiService.ts       # Balance & transaction queries
│   │   │   ├── txBuilder.ts        # Transaction construction
│   │   │   ├── historyService.ts   # Transaction history
│   │   │   ├── nftService.ts       # NFT queries
│   │   │   └── utils.ts            # Sui utilities
│   │   ├── session/
│   │   │   ├── sessionStore.ts     # User session management
│   │   │   └── tokenService.ts     # Secure token generation (bcrypt)
│   │   └── contacts/
│   │       └── contactStore.ts     # Contact name resolution
│   └── utils/
│       ├── logger.ts               # Logging utilities
│       └── security.ts             # Security helpers
```

## 🛠️ Development

### Available Scripts

```bash
npm run dev        # Start development server (tsx watch mode)
npm run build      # Compile TypeScript
npm run start      # Run production build
npm run lint       # Run ESLint + type-check
```

### Code Quality

```bash
# Check for errors
npm run lint

# Expected output: Only prettier formatting warnings (cosmetic)
# No TypeScript compilation errors
```

## 🔐 Security

- **Webhook Secret:** Telegram requests validated with `X-Telegram-Bot-Api-Secret-Token`
- **Token Hashing:** One-time link tokens stored with bcrypt (salt rounds: 10)
- **Input Validation:** All inputs validated with zod schemas
- **Unsigned Transactions:** Server only builds unsigned transactions, never signs
- **External zkLogin:** Zero-knowledge proofs generated via Mysten Labs APIs

## 📚 Documentation

- [QUICKSTART.md](./QUICKSTART.md) - Fast-track setup guide
- [INSTALLATION.md](./INSTALLATION.md) - Detailed installation steps
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) - Development roadmap
- [SMART_CONTRACTS.md](./SMART_CONTRACTS.md) - Move smart contracts guide
- [AI_Copilot_Wallet_Product_Specification_with_zklogin_microervices.md](./AI_Copilot_Wallet_Product_Specification_with_zklogin_microervices.md) - Full architecture

## 🚢 Deployment

### Docker (Recommended)

```bash
docker compose up -d
```

### Manual VPS Deployment

1. Upgrade Node.js to v20+
2. Clone repository
3. Install dependencies: `npm install`
4. Configure `.env`
5. Build: `npm run build`
6. Start: `npm run start`
7. Use PM2 or systemd for process management

See [QUICKSTART.md](./QUICKSTART.md) for detailed VPS setup instructions.

## 🔧 Troubleshooting

### Node Version Issues

**Error:** `EBADENGINE required: { node: '20.x || 22.x' }`

**Fix:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Zod Version Conflict

**Error:** `ERESOLVE could not resolve zod@4`

**Fix:** Already resolved in package.json - use zod@3.23.8

### better-sqlite3 Installation Fails

**Cause:** Node 18 too old for better-sqlite3 v12

**Fix:** 
- Upgrade to Node 20+ (recommended)
- Or: package.json already uses v11.7.0 (Node 18+ compatible)

### SQLite Database Not Persisting

**Cause:** better-sqlite3 not installed (stub fallback active)

**Check:** Look for warning in logs: "better-sqlite3 not available, using stub"

**Fix:** Ensure better-sqlite3 installed successfully after Node upgrade

## 📝 License

MIT

## 🤝 Contributing

This is an active development project. See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for current progress and roadmap.

## 📞 Support

- **Sui Documentation:** https://docs.sui.io/
- **Telegram Bot API:** https://core.telegram.org/bots/api
- **Google Gemini:** https://ai.google.dev/gemini-api/docs
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
