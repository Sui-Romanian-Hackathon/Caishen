# AI Copilot Wallet — Implementation Status & Checkpoints

> **Spec Version:** 0.4.0 | **Last Updated:** December 13, 2025

<!-- 🎉 DEPLOYED TO VPS: December 11, 2025
     - Domain: caishen.iseethereaper.com
     - Port: 3001 (nginx proxies from 443)
     - Docker containers: ai-copilot-telegram-bot (Python/aiogram), ai-copilot-postgres
     - SSL: Let's Encrypt certificate active

🔄 MAJOR UPDATE: December 13, 2025
     - Migrated from Node.js/Express to Python/aiogram bot
     - Voice transcription now uses Gemini API (replaced Whisper)
     - Simplified architecture: Python bot + PostgreSQL + Web dApp
-->

This document provides a comprehensive checklist for agentic implementers. Each checkpoint must be completed and verified before moving to dependent tasks.

---

## Phase completion snapshot (user confirmation)
- Phase 1: ✅ Foundation (bot + Sui RPC)
- Phase 2: ✅ NLP & tool calling working to commands
- Phase 3: ✅ Linking + Telegram HMAC + zkLogin flow marked complete
- Phase 4: ✅ Web dApp signing/linking working
- Phase 5: ✅ VPS with nginx/postgres/docker running
- Phase 6: 🚧 MVP only (hardening pending)

---

## Architecture Overview (v0.4.0)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Telegram      │────▶│  Python Bot      │────▶│  PostgreSQL     │
│   Users         │◀────│  (aiogram:3001)  │◀────│  Database       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                        ▲
                               │ /api/link/*            │
                               ▼                        │
                        ┌──────────────────┐           │
                        │  transaction-    │───────────┘
                        │  builder (:3003) │
                        │  • zkLogin salt  │
                        │  • JWT validation│
                        └──────────────────┘
                               │
                               │ Sui RPC
                               ▼
                        ┌──────────────────┐
                        │  Sui Blockchain  │
                        │  (testnet)       │
                        └──────────────────┘
                               ▲
                               │ OAuth + zkLogin
                               │
                        ┌──────────────────┐
                        │  Web dApp (:5173)│
                        │  (wallet linking)│
                        └──────────────────┘
```

### Key Components:
- **Python Bot** (`/bot`): aiogram-based Telegram bot with Gemini AI, serves `/api/link/*` endpoints
- **transaction-builder** (`/services/transaction-builder`): Node.js service for zkLogin salt derivation, JWT validation
- **PostgreSQL**: User sessions, wallet links, contacts, linking sessions, zklogin_salts
- **Web dApp** (`/services/web-dapp`): React app for zkLogin and wallet connection
- **Gemini AI**: Natural language processing + voice transcription

---

## Legend

| Symbol | Status | Description |
|--------|--------|-------------|
| `[x]` | ✅ Complete | Implemented and tested |
| `[~]` | 🚧 In Progress | Currently being developed |
| `[ ]` | 📋 Planned | Ready to implement |
| `[B]` | ⏸️ Blocked | Waiting on dependencies |
| `[S]` | 💡 Stretch | Nice-to-have, not committed |

---

## Phase 1: Foundation (Sprint 1-2)

### 1.1 Development Environment Setup

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Node.js 20+ installed | `[x]` | None | `node --version` returns v20.x+ |
| pnpm package manager | `[x]` | Node.js | `pnpm --version` works |
| TypeScript project init | `[x]` | pnpm | `tsconfig.json` configured |
| ESLint + Prettier setup | `[x]` | TypeScript | Linting passes on codebase |
| Docker Desktop installed | `[x]` | None | `docker --version` works |
| Docker Compose setup | `[x]` | Docker | `docker-compose up` runs |
| nginx reverse proxy config | `[x]` | Docker | nginx.conf serves on port 443 |

### 1.2 Telegram Bot Core (Python/aiogram)

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Bot token obtained | `[x]` | BotFather | Token stored in `.env` |
| Python aiogram scaffold | `[x]` | Python 3.11+ | Bot starts with aiogram |
| nginx → Python proxy | `[x]` | nginx, aiohttp | HTTPS terminates at nginx |
| Webhook endpoint created | `[x]` | aiohttp | `/webhook` endpoint responds |
| Webhook secret verification | `[x]` | Webhook | Secret token validated |
| `/start` command handler | `[x]` | Webhook | Bot responds with wallet linking flow |
| `/help` command handler | `[x]` | Webhook | Bot shows help menu |
| `/balance` command handler | `[x]` | Webhook | Shows SUI balance from RPC |
| `/send` command handler | `[x]` | Webhook | Builds tx and shows signing link |
| `/contacts` command handler | `[x]` | Webhook | List/add contacts |
| `/history` command handler | `[x]` | Webhook | Shows tx history with explorer links |
| `/nfts` command handler | `[ ]` | Webhook | Shows NFT gallery |
| `/settings` command handler | `[ ]` | Webhook | Shows user settings |
| Message routing logic | `[x]` | Handlers | Text/voice routed correctly |
| Callback query handling | `[x]` | Bot API | Inline buttons work |
| Inline buttons return live data | `[x]` | Callback query handling | Balance/contacts/history buttons use user context and backend data |
| Error handling | `[x]` | Routing | Errors don't crash bot |
| `/reset` command | `[x]` | Conversation history | Clears stored chat context and confirms to user |
| Rate limiting (per user) | `[ ]` | Database | 30 req/min enforced |

### 1.3 Sui RPC Integration (Python httpx)

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| httpx HTTP client | `[x]` | Python | Async HTTP calls to Sui RPC |
| SuiService class | `[x]` | httpx | Connects to testnet |
| `get_balance()` working | `[x]` | SuiService | Returns SUI balance |
| `get_all_balances()` working | `[x]` | SuiService | Lists all token types |
| `get_coins()` working | `[x]` | SuiService | Gets coin objects |
| `get_transaction_history()` working | `[x]` | SuiService | Fetches tx history |
| `get_owned_objects()` working | `[~]` | SuiService | Lists NFTs/objects |
| Transaction builder | `[~]` | SuiService | Build unsigned txs |
| RPC failover logic | `[ ]` | SuiService | Falls back on failure |

---

## Phase 2: NLP & Intelligence (Sprint 3-4)

> Update: LangGraph wallet agent now binds the production tool set (`get_balance`, `send_sui`, contacts, history, NFTs, help/reset) and forwards signing payloads to the router (`needs_signing` + `tx_data`), replacing the previous stub/demo tools.

### 2.1 Gemini Integration (Python google-genai)

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Google AI API key obtained | `[x]` | Google Cloud | Key in `.env` |
| `google-genai` installed | `[x]` | pip | Package available |
| GeminiService class | `[x]` | google-genai | Handles all AI calls |
| Basic chat completion | `[x]` | API key | Model responds to text |
| Tool/Function schemas defined | `[x]` | SDK | 5 core tools defined |
| Function calling working | `[x]` | Schemas | Model calls: get_balance, send_sui, list_contacts, add_contact, get_history |
| Context injection | `[x]` | Function calling | Wallet address in system prompt |
| Audio transcription | `[x]` | Gemini multimodal | Gemini transcribes voice messages |
| System prompt defined | `[x]` | Gemini | Wallet assistant guardrails |
| Conversation history | `[x]` | Context | Multi-turn works |
| Error recovery prompts | `[~]` | History | Graceful error messages |

### 2.2 Tool Handlers Implementation

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| `get_balance` handler | `[x]` | Sui SDK | Returns formatted balance |
| `get_portfolio` handler | `[ ]` | Sui SDK | Shows all tokens |
| `build_send_sui_tx` handler | `[x]` | Transaction builder | Creates unsigned tx |
| `build_send_token_tx` handler | `[x]` | Transaction builder | Handles any coin type |
| `get_transaction_history` handler | `[~]` | Sui SDK | Paginated tx list |
| `get_nfts` handler | `[~]` | Sui SDK | Lists NFTs with images |
| `build_nft_transfer_tx` handler | `[x]` | Transaction builder | NFT transfer tx |
| `resolve_contact` handler | `[x]` | Contact store | Name → address lookup |
| `add_contact` handler | `[x]` | Contact store | Saves name/address pair |
| `list_contacts` handler | `[~]` | Contact store | Shows all contacts |
| `get_sui_price` handler | `[ ]` | External API | Current SUI/USD price |
| `estimate_gas` handler | `[~]` | Sui SDK | Static estimate via tx-service; needs dry-run |
| Tool dispatcher | `[x]` | All handlers | Routes to correct handler |

### 2.3 Voice Input Processing (Gemini Multimodal)

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Voice message detection | `[x]` | aiogram F.voice | Identifies voice notes |
| Audio file download | `[x]` | Bot API | Downloads OGG file |
| OGG to WAV conversion | `[x]` | ffmpeg | Converts for better compatibility |
| Gemini multimodal transcription | `[x]` | Gemini 2.0 Flash | Audio → text transcription |
| Transcription display | `[x]` | Multimodal | Shows "I heard: ..." |
| Process as text | `[x]` | AI chat | Transcribed text processed by AI |
| Voice response support | `[S]` | TTS API | Bot responds with audio |

---

## Phase 2.5: Smart Contracts (Move)

> **NEW:** On-chain smart contracts for advanced blockchain operations.
> See [SMART_CONTRACTS.md](./SMART_CONTRACTS.md) for full documentation.

### 2.5.1 Move Project Setup

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Move.toml package manifest | `[x]` | Sui CLI | Package compiles |
| Sui framework dependency | `[x]` | Move.toml | testnet-v1.44.3 linked |
| Edition 2024.beta configured | `[x]` | Move.toml | Modern Move syntax |
| Directory structure created | `[x]` | None | `move/sources/*.move` |

### 2.5.2 BatchTransfer Contract

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| `batch_send_sui` function | `[x]` | Sui Coin | Multi-recipient SUI transfers |
| `batch_send_coin<T>` generic | `[x]` | Coin<T> | Any token type batch transfer |
| `split_equal_sui` function | `[x]` | Sui Coin | Equal split among recipients |
| BatchTransferEvent emission | `[x]` | Events | Batch summary event |
| TransferRecord per-transfer | `[x]` | Events | Individual transfer logging |
| Recipient limit (max 100) | `[x]` | Constants | Gas limit protection |
| Input validation | `[x]` | Asserts | Length matching, non-empty |
| Remainder return to sender | `[x]` | Transfer | Leftover returned |
| Contract deployed (testnet) | `[ ]` | Sui CLI | Package ID obtained |
| Bot integration | `[ ]` | Tool handlers | AI can call batch transfers |

### 2.5.3 ContactRegistry Contract

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| ContactBook (owned object) | `[x]` | UID, Table | Personal contact storage |
| GlobalRegistry (shared) | `[x]` | Share object | Public name registry |
| ContactEntry struct | `[x]` | Store | Name, address, notes, stats |
| `create_contact_book` | `[x]` | Entry fn | User creates their book |
| `add_contact` | `[x]` | Entry fn | Add name→address mapping |
| `remove_contact` | `[x]` | Entry fn | Delete contact |
| `update_contact` | `[x]` | Entry fn | Change address |
| `register_public_name` | `[x]` | Entry fn | First-come-first-served |
| `resolve_contact` view | `[x]` | View fn | Name to address lookup |
| Reverse lookup (addr→name) | `[x]` | Table | Get name from address |
| Transfer count tracking | `[x]` | ContactEntry | Usage stats |
| Events (add/remove/update) | `[x]` | Events | Audit trail |
| Contract deployed (testnet) | `[ ]` | Sui CLI | Package ID obtained |
| Bot integration | `[ ]` | Tool handlers | AI resolves on-chain contacts |

### 2.5.4 SpendingGuardian Contract

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| SpendingGuard object | `[x]` | UID, Table | Rate limit configuration |
| GuardianCap capability | `[x]` | Key, Store | Admin access control |
| Per-transaction limits | `[x]` | u64 | Max amount per tx |
| Daily spending limits | `[x]` | u64 | Max amount per 24h |
| Cooldown periods | `[x]` | u64 (ms) | Wait time after large tx |
| `create_guard` | `[x]` | Entry fn | Setup spending limits |
| `guarded_send_sui` | `[x]` | Entry fn | Protected transfer |
| `update_limits` | `[x]` | Admin fn | Modify limits |
| `set_cooldown` | `[x]` | Admin fn | Configure cooldown |
| `freeze_account` | `[x]` | Admin fn | Emergency stop |
| `unfreeze_account` | `[x]` | Admin fn | Resume transfers |
| Whitelist management | `[x]` | Admin fn | Bypass limits for trusted |
| Clock integration | `[x]` | sui::clock | Time-based tracking |
| Daily counter reset | `[x]` | Logic | Auto-reset at day boundary |
| LimitExceeded events | `[x]` | Events | Blocked transfer logging |
| Contract deployed (testnet) | `[ ]` | Sui CLI | Package ID obtained |
| Bot integration | `[ ]` | Tool handlers | AI enforces spending limits |

### 2.5.5 Smart Contract Deployment

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Build contracts | `[ ]` | `sui move build` | No compilation errors |
| Run Move tests | `[ ]` | `sui move test` | All tests pass |
| Deploy to testnet | `[ ]` | Sui CLI | Package published |
| Save package ID in .env | `[ ]` | Deployment | `SMART_CONTRACT_PACKAGE_ID` |
| Save GlobalRegistry ID | `[ ]` | Init event | `CONTACT_REGISTRY_ID` |
| Add tool schemas | `[ ]` | tools.ts | Gemini schemas defined |
| Implement tool handlers | `[ ]` | toolHandlers.ts | SDK calls to contracts |
| Deploy to mainnet | `[ ]` | Testing complete | Production deployment |

---

## Phase 3: Authentication (Sprint 5-6)

### 3.1 Secure Telegram-Wallet Linking Flow (NEW)

> **Security Architecture:** Server-side session binding with Telegram Login Widget verification.
> This prevents parameter swapping, session hijacking, and implicit linking attacks.

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| **Linking token store** | `[x]` | Postgres (bot) | Server-side session with 15-min TTL |
| **Linking API endpoints** | `[x]` | aiohttp (bot) | GET/POST /api/link/:token |
| **/start generates linking URL** | `[x]` | Telegram Bot | URL with secure token |
| **Web-dapp linking page** | `[x]` | React | Step-by-step wallet connection |
| **Wallet choice UI** | `[x]` | dapp-kit | zkLogin OR Slush wallet |
| **Linking UI reset actions** | `[x]` | React | Try-again and new-link options in error/completed states |
| **Telegram Login Widget** | `[x]` | telegram.org | HMAC-SHA256 verified |
| **Server-side hash verification** | `[x]` | crypto | Prevents spoofing |
| **Telegram ID matching** | `[x]` | Linking store | Must match /start initiator |
| **Telegram verification callback** | `[x]` | Bot API | `/api/link/:token/telegram-verify` validates HMAC, completes link, and notifies user |
| **Rate limiting** | `[x]` | Express | 20 req/min per IP |
| One-time token consumption | `[x]` | Linking store | Prevents replay |

**User Flow:**
```
1. User presses /start in Telegram
2. Bot creates linking session (15-min TTL), returns: caishen.iseethereaper.com/link/@username?token=XYZ
3. User clicks → Web-dapp shows wallet options
4. User clicks "zkLogin" → stores ephemeral key + token in sessionStorage
5. Google OAuth redirect → user signs in
6. OAuth callback to /link#id_token=... → token retrieved from sessionStorage
7. Web-dapp calls POST /api/link/{token}/zklogin-salt with JWT
8. Bot proxies to transaction-builder /api/v1/zklogin/salt
9. transaction-builder validates JWT, derives salt from master secret, returns salt + address
10. Web-dapp derives zkLogin address, calls /api/link/{token}/wallet
11. User clicks Telegram Login Widget to verify identity
12. Server verifies HMAC hash AND matches Telegram ID to token
13. Wallet linked to Telegram account ✅

> Latest: Linking sessions, wallet type (zkLogin/Slush/external), and zkLogin salt/sub are now persisted in Postgres and exposed via the bot's aiohttp API (`/api/link/:token`, `/api/link/:token/wallet`, `/api/link/:token/zklogin-salt`, `/api/link/:token/complete`). Salt derivation uses HMAC from ZKLOGIN_MASTER_SECRET for deterministic addresses.
```

### 3.2 zkLogin Implementation (Using External Mysten Labs APIs)

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Ephemeral keypair generation | `[x]` | `@mysten/sui/zklogin` | Keys generated in LinkPage |
| Randomness generation | `[x]` | Crypto | 128-bit random value |
| Nonce generation | `[x]` | Ephemeral keys | Valid nonce created |
| OAuth URL construction | `[x]` | Nonce | Redirect URL works |
| OAuth redirect preserves linking path | `[x]` | Google OAuth | Token stored in sessionStorage before OAuth |
| Google OAuth integration | `[x]` | OAuth URL | JWT returned via hash |
| OAuth error handling | `[x]` | OAuth URL | Hash errors parsed and shown to user |
| JWT decoding & validation | `[x]` | OAuth | Claims extracted (sub, aud) |
| **Backend salt service** | `[x]` | transaction-builder | Bot proxies to `/api/v1/zklogin/salt` |
| **Salt endpoint in Python bot** | `[x]` | aiohttp | `/api/link/{token}/zklogin-salt` |
| External prover call (dev) | `[~]` | prover-dev.mystenlabs.com | Used for tx signing |
| External prover call (prod) | `[ ]` | prover.mystenlabs.com | Mainnet deployment |
| Proof caching until expiry | `[ ]` | Redis | Avoids re-proving |
| Address derivation | `[x]` | jwtToAddress | Sui address calculated |
| Address verification | `[x]` | Derivation | Matches expected |
| Session creation with maxEpoch | `[~]` | Address | Stored in sessionStorage |
| Session validation (epoch check) | `[ ]` | SuiClient | Validates against chain |
| Facebook OAuth | `[ ]` | OAuth flow | Phase 2 provider |
| Apple OAuth | `[ ]` | OAuth flow | Phase 2 provider |
| Twitch OAuth | `[S]` | OAuth flow | Gaming audience |

> **Note:** Using local transaction-builder for salt derivation (HMAC from master secret) instead of Mysten Labs salt service. This provides deterministic salts and encrypted storage.

### 3.3 External Wallet Integration

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Wallet Standards support | `[x]` | `@mysten/dapp-kit` | ConnectButton works |
| Slush wallet detection | `[x]` | dapp-kit | Detects installed wallets |
| Message signing request | `[~]` | Wallet Standards | Used for tx signing |
| Signature verification | `[ ]` | Sui SDK | Validates signature |
| Deep link generation | `[x]` | Pending tx API | Opens web-dapp |
| QR code generation | `[ ]` | Transaction | Scannable QR |
| Signature callback handling | `[x]` | Web dApp | Handles signed tx |
| Transaction submission | `[x]` | Sui SDK | Submits to network |

### 3.4 Onboarding Flow

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Welcome message | `[x]` | Bot | Shows on /start with linking URL |
| Auth method selection UI | `[x]` | Web-dapp | zkLogin vs Slush choice |
| "Create new wallet" flow | `[x]` | zkLogin | Google OAuth in web-dapp |
| "Import Slush" flow | `[x]` | dapp-kit | ConnectButton in web-dapp |
| "Import other wallet" flow | `[x]` | Wallet Standards | Any Sui wallet |
| Post-auth confirmation | `[x]` | Telegram Widget | Verifies Telegram identity |
| Faucet prompt (testnet) | `[ ]` | Testnet | Offers test SUI |

---

## Phase 4: Web dApp (Sprint 7-8)

### 4.1 Web Application Setup

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Next.js 14+ project init | `[~]` | Node.js | App runs on localhost (React/Vite scaffold added) |
| TailwindCSS configured | `[ ]` | Next.js | Styles working |
| Mobile-responsive design | `[~]` | TailwindCSS | Works on phone (basic responsive layout) |
| PWA manifest | `[ ]` | Next.js | Installable as app |
| nginx serves static files | `[ ]` | nginx | Assets served from nginx |
| HTTPS with valid cert | `[ ]` | nginx + Let's Encrypt | No cert warnings |

### 4.2 Transaction Signing Flow

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| **Secure pending tx API** | `[x]` | Express, CORS | `/api/pending-tx/:id` endpoint |
| **Pending tx store (in-memory)** | `[x]` | Node.js | 15-min TTL, auto-cleanup |
| **Bot creates pending tx** | `[x]` | /send command | Returns secure URL with tx ID only |
| **Web-dapp fetches tx details** | `[x]` | Fetch API | Loads recipient/amount from API |
| Deep link parsing | `[x]` | React | Extracts tx ID from URL |
| URL param autofill (manual wallet link) | `[x]` | Link parsing | Query params hydrate recipient/amount/memo/sender then are cleaned from URL |
| Transaction preview page | `[x]` | React | Shows tx details from API |
| Human-readable tx display | `[x]` | Preview | Clear recipient/amount |
| Risk warnings display | `[x]` | Preview | Shows for large amounts (>100 SUI) |
| Gas estimate display | `[x]` | Sui SDK | Shows estimated gas cost |
| zkLogin signing | `[~]` | zkLogin | Signs with ephemeral key (manual JWT/salt form implemented) |
| External wallet signing | `[x]` | @mysten/dapp-kit | Wallet connect + signing works |
| Transaction broadcast | `[x]` | Sui SDK | Submits to network |
| Confirmation screen | `[x]` | Signing | Shows success/hash (digest shown after send) |
| Explorer link | `[x]` | Confirmation | Links to SuiScan (testnet/mainnet) |
| Error handling UI | `[x]` | Signing | Clear error messages |
| Pending tx expiry display | `[x]` | UI | Shows expiration time |
| Redirect back to Telegram | `[ ]` | Confirmation | Deep link to chat |

> **Security:** Transaction details are no longer exposed in URL. The bot creates a pending transaction with a secure random ID, and the web-dapp fetches details via authenticated API call. Links expire after 15 minutes.

### 4.3 Client-Side Storage

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| IndexedDB wrapper | `[ ]` | Browser | CRUD operations work |
| Ephemeral key storage | `[ ]` | IndexedDB | Keys persist locally |
| Session caching | `[ ]` | IndexedDB | Reduces API calls |
| Secure key encryption | `[ ]` | Web Crypto API | Keys encrypted at rest |
| Storage cleanup on logout | `[ ]` | IndexedDB | Data deleted |

---

## Phase 5: Data & Infrastructure (Sprint 9-10)

### 5.1 nginx Configuration

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| nginx Docker container | `[ ]` | Docker | Container runs |
| SSL/TLS termination | `[ ]` | Let's Encrypt | HTTPS works |
| Reverse proxy to Node.js | `[ ]` | Node.js services | Traffic forwarded |
| Upstream configuration | `[ ]` | nginx | Load balancing ready |
| Static file serving | `[ ]` | Web dApp build | Assets served directly |
| Rate limiting at nginx | `[ ]` | nginx config | Request limits enforced |
| Gzip compression | `[ ]` | nginx config | Responses compressed |
| Security headers (CSP, HSTS) | `[ ]` | nginx config | Headers set |
| X-Frame-Options | `[ ]` | nginx config | Clickjacking prevented |
| WebSocket proxy | `[S]` | nginx config | WS connections work |
| nginx access logs | `[ ]` | nginx config | Requests logged |

### 5.2 SQLite3 Setup (Lightweight - 2GB RAM Constraint)

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| SQLite3 npm package | `[ ]` | better-sqlite3 | Package installed |
| users.db schema created | `[ ]` | SQLite3 | Users table exists |
| contacts.db schema created | `[ ]` | SQLite3 | Contacts table exists |
| transactions.db schema created | `[ ]` | SQLite3 | Tx history table exists |
| Foreign key constraints | `[ ]` | SQLite3 | Constraints enforced |
| Index optimization | `[ ]` | SQLite3 | Queries fast |
| Volume mount configured | `[ ]` | Docker | Data persists |
| Write-ahead logging (WAL) | `[ ]` | SQLite3 | Concurrent reads |
| Backup script | `[ ]` | Shell script | Daily backups |

> **Note:** SQLite3 replaces PostgreSQL to save ~400MB RAM. No RLS - use application-level data isolation.

### 5.3 Redis Setup

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Redis container running | `[ ]` | Docker | `redis-cli ping` works |
| Session storage | `[ ]` | Redis | Sessions persisted |
| Session TTL (maxEpoch-based) | `[ ]` | Redis | Auto-expiry works |
| Rate limit counters | `[ ]` | Redis | Sliding window works |
| Proof caching | `[ ]` | Redis | zkProofs cached |
| Cache invalidation | `[ ]` | Redis | TTL configured |
| Pub/Sub for events | `[S]` | Redis | Real-time updates |

### 5.4 Observability

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Structured logging (pino) | `[x]` | Node.js | JSON logs output |
| Log level configuration | `[x]` | pino | DEBUG/INFO/WARN/ERROR |
| Request ID tracing | `[ ]` | Logging | Trace IDs propagate |
| Health check endpoints | `[x]` | Express | `/health` returns 200 |
| Readiness probe | `[ ]` | Express | `/ready` checks deps |
| nginx access logs | `[ ]` | nginx | Requests logged |
| Prometheus metrics | `[S]` | Express | Metrics exposed |
| Grafana dashboards | `[S]` | Prometheus | Visualizations work |
| Error alerting | `[S]` | Logging | Slack/email alerts |

---

## Phase 6: Production Readiness (Sprint 11-12)

### 6.1 Security Hardening

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Input sanitization | `[ ]` | All handlers | No injection possible |
| Address validation | `[x]` | Sui SDK | Only valid addresses |
| Amount validation | `[~]` | Handlers | No negative/overflow |
| Rate limiting (nginx layer) | `[ ]` | nginx | DDoS protection |
| Rate limiting (app layer) | `[ ]` | Redis | Per-user limits |
| CORS configuration | `[ ]` | Express | Only allowed origins |
| Security headers (nginx) | `[ ]` | nginx | CSP, HSTS, etc. |
| Helmet.js middleware | `[ ]` | Express | Additional headers |
| Environment secrets management | `[~]` | Deployment | No secrets in code |
| Secret rotation procedure | `[ ]` | Ops | Can rotate keys |
| Audit logging | `[ ]` | SQLite3 | All actions logged |
| PII minimization | `[ ]` | All services | Minimal data stored |

### 6.2 Testing

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Unit tests for handlers | `[ ]` | Vitest | 80%+ coverage |
| Unit tests for tools | `[ ]` | Vitest | All tools tested |
| Integration tests | `[ ]` | Vitest | API tests pass |
| E2E tests | `[ ]` | Playwright | User flows work |
| zkLogin flow tests | `[ ]` | E2E | Auth works end-to-end |
| Load testing | `[ ]` | k6 | 1000 req/s sustained |
| Security scan | `[ ]` | npm audit | No critical vulns |
| Dependency audit | `[ ]` | npm audit | No known CVEs |

### 6.3 Deployment

| Checkpoint | Status | Dependencies | Acceptance Criteria |
|------------|--------|--------------|---------------------|
| Dockerfiles created | `[ ]` | Docker | All services containerized |
| Docker images built | `[ ]` | Docker | Images < 500MB |
| Docker Compose (dev) | `[ ]` | Docker | All services run locally |
| Kubernetes manifests | `[ ]` | Docker | Deployments defined |
| ConfigMaps for config | `[ ]` | K8s | Non-secret config |
| Secrets management (K8s) | `[ ]` | K8s | Secrets encrypted |
| Horizontal Pod Autoscaler | `[ ]` | K8s | Scales on load |
| CI/CD pipeline | `[ ]` | GitHub Actions | Auto-deploy on merge |
| Staging environment | `[ ]` | K8s | Testnet deployment |
| Staging smoke tests | `[ ]` | CI/CD | Auto-validates deploy |
| Production environment | `[ ]` | K8s | Mainnet deployment |
| Blue-green deployment | `[S]` | K8s | Zero-downtime deploys |
| Rollback procedure | `[ ]` | K8s | Can revert in < 5min |
| Backup strategy | `[ ]` | SQLite3 | Daily backups |
| Disaster recovery plan | `[ ]` | Ops | Documented procedure |

---

## Architecture Overview

```
                                    ┌─────────────────────────────────────┐
                                    │           INTERNET                  │
                                    └──────────────┬──────────────────────┘
                                                   │
                                                   ▼
                              ┌────────────────────────────────────────────┐
                              │              nginx (Port 443)              │
                              │  • SSL/TLS Termination                     │
                              │  • Rate Limiting                           │
                              │  • Security Headers (CSP, HSTS, X-Frame)   │
                              │  • Static File Serving (Web dApp)          │
                              │  • Gzip Compression                        │
                              │  • Reverse Proxy to Node.js services       │
                              └───────┬────────────────┬───────────────────┘
                                      │                │
                    ┌─────────────────┘                └─────────────────┐
                    │                                                    │
                    ▼                                                    ▼
    ┌───────────────────────────────┐            ┌───────────────────────────────┐
    │   telegram-gateway (Node.js)  │            │      web-dapp (Static)        │
    │   Port 3001                   │            │   Served directly by nginx    │
    │   • Webhook handling          │            │   • Transaction signing       │
    │   • Message routing           │            │   • zkLogin OAuth             │
    │   • zkLogin client (external) │            │   • Wallet connection         │
    └───────────────┬───────────────┘            └───────────────────────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │     nlp-service (Node.js)     │
    │     Port 3002                 │
    │     • Gemini integration      │
    │     • Tool execution          │
    │     • Voice processing        │
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │  transaction-builder (Node.js)│
    │  Port 3003                    │
    │  • Sui SDK operations         │
    │  • TX construction            │
    │  • Gas estimation             │
    │  • Smart contract calls       │
    └───────────────────────────────┘
                    │
        ┌───────────┴───────────┬───────────────────────┬───────────────────────┐
        │                       │                       │                       │
        ▼                       ▼                       ▼                       ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────────────┐ ┌─────────────────────┐
│   SQLite3     │       │    Redis      │       │  External Mysten Labs │ │  Smart Contracts    │
│  (Volume)     │       │  Port 6379    │       │  APIs                 │ │  (Sui Blockchain)   │
│  • users.db   │       │  • Sessions   │       │  • salt.api.mystenlabs│ │  • BatchTransfer    │
│  • txs.db     │       │  • Rate limits│       │  • prover.mystenlabs  │ │  • ContactRegistry  │
│  • contacts   │       │  • Cache      │       │  • No local resources │ │  • SpendingGuardian │
└───────────────┘       └───────────────┘       └───────────────────────┘ └─────────────────────┘
```

> **Note:** Architecture optimized for 2GB RAM server. PostgreSQL replaced with SQLite3 (~400MB saved). zklogin-service removed in favor of external Mysten Labs APIs (~200MB saved). Smart contracts deployed on Sui blockchain for batch transfers, on-chain contacts, and spending limits.

---

## Dependency Graph

```
Phase 1 (Foundation)
    │
    ├─► Phase 2 (NLP) ──────────────────────┐
    │       │                               │
    │       └─► Phase 2.5 (Smart Contracts) │
    │               │                       │
    │               └─► Phase 3 (Auth) ─────┤
    │                       │               │
    │                       └─► Phase 4 ────┤
    │                           (Web dApp)  │
    │                               │       │
    └─► Phase 5 (Infrastructure) ◄──────────┘
            │
            └─► Phase 6 (Production)
```

---

## Critical Path

The following checkpoints are on the critical path and block multiple downstream tasks:

| # | Checkpoint | Blocks |
|---|------------|--------|
| 1 | **nginx reverse proxy setup** | All HTTPS traffic, SSL termination, security headers |
| 2 | **Telegram Bot Webhook** | All user interaction |
| 3 | **Gemini Function Calling** | All tool execution |
| 4 | **Smart Contract Deployment** | Batch transfers, on-chain contacts, spending limits |
| 5 | **zkLogin OAuth Flow (External APIs)** | All authentication |
| 6 | **Web dApp Transaction Preview** | All signing |
| 7 | **SQLite3 Schema Setup** | User data persistence |

---

## Quick Status Summary

| Phase | Total | Complete | In Progress | Planned | Stretch |
|-------|-------|----------|-------------|---------|---------|
| Phase 1: Foundation | 30 | 14 | 4 | 12 | 0 |
| Phase 2: NLP & Intelligence | 29 | 10 | 4 | 13 | 2 |
| **Phase 2.5: Smart Contracts** | **52** | **44** | **0** | **8** | **0** |
| **Phase 3: Authentication** | **42** | **30** | **3** | **6** | **3** |
| Phase 4: Web dApp | 28 | 16 | 1 | 11 | 0 |
| Phase 5: Infrastructure | 34 | 3 | 0 | 27 | 4 |
| Phase 6: Production | 35 | 1 | 2 | 30 | 2 |
| **TOTAL** | **250** | **118** | **14** | **107** | **11** |

**Overall Progress: ~53% complete (132/250 checkpoints done or in progress)**
