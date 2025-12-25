# AI Copilot Wallet - Product Specification Document

## Telegram Bot Natural Language Wallet Assistant for Sui Blockchain

**Document Version:** 0.6.3
**Last Updated:** December 25, 2025
**Classification:** Technical Product Specification
**Target Platform:** Telegram Bot + External Web dApp
**Target Network:** Sui Testnet (development) / Sui Mainnet (production)

---

## Implementation Status

> **📋 Full status details are maintained in [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md)**

This document is the functional specification. The separate status file tracks the current, reality-based implementation snapshot for the TypeScript/Express bot and React web dApp.

### Quick Summary

| Phase   | Description                        | Status |
| ------- | ---------------------------------- | ------ |
| Phase 1 | Foundation (Environment, Bot, SDK) | ✅ Core bot + Sui RPC flows live (Python/aiogram) |
| Phase 2 | NLP & Intelligence (Gemini, Tools) | ✅ Gemini tool calling working end-to-end |
| Phase 3 | Authentication (zkLogin, Wallets)  | ✅ Linking + Telegram HMAC + zkLogin flow marked complete |
| Phase 4 | Web dApp (Signing Interface)       | ✅ Linking/send pages working for signing flows |
| Phase 5 | Infrastructure (nginx, DB, Redis)  | ✅ VPS with nginx + Postgres + Docker containers running |
| Phase 6 | Production Readiness               | 🚧 MVP only; hardening/ops not started |

**Overall Progress: ~80% complete (Phases 1-5 functionally live; production hardening pending)**

**Current runtime reality:** Active bot is the **Python/aiogram** service in `/bot` using Gemini tool-calling; the TypeScript/Express services remain for pending-tx and linking APIs. Microservice folders (`nlp-service`, `zklogin-service`, `notification-service`) are placeholders; `transaction-builder` is active for zkLogin salt/JWT validation (Enoki-backed) and proof endpoints, while `user-service` is optional. The React web dApp handles linking, pending-tx fetch/consume, server-side ephemeral-key restore, zkLogin OAuth, and transaction signing.

---

## 1. Executive Summary

Caishen is a natural language wallet assistant delivered as a Telegram bot that enables users to interact with the Sui blockchain through conversational commands and voice input. The system operates on a "remote control" architecture where the Telegram bot serves as an intelligent command interpreter while all cryptographic signing operations occur in an external wallet application (Slush or any Sui-compatible wallet).

This architecture deliberately positions the Telegram bot as a non-custodial interface layer. The bot never handles private keys, seed phrases, or signing operations directly. Instead, it functions as an AI-powered transaction builder that generates deep links, QR codes, and transaction previews which users then confirm and sign in their sovereign wallet application.

The core value proposition is transforming complex blockchain interactions into simple natural language commands such as "Send 5 SUI to Alex" or "Show NFTs I bought yesterday" while maintaining the highest standards of security through complete separation of the AI interface from cryptographic operations.

---

## 2. Product Vision and Objectives

### 2.1 Primary Vision

The AI Copilot Wallet aims to eliminate the technical barriers that prevent mainstream users from participating in the Sui blockchain ecosystem. By accepting natural language commands in text or voice format, the system abstracts away the complexity of blockchain addresses, gas calculations, transaction encoding, and wallet interactions.

### 2.2 Core Objectives

The product is designed to achieve several interconnected objectives. First, it must provide accessibility by enabling users who have no technical blockchain knowledge to execute sophisticated wallet operations through plain English commands. Second, it must maintain security by ensuring that the Telegram bot environment never becomes a attack vector for fund theft since all signing happens externally. Third, it must offer convenience by allowing users to manage their Sui assets from within Telegram, an application they already use daily for communication. Fourth, it must deliver intelligence by leveraging large language models to understand context, remember user preferences, resolve ambiguous commands, and provide helpful transaction previews before execution.

### 2.3 Target Users

The primary target users include cryptocurrency holders who find existing wallet interfaces intimidating or cumbersome, Telegram power users who prefer to manage tasks through chat interfaces, users who frequently send small transactions and want a faster workflow than opening a dedicated wallet app, visually impaired users who benefit from voice-based interaction patterns, and developers and teams who want to integrate Sui wallet functionality into their Telegram-based workflows.

---

## 3. System Architecture Overview

### 3.1 Architectural Philosophy

The AI Copilot Wallet follows a strict separation of concerns principle that divides the system into three distinct layers: the Conversational Interface Layer, the Intelligence Processing Layer, and the Transaction Execution Layer. This separation ensures that compromise of any single layer does not result in loss of user funds.

The Telegram bot operates exclusively within the Conversational Interface Layer and portions of the Intelligence Processing Layer. It receives user input, processes natural language, builds unsigned transactions, and generates links to the external signing environment. At no point does the bot have access to private keys or the ability to broadcast signed transactions independently.

### 3.2 High-Level Architecture Diagram

The system architecture flows as follows: Users interact with the Telegram Bot through text messages or voice notes. The Telegram Bot sends user queries to the NLP layer (Gemini function calling) which parses intents and extracts parameters. The Telegram Bot invokes the appropriate Sui SDK Functions to build unsigned transactions. The Telegram Bot generates Deep Links or QR Codes pointing to the Web dApp. Users click the link and are taken to the Web dApp which connects to their External Wallet (Slush). The External Wallet signs the transaction and broadcasts it to the Sui Network. The Sui Network returns transaction confirmation back through the chain to the Telegram Bot which notifies the user.

> **Current implementation note:** The Python bot calls Gemini tools directly; the standalone `nlp-service` is a placeholder kept for future split-out.

### 3.3 Microservice Architecture

The target architecture is service-oriented, but the **current runtime is a Python/aiogram bot plus a React web dApp**, with optional Node services (transaction-builder active; others stubs). The TypeScript/Express scaffold remains for pending-tx and linking APIs.

#### 3.3.1 Service Definitions (v0.6.3 - Current Implementation Snapshot)

| Service | Responsibility | Technology Stack | Port | Status |
| --- | --- | --- | --- | --- |
| `bot-api` | Telegram webhook, Gemini calls, Sui RPC, pending-tx + linking APIs, ephemeral key storage, contact lookup via user-service | Python / aiogram | 3001 | **Active** |
| `web-dapp` | Signing interface, zkLogin OAuth, wallet connection, pending-tx fetch/consume | React / Vite / @mysten/dapp-kit | 5173 | **Active** |
| `postgres` | Users, wallet links, contacts, sessions, tx logs, zkLogin salts, ephemeral keys | PostgreSQL 16 | 5432 | **Active schema** |
| `user-service` | Contacts CRUD, session tokens, zkLogin salts (shared DB) | Node / Express | 3005 | **Partial** (HTTP endpoints live, integration optional) |
| `transaction-builder` | zkLogin salt service (fetches from Enoki, caches in DB), JWT validation, tx construction | Node / Express / PostgreSQL | 3003 | **Active** |
| `nlp-service` | Placeholder intent/tool API | Node / Express | 3002 | **Stub** (Gemini called directly by bot) |
| `zklogin-service` | Placeholder OAuth/prover API | Node / Express | 3004 | **Stub** |
| `notification-service` | Placeholder notification dispatcher | Node / Express | 3006 | **Stub** |
| `ts-bot` | TypeScript/Express scaffold with similar handlers | Node 20 / Express | 3001 | **Legacy scaffold** |
| `nginx` | SSL/TLS termination, reverse proxy, static file serving | nginx | 443/80 | **Active** |

> zkLogin functionality uses Enoki APIs for salt fetching and ZK proof generation. Salts are fetched from Enoki and cached in PostgreSQL for consistent address derivation. The standalone `zklogin-service` remains a stub to keep the option of self-hosted proving.

#### 3.3.2 Service Communication Patterns

> Target design for when services are split; the current Express bot handles these calls in-process.

**Synchronous Communication (HTTP/REST):**

Used for request-response patterns where immediate response is required.

```
┌─────────────────┐     HTTP/REST      ┌─────────────────┐
│  telegram-      │ ──────────────────▶│   api-gateway   │
│  gateway        │                    │                 │
└─────────────────┘                    └────────┬────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
                    ▼                           ▼                           ▼
          ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
          │   nlp-service   │        │ transaction-    │        │  zklogin-       │
          │                 │        │ builder         │        │  service        │
          └─────────────────┘        └─────────────────┘        └─────────────────┘
```

**Asynchronous Communication (Message Queue):**

Used for event-driven patterns, background processing, and decoupling services.

```
┌─────────────────┐                    ┌─────────────────┐
│  transaction-   │  ───── publish ──▶ │  Redis / Bull   │
│  builder        │                    │  Message Queue  │
└─────────────────┘                    └────────┬────────┘
                                                │
                              ┌─────────────────┼─────────────────┐
                              │ subscribe       │ subscribe       │ subscribe
                              ▼                 ▼                 ▼
                    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
                    │  notification-  │ │  telegram-      │ │  user-service   │
                    │  service        │ │  gateway        │ │                 │
                    └─────────────────┘ └─────────────────┘ └─────────────────┘
```

**Message Queue Events:**

| Event                     | Publisher           | Subscribers                                          | Purpose                            |
| ------------------------- | ------------------- | ---------------------------------------------------- | ---------------------------------- |
| `transaction.pending`     | transaction-builder | notification-service, telegram-gateway               | Notify user of pending transaction |
| `transaction.confirmed`   | transaction-builder | notification-service, telegram-gateway, user-service | Update user, log history           |
| `transaction.failed`      | transaction-builder | notification-service, telegram-gateway               | Alert user of failure              |
| `zklogin.session.created` | zklogin-service     | user-service                                         | Store session data                 |
| `zklogin.session.expired` | zklogin-service     | user-service, telegram-gateway                       | Prompt re-authentication           |
| `user.contact.added`      | user-service        | telegram-gateway                                     | Sync contact book                  |

#### 3.3.3 API Contracts

**API Gateway Routes:**

| Route                             | Method          | Target Service       | Description                  |
| --------------------------------- | --------------- | -------------------- | ---------------------------- |
| `/api/v1/telegram/webhook`        | POST            | telegram-gateway     | Telegram webhook endpoint    |
| `/api/v1/nlp/parse`               | POST            | nlp-service          | Parse natural language input |
| `/api/v1/nlp/tools`               | POST            | nlp-service          | Execute tool calls           |
| `/api/v1/tx/build`                | POST            | transaction-builder  | Build unsigned transaction   |
| `/api/v1/tx/estimate-gas`         | POST            | transaction-builder  | Estimate gas for transaction |
| `/api/v1/tx/status/:digest`       | GET             | transaction-builder  | Get transaction status       |
| `/api/v1/zklogin/init`            | POST            | zklogin-service (stub) | Initialize OAuth flow (planned) |
| `/api/v1/zklogin/callback`        | GET             | zklogin-service (stub) | OAuth callback handler (planned) |
| `/api/v1/zklogin/proof`           | POST            | transaction-builder  | Request ZK proof             |
| `/api/v1/zklogin/salt`            | POST            | transaction-builder  | Get/generate user salt       |
| `/api/v1/zklogin/verify-address`  | POST            | transaction-builder  | Verify derived zkLogin address |
| `/api/ephemeral`                  | POST            | bot-api              | Store ephemeral key for OAuth |
| `/api/ephemeral/{sessionId}`      | GET             | bot-api              | Retrieve ephemeral key (one-time) |
| `/api/pending-tx/:id`             | GET             | pending-tx API        | Fetch pending tx (one-time)  |
| `/api/pending-tx/:id`             | DELETE          | pending-tx API        | Consume pending tx           |
| `/api/v1/users/session`           | GET/POST        | user-service         | Session management           |
| `/api/v1/users/contacts`          | GET/POST/DELETE | user-service         | Contact book CRUD            |
| `/api/v1/users/preferences`       | GET/PUT         | user-service         | User preferences             |
| `/api/v1/notifications/subscribe` | POST            | notification-service | Subscribe to notifications   |

**Inter-Service API Contracts:**

```typescript
// nlp-service API Contract
interface NLPParseRequest {
  message: string;
  userId: string;
  conversationHistory: ConversationMessage[];
  userContext: {
    walletAddress: string;
    contacts: Contact[];
    preferences: UserPreferences;
  };
}

interface NLPParseResponse {
  intent:
    | 'send_sui'
    | 'send_token'
    | 'check_balance'
    | 'list_nfts'
    | 'transfer_nft'
    | 'conversation';
  confidence: number;
  toolCall?: {
    name: string;
    parameters: Record<string, any>;
  };
  response?: string;
}

// transaction-builder API Contract
interface BuildTransactionRequest {
  type: 'send_sui' | 'send_token' | 'transfer_nft';
  sender: string;
  params: {
    recipient: string;
    amount?: string;
    tokenType?: string;
    nftId?: string;
  };
  gasBudget?: number;
}

interface BuildTransactionResponse {
  transactionBytes: string;
  estimatedGas: string;
  preview: {
    action: string;
    details: string[];
    warnings: string[];
  };
  deepLink: string;
  qrCode: string;
}

// transaction-builder zkLogin API Contract
interface ZkLoginSaltRequest {
  jwt: string;
  telegramId?: string;
}

interface ZkLoginSaltResponse {
  salt: string;
  provider: string;
  subject: string;
  derivedAddress: string;
  keyClaimName: string;
}

interface ZkLoginProofRequest {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
  salt: string;
  keyClaimName: string;
  telegramId?: string;
}

interface ZkLoginProofResponse {
  proofPoints: {
    a: string[];
    b: string[][];
    c: string[];
  };
  issBase64Details: {
    value: string;
    indexMod4: number;
  };
  headerBase64: string;
}
```

#### 3.3.4 Data Ownership and Storage Architecture

The AI Copilot Wallet uses a Postgres-backed storage architecture for the live deployment, with short-lived in-memory caches for pending transactions and OAuth handoff.

**Backend Storage (Server-Side) - Current Runtime (PostgreSQL):**

| Service                | Owned Data                                              | Database      | Purpose               |
| ---------------------- | ------------------------------------------------------- | ------------- | --------------------- |
| `bot-api`              | Linking sessions, pending tx refs, ephemeral keys       | PostgreSQL 16 | Bot runtime data      |
| `transaction-builder`  | zkLogin salts (Enoki cached), JWT validation, tx logs   | PostgreSQL 16 | zkLogin + audit       |
| `user-service`         | Contacts, session tokens (optional)                    | PostgreSQL 16 | User data             |
| `pending-tx API`       | Pending tx payloads (one-time, TTL)                    | In-memory     | Secure signing links  |
| `nlp-service`          | Conversation history cache                             | Redis         | Context for NLP       |
| `notification-service` | Notification preferences, delivery logs                | Redis         | Push notifications    |

**zkLogin Authentication - Enoki APIs:**

Instead of running a local zklogin-service, the live deployment uses Enoki for salt + proving, with salts cached in PostgreSQL by transaction-builder.

| Service             | URL                                           | Purpose                        |
| ------------------- | --------------------------------------------- | ------------------------------ |
| Enoki Salt + Address | `https://api.enoki.mystenlabs.com/v1/zklogin` | Deterministic salt + address   |
| Enoki Prover        | `https://api.enoki.mystenlabs.com/v1/zklogin/zkp` | ZK proof generation        |

Enoki calls require `Authorization: Bearer $ENOKI_API_KEY` and the JWT in the `zklogin-jwt` header. The web dApp uses `VITE_ENOKI_API_KEY`, while backend services use `ENOKI_API_KEY`.

**Client-Side Storage (Web dApp):**

| Storage Type        | Data                                               | Purpose                            |
| ------------------- | -------------------------------------------------- | ---------------------------------- |
| IndexedDB           | Cached balances, NFT metadata, recent transactions | Fast reads, offline support        |
| Session Storage     | OAuth handoff sessionId, zkLogin state, tx params  | Short-lived; cleared after restore |
| Never Local Storage | Any long-lived secrets                             | Security best practice             |

**Legacy SQLite3 Schema (Optional 2GB Footprint Variant):**

The SQLite3 schema remains for low-memory deployments. The current production deployment uses PostgreSQL 16.

```sql
-- users.db (user-service)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER UNIQUE NOT NULL,
  sui_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_telegram_id INTEGER NOT NULL,
  contact_name TEXT NOT NULL,
  sui_address TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_telegram_id) REFERENCES users(telegram_user_id)
);

CREATE INDEX idx_contacts_owner ON contacts(owner_telegram_id);

-- transactions.db (transaction-builder)
CREATE TABLE transaction_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  tx_digest TEXT UNIQUE NOT NULL,
  tx_type TEXT NOT NULL,
  amount_mist INTEGER,
  recipient TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_txhistory_user ON transaction_history(telegram_user_id);
```

**Data Flow:**

```
┌─────────────────────────────────────────────────────────────────┐
│            DATA ARCHITECTURE (Legacy 2GB RAM Variant)           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────────────────────┐   │
│  │   user-service  │────▶│   SQLite3 (/data/users.db)      │   │
│  │   (backend)     │     │   • Telegram ↔ Wallet mappings  │   │
│  └─────────────────┘     │   • Contacts                    │   │
│                          └─────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────────────────────┐   │
│  │ transaction-    │────▶│   SQLite3 (/data/transactions.db)│   │
│  │ builder         │     │   • Transaction history         │   │
│  └─────────────────┘     │   • Pending transactions        │   │
│                          └─────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────────────────────┐   │
│  │ transaction-    │────▶│   Enoki zkLogin APIs            │   │
│  │ builder / web   │     │   • Salt: /v1/zklogin           │   │
│  └─────────────────┘     │   • Proof: /v1/zklogin/zkp      │   │
│                          └─────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────────────────────┐   │
│  │    Web dApp     │────▶│   IndexedDB (Browser)           │   │
│  │   (client)      │     │   • Cached balances/NFTs        │   │
│  └─────────────────┘     │   • Recent transaction cache    │   │
│          │               └─────────────────────────────────┘   │
│          │                                                      │
│          │               ┌─────────────────────────────────┐   │
│          └──────────────▶│   Session Storage (Browser)     │   │
│                          │   • OAuth sessionId             │   │
│                          │   • zkLogin state (no keys)     │   │
│                          │   • Current session state       │   │
│                          └─────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.3.5 Service Discovery

Services discover each other through environment-based configuration in development and Kubernetes DNS in production.

**Development (Docker Compose):**

```yaml
services:
  nlp-service:
    environment:
      - TRANSACTION_BUILDER_URL=http://transaction-builder:3003
      - USER_SERVICE_URL=http://user-service:3005
```

**Production (Kubernetes):**

```yaml
# Services are discovered via Kubernetes DNS
# Format: <service-name>.<namespace>.svc.cluster.local
env:
  - name: TRANSACTION_BUILDER_URL
    value: 'http://transaction-builder.ai-copilot.svc.cluster.local:3003'
```

#### 3.3.6 Circuit Breakers & Resilience

Each service implements circuit breaker patterns to handle failures gracefully.

```typescript
// Circuit breaker configuration
import CircuitBreaker from 'opossum';

const nlpServiceBreaker = new CircuitBreaker(callNlpService, {
  timeout: 10000, // 10 second timeout
  errorThresholdPercentage: 50, // Open circuit if 50% fail
  resetTimeout: 30000, // Try again after 30 seconds
  volumeThreshold: 10 // Minimum requests before tripping
});

nlpServiceBreaker.fallback(() => ({
  intent: 'conversation',
  response: "I apologize, but I'm having trouble processing your request. Please try again."
}));

nlpServiceBreaker.on('open', () => {
  logger.warn('NLP Service circuit breaker opened');
  alertOps('NLP Service degraded');
});
```

**Resilience Patterns:**

| Pattern            | Implementation           | Purpose                        |
| ------------------ | ------------------------ | ------------------------------ |
| Circuit Breaker    | Opossum / Hystrix        | Prevent cascade failures       |
| Retry with Backoff | Exponential backoff      | Handle transient failures      |
| Timeout            | Per-service configurable | Prevent hanging requests       |
| Bulkhead           | Semaphore limiting       | Isolate resource pools         |
| Fallback           | Graceful degradation     | Maintain partial functionality |

#### 3.3.7 Deployment Specifications

**Docker Containerization:**

Each service has its own Dockerfile:

```dockerfile
# Example: nlp-service Dockerfile (Node.js/TypeScript)
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

EXPOSE 3002

CMD ["node", "dist/index.js"]
```

**Kubernetes Deployment:**

```yaml
# Example: nlp-service deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nlp-service
  namespace: ai-copilot
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nlp-service
  template:
    metadata:
      labels:
        app: nlp-service
    spec:
      containers:
        - name: nlp-service
          image: ai-copilot/nlp-service:latest
          ports:
            - containerPort: 3002
          env:
            - name: GOOGLE_AI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: ai-copilot-secrets
                  key: google-ai-api-key
          resources:
            requests:
              memory: '512Mi'
              cpu: '250m'
            limits:
              memory: '1Gi'
              cpu: '500m'
          livenessProbe:
            httpGet:
              path: /health
              port: 3002
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /ready
              port: 3002
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: nlp-service
  namespace: ai-copilot
spec:
  selector:
    app: nlp-service
  ports:
    - port: 3002
      targetPort: 3002
```

**Docker Compose (Development - 2GB RAM Optimized):**

```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - '443:443'
      - '80:80'
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./services/web-dapp/out:/usr/share/nginx/html:ro
    depends_on:
      - telegram-gateway
      - api-gateway
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 64M

  api-gateway:
    image: nginx:alpine
    expose:
      - '8080'
    volumes:
      - ./nginx/api-gateway.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - telegram-gateway
      - nlp-service
      - transaction-builder
      - user-service

  telegram-gateway:
    build: ./services/telegram-gateway
    expose:
      - '3001'
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - NLP_SERVICE_URL=http://nlp-service:3002
      - REDIS_URL=redis://redis:6379
      # Enoki zkLogin APIs (salt + proof)
      - ENOKI_API_KEY=${ENOKI_API_KEY}
      - ZKLOGIN_SALT_SERVICE_URL=http://transaction-builder:3003/api/v1/zklogin/salt
      - ZKLOGIN_PROVER_URL=${ZKLOGIN_PROVER_URL:-https://api.enoki.mystenlabs.com/v1/zklogin/zkp}
    depends_on:
      - redis

  nlp-service:
    build: ./services/nlp-service
    expose:
      - '3002'
    environment:
      - GOOGLE_AI_API_KEY=${GOOGLE_AI_API_KEY}
      - TRANSACTION_BUILDER_URL=http://transaction-builder:3003
      - USER_SERVICE_URL=http://user-service:3005

  transaction-builder:
    build: ./services/transaction-builder
    expose:
      - '3003'
    environment:
      - SUI_RPC_URL=${SUI_RPC_URL}
      - REDIS_URL=redis://redis:6379
      - SQLITE_DB_PATH=/data/transactions.db
    volumes:
      - sqlite_data:/data

  user-service:
    build: ./services/user-service
    expose:
      - '3005'
    environment:
      - SQLITE_DB_PATH=/data/users.db
      - REDIS_URL=redis://redis:6379
    volumes:
      - sqlite_data:/data

  notification-service:
    build: ./services/notification-service
    expose:
      - '3006'
    environment:
      - REDIS_URL=redis://redis:6379

  redis:
    image: redis:7-alpine
    expose:
      - '6379'
    command: redis-server --appendonly yes --maxmemory 64mb --maxmemory-policy allkeys-lru

volumes:
  sqlite_data:
```

> **Note:** This legacy 2GB RAM configuration removes PostgreSQL and uses SQLite; current deployments use PostgreSQL 16. zkLogin uses Enoki for salt/proof, with salts cached in Postgres.

**nginx Configuration (nginx/nginx.conf):**

```nginx
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    access_log /var/log/nginx/access.log main;

    # Performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript
               application/xml application/xml+rss text/javascript;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=30r/m;
    limit_req_zone $binary_remote_addr zone=webhook_limit:10m rate=100r/s;

    # Upstream definitions
    upstream telegram_gateway {
        server telegram-gateway:3001;
        keepalive 32;
    }

    upstream api_gateway {
        server api-gateway:8080;
        keepalive 32;
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name your-domain.com;

        # SSL configuration
        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_session_timeout 1d;
        ssl_session_cache shared:SSL:50m;
        ssl_session_tickets off;

        # Modern TLS configuration
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
        ssl_prefer_server_ciphers off;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://fullnode.testnet.sui.io;" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # Telegram webhook endpoint (high rate limit)
        location /api/v1/telegram/webhook {
            limit_req zone=webhook_limit burst=50 nodelay;
            proxy_pass http://telegram_gateway;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # API routes (standard rate limit)
        location /api/ {
            limit_req zone=api_limit burst=10 nodelay;
            proxy_pass http://api_gateway;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Static files for web dApp (served directly by nginx)
        location / {
            root /usr/share/nginx/html;
            index index.html;
            try_files $uri $uri/ /index.html;

            # Cache static assets
            location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
                expires 1y;
                add_header Cache-Control "public, immutable";
            }
        }

        # Health check
        location /health {
            return 200 'healthy';
            add_header Content-Type text/plain;
        }
    }

    # HTTP to HTTPS redirect
    server {
        listen 80;
        listen [::]:80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }
}
```

### 3.4 Component Responsibilities

**Telegram Bot Server (telegram-gateway):** This component handles all Telegram API interactions including receiving messages, sending responses, managing conversation state, and delivering rich media such as QR codes and inline keyboards. It maintains user session data, processes voice notes through speech-to-text conversion, and orchestrates the flow between the nlp-service and the Sui SDK.

**NLP Service (Google AI Studio / Gemini Integration):** This component receives natural language input and returns structured tool calls via Google AI Studio API (Gemini models). It maintains conversation context to resolve ambiguous references like "send it to him" where "him" refers to a previously mentioned contact. It validates that extracted parameters are reasonable before passing them to transaction builders and generates human-readable transaction summaries for user confirmation.

**Sui SDK Integration Layer:** This component constructs unsigned transaction payloads using the official Sui TypeScript SDK. It queries the Sui network for account balances, NFT holdings, transaction history, and object data. It calculates gas estimates and validates that the sender has sufficient balance. It serializes transactions into formats suitable for external wallet signing.

**Web dApp (Signing Interface):** This component provides a minimal web interface that receives transaction payloads via URL parameters or local storage. It connects to user wallets through Sui Wallet Kit standard connectors. It displays comprehensive transaction previews including all effects, gas costs, and warnings. It handles the actual signing ceremony and transaction broadcast. It reports transaction results back to the Telegram bot via webhook or polling.

**External Wallet (Slush or Compatible):** This component stores private keys securely in a browser extension or mobile application. It presents signing requests to users with full transaction details. It signs transactions only upon explicit user approval. It broadcasts signed transactions to the Sui network.

---

## 4. Detailed Component Specifications

### 4.1 Telegram Bot Implementation

#### 4.1.1 Bot Registration and Configuration

The Telegram bot must be registered through BotFather with appropriate commands configured. The bot requires the following command registrations: /start for initiating conversation and linking wallet, /help for displaying available commands and usage examples, /balance for checking current SUI and token balances, /send for initiating a send transaction through natural language, /nfts for viewing owned NFT collection, /history for viewing recent transaction history, /settings for configuring preferences and connected addresses, and /disconnect for unlinking wallet connection.

#### 4.1.2 Message Processing Pipeline

Every incoming message passes through a standardized processing pipeline. The first stage is Input Reception where the bot receives the Telegram Update object containing the message, sender information, and chat context. The second stage is Input Normalization where voice messages are transcribed using Google Cloud Speech-to-Text or Gemini multimodal, text messages are cleaned of extraneous formatting, and all input is converted to a standardized string format. The third stage is Context Assembly where the system retrieves the user's session data including linked wallet address, recent conversation history, known contacts and their addresses, and user preferences. The fourth stage is NLP Processing where the normalized input and context are sent to the nlp-service (Google AI Studio / Gemini) which returns either a tool call specification or a conversational response. The fifth stage is Tool Execution where, if a tool call is returned, the appropriate Sui SDK function is invoked with the extracted parameters. The sixth stage is Response Generation where results are formatted into user-friendly messages with appropriate inline keyboards, buttons, or media attachments. The seventh stage is Response Delivery where the formatted response is sent back to the user via the Telegram API.

#### 4.1.3 Session State Management

The bot maintains session state for each user in a persistent data store. Session data includes the linked Sui wallet address (public address only, never private keys), a contact book mapping friendly names to Sui addresses, conversation history limited to the most recent fifty messages for context, pending transactions awaiting signature confirmation, user preferences including default gas budget and preferred display currency, and the authentication method and related session data.

**Session Expiration Strategy:**

For zkLogin users, session expiration is tied directly to the zkLogin `maxEpoch` value. This provides a single source of truth for session validity:

```typescript
interface ZkLoginSession {
  telegramUserId: string;
  zkLoginAddress: string;
  ephemeralKeyPair: EncryptedKeyPair; // Stored encrypted
  zkProof: PartialZkLoginSignature;
  maxEpoch: number; // Session expires when current_epoch > maxEpoch
  randomness: string;
  userSalt: string; // Retrieved from salt service
}

// Session validity is determined by blockchain epoch
async function isSessionValid(session: ZkLoginSession): Promise<boolean> {
  const { epoch } = await suiClient.getLatestSuiSystemState();
  return Number(epoch) <= session.maxEpoch;
}
```

**Benefits of epoch-based expiration:**

- Single source of truth (blockchain epoch)
- ZK proof and session always expire together
- No separate timeout logic to maintain
- Typical epoch duration is ~24 hours on Sui

For external wallet users (Slush), sessions expire after 24 hours of inactivity as a security measure.

Session data is encrypted at rest and associated with the user's Telegram user ID.

### 4.2 NLP Service Tool System (Google AI Studio Function Calling)

#### 4.2.1 Tool Architecture Overview

The nlp-service is configured with a set of tools (functions) using Google AI Studio's function calling feature that it can invoke based on user intent. Each tool has a defined schema specifying its parameters, required inputs, and return types. The Gemini model does not execute these tools directly; rather, it returns a structured specification of which tool to call and with what parameters, which the bot server then executes via the transaction-builder service.

#### 4.2.2 Core Tool Definitions

**build_send_sui_tx Tool**

This tool constructs an unsigned transaction for sending SUI tokens to a recipient address.

```typescript
function build_send_sui_tx(params: {
  recipient: string; // Sui address or contact name
  amount: number; // Amount in SUI (not MIST)
  sender: string; // Sender's Sui address
  gas_budget?: number; // Optional gas budget override
}): UnsignedTransaction;
```

The tool resolves contact names to addresses using the user's contact book, converts SUI amounts to MIST (1 SUI = 1,000,000,000 MIST), validates that the sender has sufficient balance including gas, and returns a serialized unsigned transaction ready for signing.

**build_send_token_tx Tool**

This tool constructs an unsigned transaction for sending fungible tokens other than SUI.

```typescript
function build_send_token_tx(params: {
  recipient: string; // Sui address or contact name
  amount: number; // Amount in token's display units
  token_type: string; // Fully qualified token type
  sender: string; // Sender's Sui address
  gas_budget?: number; // Optional gas budget override
}): UnsignedTransaction;
```

The tool looks up the token's decimal places for proper amount conversion, finds the appropriate coin objects to use as input, handles coin splitting if necessary to send exact amounts, and includes SUI for gas payment separate from the token transfer.

**list_recent_nfts Tool**

This tool retrieves NFTs acquired by the user within a specified time window.

```typescript
function list_recent_nfts(params: {
  owner: string; // Owner's Sui address
  since?: string; // ISO 8601 timestamp (default: 24h ago)
  collection?: string; // Optional collection filter
  limit?: number; // Maximum results (default: 20)
}): NFTListResult;
```

The tool queries the Sui indexer for objects matching NFT standards, filters by acquisition timestamp using transaction history, retrieves display metadata including images, names, and descriptions, and groups results by collection for organized presentation.

**get_balance Tool**

This tool retrieves the current balance of SUI and other tokens for a wallet.

```typescript
function get_balance(params: {
  address: string; // Wallet address to query
  include_tokens?: boolean; // Include non-SUI tokens (default: true)
  include_staked?: boolean; // Include staked SUI (default: true)
}): BalanceResult;
```

The tool queries the Sui RPC for all coin objects owned by the address, aggregates balances by coin type, retrieves current USD values if price feeds are available, and includes staking information if requested.

**get_transaction_history Tool**

This tool retrieves recent transactions for a wallet address.

```typescript
function get_transaction_history(params: {
  address: string; // Wallet address
  limit?: number; // Maximum transactions (default: 10)
  filter?: string; // 'sent' | 'received' | 'all'
}): TransactionHistoryResult;
```

The tool queries the Sui indexer for transactions involving the address, categorizes transactions as sent, received, or contract interactions, extracts human-readable summaries of each transaction, and includes timestamps, amounts, and counterparty information.

**resolve_contact Tool**

This tool resolves a contact name or partial address to a full Sui address.

```typescript
function resolve_contact(params: {
  query: string; // Contact name or partial address
  user_id: string; // Telegram user ID for contact book lookup
}): ResolvedAddress | null;
```

The tool searches the user's contact book for matching names, supports Sui Name Service (SNS) resolution for .sui names, validates that the resolved address is a valid Sui address format, and returns null if no match is found prompting Gemini to ask for clarification.

**build_nft_transfer_tx Tool**

This tool constructs an unsigned transaction for transferring an NFT.

```typescript
function build_nft_transfer_tx(params: {
  nft_id: string; // Object ID of the NFT
  recipient: string; // Recipient address or contact name
  sender: string; // Current owner's address
}): UnsignedTransaction;
```

The tool verifies that the sender owns the specified NFT, checks that the NFT is transferable and not locked, builds the appropriate transfer transaction based on NFT standard, and includes proper type arguments for the transfer call.

#### 4.2.3 Gemini System Instruction

Gemini runs under a system instruction that:

- Names the assistant **Caishen**, the god of wealth reborn as a Telegram bot who helps users make payments and keep funds secure.
- States Caishen never holds keys, never signs, and only builds unsigned transactions or deep links for users to sign externally.
- Demands confirmation of every risky action (sends, listings, transfers) with clear summaries (amount, asset, recipient, fees, effects) before building.
- Requires tool-first behavior: use balance/history/contact/tx-builder tools; ask clarifying questions when intent or parameters are ambiguous.
- Requires security warnings for unverified addresses, large amounts, missing gas, or stale proofs; refuse unsafe or impossible actions.
- Keeps responses concise but, when chatting, sprinkles short, wise sayings or proverbs about prudence and wealth when appropriate—without blocking transactional clarity.
- Supports voice-to-text inputs and keeps context tight to avoid over-long replies.

The prompt includes example user queries mapped to tool calls so Caishen’s behavior stays consistent across phrasings.

### 4.3 Sui SDK Integration

#### 4.3.1 SDK Configuration

The Sui SDK integration layer connects to the Sui network through configurable RPC endpoints.

**Development Configuration (Testnet):**

```typescript
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

// For development, use Testnet
const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });

// Alternative: explicit URL
const TESTNET_URL = 'https://fullnode.testnet.sui.io:443';
const suiClientExplicit = new SuiClient({ url: TESTNET_URL });
```

**Production Configuration (Mainnet with Failover):**

For production deployments, multiple RPC endpoints should be configured with automatic failover:

```typescript
import CircuitBreaker from 'opossum';

const RPC_ENDPOINTS = [
  'https://fullnode.mainnet.sui.io:443', // Primary: Mysten Labs
  'https://sui-mainnet.nodeinfra.com' // Backup: NodeInfra
  // Add other providers: Shinami, BlockVision, etc.
];

class SuiClientWithFailover {
  private clients: SuiClient[];
  private currentIndex = 0;

  constructor(endpoints: string[]) {
    this.clients = endpoints.map((url) => new SuiClient({ url }));
  }

  async getBalance(address: string) {
    const breaker = new CircuitBreaker(
      () => this.clients[this.currentIndex].getBalance({ owner: address }),
      { timeout: 5000, errorThresholdPercentage: 50 }
    );

    breaker.fallback(() => {
      this.currentIndex = (this.currentIndex + 1) % this.clients.length;
      return this.clients[this.currentIndex].getBalance({ owner: address });
    });

    return breaker.fire();
  }
}
```

**Current Development Target:** Sui Testnet

#### 4.3.2 Transaction Building Process

All transactions follow a standardized building process. The first step is Parameter Validation where all input parameters are validated for format correctness and the sender address is verified to exist and have sufficient balance. The second step is Object Resolution where required input objects such as coins and NFTs are fetched from the network, and object versions are recorded to ensure transaction validity. The third step is Transaction Construction where a TransactionBlock is created using the Sui SDK, all necessary Move calls are added to the block, and gas budget is set based on estimate or user preference. The fourth step is Serialization where the unsigned transaction is serialized to base64 format and a transaction digest is computed for reference. The fifth step is Deep Link Generation where a URL is constructed pointing to the web dApp with the serialized transaction as a parameter.

#### 4.3.3 Gas Estimation Strategy

Gas estimation follows a conservative approach to prevent transaction failures. The system executes a dry-run of the transaction against a recent network state to get the base computation cost. It then adds a twenty percent buffer to account for state changes between estimation and execution. User-specified gas budgets override estimates only if they exceed the estimated minimum. For complex transactions, the system warns users if gas costs exceed typical thresholds.

### 4.4 Web dApp Signing Interface

#### 4.4.1 Purpose and Scope

The web dApp serves as the bridge between the Telegram bot's transaction building capabilities and the user's external wallet. It is intentionally minimal, focusing solely on transaction preview and signing facilitation. The dApp does not store long-lived user data or require user accounts beyond wallet connection, but it does keep short-lived session state for zkLogin OAuth handoff (sessionId) and pending-tx retrieval.

#### 4.4.2 Transaction Flow

When a user clicks a deep link from Telegram, the following sequence occurs. The first step is URL Parsing where the dApp extracts a one-time pending transaction ID (`tx`) or direct params for manual links; if `tx` is present, it fetches transaction details from `/api/pending-tx/:id` (one-time use) and then cleans the URL. The second step is Transaction Decoding where the base64 transaction is deserialized and parsed into human-readable components. The third step is Preview Rendering where a comprehensive transaction preview is displayed showing all operations, affected objects, estimated gas cost, recipient addresses with any available labels, and warnings for unusual patterns. The fourth step is Wallet Connection where the user is prompted to connect their wallet if not already connected, with support for Slush and other Sui Wallet Kit compatible wallets. If a `sender` param or OAuth callback is detected, the UI locks to zkLogin mode and hides the wallet/zkLogin switcher, showing a "zkLogin Mode" badge. The fifth step is Signature Request where upon user confirmation, the transaction is sent to the connected wallet for signing. The sixth step is Broadcast where after the wallet returns a signature, the signed transaction is broadcast to the Sui network. The seventh step is Result Reporting where the transaction result including success or failure status and transaction digest is displayed to the user and optionally reported back to the Telegram bot via webhook.

#### 4.4.3 Security Considerations

The web dApp implements several security measures. It validates that transaction parameters match expected patterns before displaying previews. It displays clear warnings for transactions involving large amounts or unfamiliar addresses. It implements rate limiting to prevent abuse. It uses Content Security Policy headers to prevent XSS attacks. It enforces sender matching (connected wallet or derived zkLogin address) before signing and validates nonce/epoch when restoring zkLogin sessions. It does not execute any transaction without explicit user action and does not store any long-lived secrets in browser storage.

### 4.5 zkLogin Authentication System

#### 4.5.1 zkLogin Overview

zkLogin is a Sui native primitive that enables users to send transactions from a Sui address using an OAuth credential (such as Google, Facebook, Twitch, or Apple) without publicly linking the two. This provides a powerful alternative authentication mechanism for the AI Copilot Wallet that eliminates the need for users to manage traditional cryptographic keys or remember mnemonics.

The AI Copilot Wallet integrates zkLogin as a primary authentication option, allowing users to create and access their Sui wallet using familiar OAuth login flows directly through the Telegram bot interface. This significantly lowers the barrier to entry for mainstream users who may not have prior experience with cryptocurrency wallets.

#### 4.5.2 zkLogin Design Goals

zkLogin is designed with several critical objectives that align perfectly with the AI Copilot Wallet's mission. For streamlined onboarding, zkLogin enables users to transact on Sui using the familiar OAuth login flow, removing the need to handle cryptographic keys or remember mnemonics. For self-custody, a zkLogin transaction requires user approval through the standard OAuth login process, and the OAuth provider cannot transact on the user's behalf. For security, zkLogin is a two-factor authentication scheme where sending a transaction requires both a credential from a recent OAuth login and a salt not managed by the OAuth provider, meaning an attacker who compromises an OAuth account cannot transact from the user's Sui address unless they also compromise the salt. For privacy, zero-knowledge proofs prevent third parties from linking a Sui address with its corresponding OAuth identifier. For accessibility, zkLogin is one of several native Sui signature schemes thanks to Sui's cryptography agility, and it integrates with other Sui primitives such as sponsored transactions and multisig.

#### 4.5.3 How zkLogin Works

At a high level, the zkLogin protocol operates through the following mechanism. A JWT (JSON Web Token) is a signed payload from OAuth providers that includes a user-defined field named nonce. zkLogin uses the OpenID Connect OAuth flow by defining the nonce as a public key and an expiry epoch. The wallet stores an ephemeral key pair, where the ephemeral public key is defined in the nonce. The ephemeral private key signs transactions for a short session. A Groth16 zero-knowledge proof is generated from the JWT, which conceals sensitive fields. A transaction is submitted on-chain with the ephemeral signature and the zero-knowledge proof. Sui authorities execute the transaction after verifying the ephemeral signature and the proof. Instead of deriving the Sui address based on a public key, the zkLogin address is derived from the subject identifier (sub), the provider identifier (iss), the application identifier (aud), and a user salt value that unlinks the OAuth identifier from the on-chain address.

#### 4.5.4 The Complete zkLogin Flow

The complete zkLogin authentication flow for the AI Copilot Wallet proceeds through ten distinct steps.

**Step 0 (Prerequisite):** zkLogin uses Groth16 for zkSNARK instantiation, which requires a common reference string (CRS) linked to the circuit. A ceremony generates the CRS, which is used to produce the proving key in the proving service and the verifying key in Sui authorities. The zkLogin ceremony included contributions from more than 100 participants and has been independently audited.

**Steps 1-3:** The user logs in to an OpenID provider (OP) to obtain a JWT containing a nonce. The user generates an ephemeral key pair (eph_sk, eph_pk) and embeds eph_pk, expiry times (max_epoch), and randomness (jwt_randomness) into the nonce. After login, the JWT appears in the redirect URL in the application.

**Steps 4-5:** The application frontend sends the JWT to a salt service. The service returns the unique user_salt based on iss, aud, and sub.

**Steps 6-7:** The user sends the JWT, user salt, ephemeral public key, JWT randomness, and key claim name (for example, sub) to the proving service. The proving service generates a zero-knowledge proof that confirms the nonce is derived correctly, confirms the key claim value matches the corresponding JWT field, verifies the RSA signature from the provider on the JWT, and confirms the address is consistent with the key claim and user salt.

**Step 8:** The application computes the user address based on iss, aud, and sub.

**Steps 9-10:** The user signs the transaction with the ephemeral private key and submits it with the ephemeral signature, ZK proof, and other inputs to Sui. Sui authorities verify the ZK proof against the provider's JWKs (stored by consensus) and the ephemeral signature.

#### 4.5.5 zkLogin Entities in the AI Copilot Wallet Architecture

The zkLogin implementation involves three key entities. The Application Frontend (Telegram Bot and Web dApp) is responsible for storing the ephemeral private key, directing users to complete the OAuth login flow, creating and signing zkLogin transactions. The Salt Backup Service is a backend service responsible for returning a salt per unique user, with various strategies available for salt management. The ZK Proving Service is a backend service responsible for generating ZK proofs based on JWT, JWT randomness, user salt, and max epoch, with this proof submitted on-chain along with the ephemeral signature for a zkLogin transaction.

#### 4.5.6 zkLogin Address Definition

The zkLogin address is computed from several inputs. The address flag (zk_login_flag = 0x05) serves as a domain separator for zkLogin addresses. The key claim name field (kc_name_F) contains the name of the key claim, such as "sub", mapped to a field element. The key claim value field (kc_value_F) contains the value of the key claim mapped using hashBytesToField. The audience field (aud_F) contains the relying party identifier. The issuer field (iss) contains the OpenID Provider identifier. The user_salt is a value introduced to unlink the OAuth identifier with the on-chain address.

The final address is derived as: zk_login_address = Blake2b_256(zk_login_flag, iss_L, iss, addr_seed) where addr_seed = Poseidon_BN254(kc_name_F, kc_value_F, aud_F, Poseidon_BN254(user_salt)).

#### 4.5.7 Supported OpenID Providers

The AI Copilot Wallet supports the following OAuth providers for zkLogin authentication on Sui Mainnet: Google, Facebook, Twitch, Apple, AWS (Tenant), Karrier One, and Credenza3. Additional providers including Slack, Kakao, and Microsoft are available on Devnet and Testnet. Providers under review for future support include RedBull, Amazon, WeChat, Auth0, and Okta.

#### 4.5.8 zkLogin Key Terminology

Several key terms are essential to understanding zkLogin implementation. The OpenID Provider (OP) is the OAuth 2.0 authorization server capable of authenticating the end-user and providing claims to a relying party, identified in the iss field in the JWT payload. The Relying Party (RP) or client is the OAuth 2.0 client application requiring end-user authentication, assigned by the OP when the developer creates the application and identified in the aud field. The Subject Identifier (sub) is a locally unique and never reassigned identifier within the issuer for the end user, used as the key claim to derive the user address. The JSON Web Key (JWK) is a JSON data structure representing a set of public keys for an OP, queryable from a public endpoint. The JSON Web Token (JWT) is found in the redirect URI after OAuth login and contains a header, payload, and signature.

#### 4.5.9 zkLogin Notations

Several notations are used throughout the zkLogin implementation. The ephemeral key pair (eph_sk, eph_pk) refers to the private and public key used for ephemeral signatures, stored only for a short session and refreshable upon new OAuth sessions. The nonce is an application-defined field embedded in the JWT payload, computed as the hash of the ephemeral public key, JWT randomness, and the maximum epoch. The extended ephemeral public key (ext_eph_pk) is the byte representation of an ephemeral public key (flag || eph_pk). The user_salt is a value introduced to unlink the OAuth identifier with the on-chain address. The max_epoch is the epoch at which the JWT expires (u64 in Sui). The key claim name (kc_name) is the claim name such as "sub", and the key claim value (kc_value) is the claim value such as the user's subject identifier.

#### 4.5.10 zkLogin Security Model

The zkLogin security model addresses several artifact types. For JWT security, the JWT's validity is scoped on the client ID (aud) to prevent phishing attacks, and the same origin policy for the proof prevents JWTs obtained for malicious applications from being used. A leaked JWT does not mean loss of funds as long as the corresponding ephemeral private key is safe. For user salt security, the user salt is required for both ZK proof generation and zkLogin address derivation. A leaked salt does not mean loss of funds but enables an attacker to associate the user's subject identifier with the Sui address. For ephemeral private key security, the key's lifespan is tied to the maximum epoch specified in nonce. If misplaced, a new key can be generated with a fresh ZK proof. For proof security, obtaining the proof alone cannot create a valid zkLogin transaction because an ephemeral signature over the transaction is also needed.

#### 4.5.11 zkLogin Privacy Guarantees

By default, there is no linking between the OAuth subject identifier and a Sui address due to the user salt. The JWT is not published on-chain by default. The revealed values include iss, aud, and kid so that the public input hash can be computed, while sensitive fields such as sub are used as private inputs when generating the proof. The ZK proving service and salt service can link user identity since the user salt and JWT are known to them, but both services are stateless by design.

#### 4.5.12 zkLogin vs Traditional Wallet Comparison

Traditional private key wallets demand users to consistently recall mnemonics and passphrases, necessitating secure storage to prevent fund loss. A zkLogin wallet only requires ephemeral private key storage with session expiry and the OAuth login flow with expiry. Forgetting an ephemeral key does not result in loss of funds because a user can always sign in again to generate a new ephemeral key and a new ZK proof.

zkLogin is fundamentally different from MPC or Multisig wallets. Those approaches rely on splitting keys or distributing key shares with threshold signing. zkLogin does not split any individual private keys; ephemeral private keys are registered using a fresh nonce when the user authenticates. The primary advantage is that the user does not need to manage any persistent private key anywhere.

#### 4.5.13 zkLogin Integration Architecture for AI Copilot Wallet

The AI Copilot Wallet implements zkLogin as an alternative to external wallet connection (Slush). In the current implementation, the web dApp generates the ephemeral key pair. For send-funds flows it stores the key server-side via `/api/ephemeral` (one-time retrieval, TTL) and keeps only a sessionId in sessionStorage; for linking flows it stores the key in sessionStorage. The OAuth provider returns a JWT to the web dApp callback URL. The web dApp retrieves the ephemeral key, fetches the user's salt from transaction-builder (Enoki-backed), requests a ZK proof from Enoki, derives the zkLogin address, and validates it against any sender parameter before signing. The derived address and proof are used to sign transactions until maxEpoch expires.

#### 4.5.14 zkLogin Key Differentiators

zkLogin provides several key differentiators compared to other social login solutions for Web3. Native Support in Sui means zkLogin transactions can be combined with Multisig and sponsored transactions seamlessly. Self-Custodial without additional trust is achieved because Sui leverages the nonce field in JWT to commit to the ephemeral public key, so no persistent private key management is required. Full privacy is maintained because nothing is required to submit on-chain except the ZK proof and the ephemeral signature. Compatibility with Existing Identity Providers means no need to trust intermediate identity issuers or verifiers other than the OAuth providers themselves.

#### 4.5.15 zkLogin Implementation Guide

This section provides detailed implementation specifications for integrating zkLogin into the AI Copilot Wallet.

**SDK Installation**

The zkLogin TypeScript SDK is installed as part of the main Sui SDK:

```bash
npm install @mysten/sui
# or
yarn add @mysten/sui
# or
pnpm add @mysten/sui
```

**Step 1: Generate Ephemeral Key Pair and Nonce**

The wallet must generate an ephemeral key pair and compute the nonce for the OAuth flow:

```typescript
import { generateNonce, generateRandomness } from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

// Use testnet for development
const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
const { epoch } = await suiClient.getLatestSuiSystemState();

const maxEpoch = Number(epoch) + 2; // Active for 2 epochs (~2 days)
const ephemeralKeyPair = new Ed25519Keypair();
const randomness = generateRandomness();
const nonce = generateNonce(ephemeralKeyPair.getPublicKey(), maxEpoch, randomness);
```

**Step 2: OAuth Provider URL Construction**

Each OAuth provider requires a specific URL format. The following table shows the auth flow URLs for supported providers:

| Provider  | Auth Flow URL                                                                                                                                                                       | Auth Flow Only               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Google    | `https://accounts.google.com/o/oauth2/v2/auth?client_id=$CLIENT_ID&response_type=id_token&redirect_uri=$REDIRECT_URL&scope=openid&nonce=$NONCE`                                     | Yes                          |
| Facebook  | `https://www.facebook.com/v17.0/dialog/oauth?client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URL&scope=openid&nonce=$NONCE&response_type=id_token`                                      | Yes                          |
| Twitch    | `https://id.twitch.tv/oauth2/authorize?client_id=$CLIENT_ID&force_verify=true&lang=en&login_type=login&redirect_uri=$REDIRECT_URL&response_type=id_token&scope=openid&nonce=$NONCE` | Yes                          |
| Apple     | `https://appleid.apple.com/auth/authorize?client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URL&scope=email&response_mode=form_post&response_type=code%20id_token&nonce=$NONCE`           | Yes                          |
| Kakao     | `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URL&nonce=$NONCE`                                                           | No (requires token exchange) |
| Slack     | `https://slack.com/openid/connect/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URL&nonce=$NONCE&scope=openid`                                           | No (requires token exchange) |
| Microsoft | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=$CLIENT_ID&scope=openid&response_type=id_token&nonce=$NONCE&redirect_uri=$REDIRECT_URL`                   | Yes                          |

For providers marked "No" for Auth Flow Only, an additional POST call to the Token Exchange URL is required to retrieve the JWT using the authorization code.

**Step 3: JWT Decoding**

Upon successful OAuth redirect, the JWT is extracted from the URL:

```typescript
// Example redirect URL:
// http://host/auth?id_token=tokenPartA.tokenPartB.tokenPartC

import { jwtDecode } from 'jwt-decode';

interface JwtPayload {
  iss?: string; // Issuer
  sub?: string; // Subject ID
  aud?: string | string[]; // Audience
  exp?: number; // Expiration
  nbf?: number; // Not before
  iat?: number; // Issued at
  jti?: string; // JWT ID
}

const decodedJwt = jwtDecode(encodedJWT) as JwtPayload;
```

**Step 4: User Salt Management**

The AI Copilot Wallet implements user salt management with the following options:

Option 1 (Client Side - User Input): Request user input for the salt during wallet access, transferring responsibility to the user who must remember it.

Option 2 (Client Side - Browser Storage): Store in browser or mobile storage with proper workflows to prevent loss during device changes. Email the salt during new wallet setup as backup.

Option 3 (Backend - Database): Store a mapping from user identifier (sub) to user salt in a conventional database. The salt is unique per user.

Option 4 (Backend - Derived): Implement a service with a master seed value and derive user salt using key derivation: `HKDF(ikm = seed, salt = iss || aud, info = sub)`. Note: This option does not allow rotation of master seed or change in client ID.

Example request to Enoki salt API (used by transaction-builder):

```bash
curl -X GET https://api.enoki.mystenlabs.com/v1/zklogin \
  -H "Authorization: Bearer $ENOKI_API_KEY" \
  -H "zklogin-jwt: $JWT_TOKEN"

# Response: {"data":{"salt":"129390038577185583942388216820280642146","address":"0x..."}}
```

**Step 5: Compute zkLogin Address**

```typescript
import { jwtToAddress } from '@mysten/sui/zklogin';

const zkLoginUserAddress = jwtToAddress(jwt, userSalt);
```

**Step 6: Generate Zero-Knowledge Proof**

Generate the extended ephemeral public key and request the ZK proof:

```typescript
import { getExtendedEphemeralPublicKey } from '@mysten/sui/zklogin';

const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(ephemeralKeyPair.getPublicKey());

// Enoki expects the raw Sui public key; self-hosted provers may require extendedEphemeralPublicKey.

// Request proof from Enoki (current default)
const proofResponse = await fetch('https://api.enoki.mystenlabs.com/v1/zklogin/zkp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ENOKI_API_KEY}`,
    'zklogin-jwt': jwtToken
  },
  body: JSON.stringify({
    network: 'testnet',
    ephemeralPublicKey: ephemeralKeyPair.getPublicKey().toSuiPublicKey(),
    maxEpoch: maxEpoch,
    randomness: randomness,
    salt: userSalt
  })
});
```

The proof response contains:

- `proofPoints`: The Groth16 proof points (a, b, c)
- `issBase64Details`: Base64 encoded issuer details
- `headerBase64`: Base64 encoded JWT header

**Step 7: Assemble and Submit Transaction**

```typescript
import { genAddressSeed, getZkLoginSignature } from '@mysten/sui/zklogin';
import { Transaction } from '@mysten/sui/transactions';

// Sign transaction with ephemeral key
const txb = new Transaction();
txb.setSender(zkLoginUserAddress);

const { bytes, signature: userSignature } = await txb.sign({
  client: suiClient,
  signer: ephemeralKeyPair
});

// Generate address seed
const addressSeed = genAddressSeed(
  BigInt(userSalt),
  'sub',
  decodedJwt.sub,
  decodedJwt.aud
).toString();

// Create zkLogin signature
const zkLoginSignature = getZkLoginSignature({
  inputs: {
    ...partialZkLoginSignature,
    addressSeed
  },
  maxEpoch,
  userSignature
});

// Execute transaction
await suiClient.executeTransactionBlock({
  transactionBlock: bytes,
  signature: zkLoginSignature
});
```

#### 4.5.16 Self-Hosted Proving Service Configuration

For production deployments, the AI Copilot Wallet can run its own ZK proving service using Docker:

**Prerequisites:**

1. Install Git Large File Storage (git-lfs)
2. Download the Groth16 proving key (zkey file)

```bash
# For Mainnet/Testnet
wget -O - https://raw.githubusercontent.com/sui-foundation/zklogin-ceremony-contributions/main/download-main-zkey.sh | bash

# For Devnet
wget -O - https://raw.githubusercontent.com/sui-foundation/zklogin-ceremony-contributions/main/download-test-zkey.sh | bash
```

**Docker Compose Configuration:**

```yaml
services:
  backend:
    image: mysten/zklogin:prover-stable
    volumes:
      - ${ZKEY}:/app/binaries/zkLogin.zkey
    environment:
      - ZKEY=/app/binaries/zkLogin.zkey
      - WITNESS_BINARIES=/app/binaries

  frontend:
    image: mysten/zklogin:prover-fe-stable
    command: '8080'
    ports:
      - '${PROVER_PORT}:8080'
    environment:
      - PROVER_URI=http://backend:8080/input
      - NODE_ENV=production
      - DEBUG=zkLogin:info,jwks
      - PROVER_TIMEOUT=30
```

**Launch Command:**

```bash
ZKEY=/path/to/zkLogin.zkey PROVER_PORT=8080 docker compose up
```

**Endpoints:**

- `/ping`: Health check (returns "pong")
- `/v1`: Proof generation endpoint

**Hardware Requirements:**

- Minimum: 16 cores, 16GB RAM
- Recommended: Higher specifications for reduced proof generation time
- Default timeout: 15 seconds (configurable via PROVER_TIMEOUT)

#### 4.5.17 Caching Strategy for Ephemeral Keys and ZK Proofs

The ZK proof is tied to the ephemeral key pair and can be reused for any number of transactions until the key expires (when current epoch exceeds maxEpoch).

**Security Requirements for Caching:**

- Ephemeral key pairs must be treated as secrets
- If both ephemeral private key and ZK proof are compromised, attackers can sign transactions on behalf of the user
- Never store in insecure persistent storage

**Browser Storage Recommendations:**

- Use session storage (automatically clears when browser session ends)
- Never use local storage (persists indefinitely)
- Encrypt stored values when possible

**Mobile Storage Recommendations:**

- Use secure keychain/keystore APIs
- Implement biometric authentication for access
- Clear on logout or session timeout

#### 4.5.18 Efficiency and Performance Considerations

**Proof Generation Time:**

- Typical: ~3 seconds on 16 vCPU / 64GB RAM machine
- Can be reduced with physical CPUs or GPUs

**Scaling Metrics:**

- Primary metric: Number of active user sessions (not signatures)
- ZK proofs are cached and reused across session
- Example: 1 million daily active users ≈ 1-2 requests per second (assuming even distribution)

**CORS Handling:**
To avoid CORS errors in frontend applications, delegate proving service calls to a backend service:

```typescript
// Frontend calls internal API
const proofResponse = await post('/your-internal-api/zkp/get', zkpRequestPayload);

// Backend proxies to proving service
// This avoids CORS issues with direct browser calls
```

#### 4.5.19 Complete zkLogin Implementation Walkthrough

This section provides a complete step-by-step implementation guide with concrete examples and actual values to demonstrate the entire zkLogin flow.

**Step 1: Generate Ephemeral Key Pair**

The ephemeral key pair is used to sign the TransactionBlock. It should be stored in the browser session (Session Storage) for security.

```typescript
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const ephemeralKeyPair = new Ed25519Keypair();
```

Example generated key pair:

```json
// PrivateKey (stored securely in session storage)
{
  "schema": "ED25519",
  "privateKey": "I6p9je7wjBuULP/XpSrEk4ZbPxHwxR2DIcysT4eOM6Q="
}

// PublicKey
"Qlkd5j6wMcj3VYBc/hPdOjXyIHeVBJMd8wmsBL7MzuU="
```

**Step 2: Fetch JWT from OpenID Provider**

Required parameters for OAuth URL construction:

| Parameter       | Description                                                                    |
| --------------- | ------------------------------------------------------------------------------ |
| `$CLIENT_ID`    | Obtained by applying for OpenID Service from provider (Google, Facebook, etc.) |
| `$REDIRECT_URL` | App URL, configured in OpenID Service dashboard                                |
| `$NONCE`        | Generated through ephemeralKeyPair, maxEpoch, and randomness                   |

The nonce generation requires:

- `ephemeralKeyPair`: Ephemeral key pair generated in Step 1
- `maxEpoch`: Validity period of the ephemeral key pair (current epoch + desired validity)
- `randomness`: Cryptographically secure random value

```typescript
import { generateRandomness, generateNonce } from '@mysten/sui/zklogin';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

// Get current epoch from network (testnet for development)
const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
const { epoch } = await suiClient.getLatestSuiSystemState();

// Set validity period (e.g., 10 epochs from now)
const maxEpoch = Number(epoch) + 10;

// Generate randomness
const randomness = generateRandomness();
// Example: "300841038864761771188854787182935492433"

// Generate nonce for acquiring JWT
const nonce = generateNonce(ephemeralKeyPair.getPublicKey(), maxEpoch, randomness);
```

Construct the OAuth URL and redirect the user:

```typescript
// Google OAuth URL example
const googleOAuthUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}&` +
  `response_type=id_token&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URL)}&` +
  `scope=openid&` +
  `nonce=${nonce}`;

// Redirect user to OAuth provider
window.location.href = googleOAuthUrl;
```

**Step 3: Decode JWT**

After successful OAuth login, the JWT is returned in the URL query parameter `id_token`. The JWT has three parts: Header.Payload.Signature.

Example JWT (truncated for readability):

```
eyJhbGciOiJSUzI1NiIsImtpZCI6ImQ1NDNlMjFhMDI3M2VmYzY2YTQ3NTAwMDI0NDFjYjIxNTFjYjIzNWYiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiI1NzMxMjAwNzA4NzEtMGs3Z2E2bnM3OWllMGpwZzFlaTZpcDV2amUyb3N0dDYuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLC...
```

Decode the JWT to extract the payload:

```typescript
import { jwtDecode, JwtPayload } from 'jwt-decode';

// Extract id_token from URL
const urlParams = new URLSearchParams(window.location.search);
const idToken = urlParams.get('id_token');

// Decode JWT
const decodedJwt = jwtDecode(idToken) as JwtPayload;
```

Example decoded JWT payload:

```json
{
  "iss": "https://accounts.google.com",
  "azp": "573120070871-0k7ga6ns79ie0jpg1ei6ip5vje2ostt6.apps.googleusercontent.com",
  "aud": "573120070871-0k7ga6ns79ie0jpg1ei6ip5vje2ostt6.apps.googleusercontent.com",
  "sub": "105978399173243203700",
  "nonce": "y26BtI8rf_mKCmsE3bHvxvjwjqo",
  "nbf": 1765360569,
  "iat": 1765360869,
  "exp": 1765364469,
  "jti": "aa65cedd24f4d2ed51d8aee60f6a3335b7186962"
}
```

JWT Payload Field Definitions:

| Field   | Name            | Description                                              |
| ------- | --------------- | -------------------------------------------------------- |
| `iss`   | Issuer          | The OAuth provider (e.g., "https://accounts.google.com") |
| `aud`   | Audience        | JWT consumer, same as CLIENT_ID                          |
| `sub`   | Subject         | User identifier, unique for each user at this provider   |
| `nonce` | Nonce           | The nonce value generated and included in OAuth URL      |
| `nbf`   | Not Before      | Token is not valid before this timestamp                 |
| `iat`   | Issued At       | Timestamp when token was issued                          |
| `exp`   | Expiration Time | Token expiration timestamp                               |
| `jti`   | JWT ID          | Unique identifier for this specific JWT                  |

**Step 4: Generate User's Salt**

User Salt is used to eliminate the one-to-one correspondence between the OAuth identifier (sub) and the on-chain Sui address, avoiding linking Web2 credentials with Web3 credentials.

**CRITICAL: The Salt must be safeguarded. If lost, users cannot recover the address generated with that Salt.**

Salt Storage Options:

| Option | Method                              | Pros                      | Cons                            |
| ------ | ----------------------------------- | ------------------------- | ------------------------------- |
| 1      | Ask user to remember (email backup) | User has full control     | User may forget/lose it         |
| 2      | Client-side storage (browser)       | Simple implementation     | Lost on browser change/clear    |
| 3      | Backend database (mapped to UID)    | Reliable, recoverable     | Requires backend infrastructure |
| 4      | Derived from master seed (HKDF)     | Deterministic, no storage | Cannot change client ID         |

Example user salt:

```
66747900439110801809150225063963701124
```

**Step 5: Generate User's Sui Address**

The user's Sui address is determined by `sub`, `iss`, `aud`, and `user_salt` together. For the same JWT, `sub`, `iss`, and `aud` will not change with each login, ensuring address consistency.

```typescript
import { jwtToAddress } from '@mysten/sui/zklogin';

const zkLoginUserAddress = jwtToAddress(idToken, userSalt);
// Example result: "0xa6ee249081c8756dc9d4ec6923eb3ff01b8ae32552341264da269034701e3819"
```

The generated address is a standard Sui address that can:

- Receive SUI and tokens
- Hold NFTs
- Interact with smart contracts
- Be used in multisig configurations

**Step 6: Fetch ZK Proof (Groth16)**

This is the proof (ZK Proof) for the ephemeral key pair, used to demonstrate the validity of the ephemeral key pair.

First, generate the extended ephemeral public key as input for the ZKP:

```typescript
import { getExtendedEphemeralPublicKey } from '@mysten/sui/zklogin';

const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(ephemeralKeyPair.getPublicKey());
// Example: "30010103753294492494391102626894509861136899734142293129709516527737179524837"
```

Use the extended ephemeral public key to generate ZK Proof via the proving service:

```typescript
import axios from 'axios';

const ENOKI_PROVER_URL = 'https://api.enoki.mystenlabs.com/v1/zklogin/zkp';

const zkProofResult = await axios.post(
  ENOKI_PROVER_URL,
  {
    network: 'testnet',
    ephemeralPublicKey: ephemeralKeyPair.getPublicKey().toSuiPublicKey(),
    maxEpoch: maxEpoch,
    randomness: randomness,
    salt: userSalt
  },
  {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ENOKI_API_KEY}`,
      'zklogin-jwt': idToken
    }
  }
);

const partialZkLoginSignature = zkProofResult.data as PartialZkLoginSignature;
```

Example ZK Proof response:

```json
{
  "proofPoints": {
    "a": [
      "17839702513054838724176985982891157091988790540559429338434831768193836575332",
      "9304211106615002962350405252001555759906390924855774530298546215432712607645",
      "1"
    ],
    "b": [
      [
        "982664116542628970061153563633984885015453580069914007473992200175459282202",
        "13097354918961997780558797158352219249552180267348928486622602927255495877797"
      ],
      [
        "4218728118252521281112754775732973453790490663960438999757820751098299175239",
        "17490133308306568916558508497570532009601599703750277259279838220552582352646"
      ],
      ["1", "0"]
    ],
    "c": [
      "17832830093179421026690101261200604598380018557839544733154791552523301808536",
      "17186672574362796317932919720742850095521508353914258799154711929916831380298",
      "1"
    ]
  },
  "issBase64Details": {
    "value": "yJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLC",
    "indexMod4": 1
  },
  "headerBase64": "eyJhbGciOiJSUzI1NiIsImtpZCI6ImQ1NDNlMjFhMDI3M2VmYzY2YTQ3NTAwMDI0NDFjYjIxNTFjYjIzNWYiLCJ0eXAiOiJKV1QifQ"
}
```

**Step 7: Assemble zkLogin Signature and Submit Transaction**

Each ZK Proof is associated with an ephemeral key pair. When stored appropriately, it can be reused to sign any number of transactions until the ephemeral key pair expires (when current epoch exceeds maxEpoch).

**IMPORTANT: Before executing transactions, the zkLogin address must have SUI for gas fees.**

Complete transaction example (transfer 1 SUI):

```typescript
import { Transaction } from '@mysten/sui/transactions';
import { getZkLoginSignature, genAddressSeed } from '@mysten/sui/zklogin';
import { MIST_PER_SUI } from '@mysten/sui/utils';
import { SerializedSignature } from '@mysten/sui/cryptography';

// Create transaction
const txb = new Transaction();

// Transfer 1 SUI to recipient address
const [coin] = txb.splitCoins(txb.gas, [MIST_PER_SUI * 1n]);
txb.transferObjects([coin], '0xfa0f8542f256e669694624aa3ee7bfbde5af54641646a3a05924cf9e329a8a36');

// Set sender as zkLogin address
txb.setSender(zkLoginUserAddress);

// Sign with ephemeral key pair
const { bytes, signature: userSignature } = await txb.sign({
  client: suiClient,
  signer: ephemeralKeyPair
});

// Generate addressSeed using userSalt, sub, and aud from JWT payload
const addressSeed: string = genAddressSeed(
  BigInt(userSalt),
  'sub',
  decodedJwt.sub,
  decodedJwt.aud as string
).toString();

// Assemble complete zkLogin signature
const zkLoginSignature: SerializedSignature = getZkLoginSignature({
  inputs: {
    ...partialZkLoginSignature,
    addressSeed
  },
  maxEpoch,
  userSignature
});

// Execute transaction on Sui network
const result = await suiClient.executeTransactionBlock({
  transactionBlock: bytes,
  signature: zkLoginSignature
});

console.log('Transaction digest:', result.digest);
```

**Key Points for Transaction Execution:**

1. The `addressSeed` is generated from `userSalt`, `sub` (subject), and `aud` (audience) from the JWT payload
2. The `zkLoginSignature` combines the ZK proof, addressSeed, maxEpoch, and ephemeral signature
3. The same ZK proof can sign multiple transactions until the ephemeral key expires
4. Always ensure the zkLogin address has sufficient SUI balance for gas fees before transacting

#### 4.5.20 zkLogin Session Management Best Practices

**Session Storage Strategy:**

```typescript
// Store session data securely
interface ZkLoginSession {
  ephemeralKeyPair: {
    schema: string;
    privateKey: string;
  };
  maxEpoch: number;
  randomness: string;
  userSalt: string;
  zkProof: PartialZkLoginSignature;
  zkLoginAddress: string;
  expiresAt: number;
}

// Save to session storage (cleared when browser closes)
const saveSession = (session: ZkLoginSession) => {
  sessionStorage.setItem('zklogin_session', JSON.stringify(session));
};

// Load session
const loadSession = (): ZkLoginSession | null => {
  const data = sessionStorage.getItem('zklogin_session');
  if (!data) return null;

  const session = JSON.parse(data) as ZkLoginSession;

  // Check if session has expired
  if (Date.now() > session.expiresAt) {
    sessionStorage.removeItem('zklogin_session');
    return null;
  }

  return session;
};

// Clear session on logout
const clearSession = () => {
  sessionStorage.removeItem('zklogin_session');
};
```

**Session Validation:**

```typescript
// Check if current epoch exceeds maxEpoch
const isSessionValid = async (session: ZkLoginSession): Promise<boolean> => {
  const { epoch } = await suiClient.getLatestSuiSystemState();
  return Number(epoch) <= session.maxEpoch;
};

// Refresh session if needed
const ensureValidSession = async (): Promise<ZkLoginSession> => {
  const session = loadSession();

  if (!session || !(await isSessionValid(session))) {
    // Session expired, redirect to OAuth login
    redirectToOAuth();
    throw new Error('Session expired, please login again');
  }

  return session;
};
```

### 4.6 Voice Input Processing

#### 4.6.1 Speech-to-Text Integration with Gemini Multimodal

The system supports voice input through Telegram's voice message feature. Telegram does NOT provide built-in voice-to-text transcription for bots, so we handle this using Gemini's multimodal capabilities.

**Recommended Approach: Gemini Multimodal (Single API Call)**

Gemini 2.0 Flash can process audio directly and return both transcription AND intent in a single call, making it the most efficient option:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

async function processVoiceMessage(
  audioBuffer: Buffer,
  userContext: UserContext
): Promise<NLPResponse> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools // Same tool definitions as text processing
  });

  // Convert audio to base64
  const audioBase64 = audioBuffer.toString('base64');

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'audio/ogg', // Telegram voice format
        data: audioBase64
      }
    },
    {
      text: `You are Caishen, a Sui blockchain wallet assistant. 
Process this voice message from the user.
User's wallet: ${userContext.walletAddress}
User's contacts: ${JSON.stringify(userContext.contacts)}

First transcribe the audio, then determine the user's intent and respond appropriately.
Use tools when needed for wallet operations.`
    }
  ]);

  const response = result.response;

  // Check for function calls (same as text processing)
  const functionCalls = response.functionCalls();
  if (functionCalls && functionCalls.length > 0) {
    return {
      intent: mapFunctionToIntent(functionCalls[0].name),
      confidence: 0.95,
      toolCall: {
        name: functionCalls[0].name,
        parameters: functionCalls[0].args
      },
      transcription: extractTranscription(response)
    };
  }

  return {
    intent: 'conversation',
    confidence: 1.0,
    response: response.text(),
    transcription: extractTranscription(response)
  };
}
```

**Fallback Approach: Google Cloud Speech-to-Text**

For edge cases or when Gemini multimodal is unavailable:

```typescript
import speech from '@google-cloud/speech';

const speechClient = new speech.SpeechClient();

async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const [response] = await speechClient.recognize({
    audio: { content: audioBuffer.toString('base64') },
    config: {
      encoding: 'OGG_OPUS',
      sampleRateHertz: 48000,
      languageCode: 'en-US',
      speechContexts: [
        {
          phrases: ['SUI', 'MIST', 'NFT', 'wallet', 'send', 'transfer', 'balance'],
          boost: 20
        }
      ]
    }
  });

  return response.results?.map((r) => r.alternatives?.[0]?.transcript).join(' ') || '';
}
```

**Voice Message Flow:**

```
User sends voice note
        │
        ▼
┌────────────────────────┐
│ Telegram Bot downloads │
│ OGG audio file         │
└────────────┬───────────┘
             │
             ▼
┌────────────────────────┐
│ Gemini Multimodal      │
│ (single API call)      │
│                        │
│ Input: Audio + Context │
│ Output: Transcription  │
│         + Intent       │
│         + Tool Call    │
└────────────┬───────────┘
             │
             ▼
┌────────────────────────┐
│ Execute tool or send   │
│ conversational reply   │
└────────────────────────┘
```

#### 4.6.2 Voice-Specific Considerations

Voice input introduces unique challenges that the system addresses. For transcription accuracy, the system uses a custom vocabulary hint including common cryptocurrency terms like SUI, MIST, NFT, and wallet. For number handling, the system implements fuzzy matching for spoken numbers such as interpreting "five" as "5". For confirmation, transactions initiated by voice always include an explicit text confirmation step before generating signing links. For error handling, if transcription confidence is low, the system asks the user to confirm or retype their request.

#### 4.6.3 Real-Time Transcription (Stretch Goal)

The stretch goal implementation includes real-time transcription display where users can see their speech being transcribed as they speak. This requires establishing a WebSocket connection between the bot server and a streaming speech-to-text service. Partial transcription results are sent to the user as "typing" indicators. The final transcription is displayed before processing begins, giving users a chance to correct errors.

---

## 5. Security Architecture

### 5.1 Threat Model

The security architecture is designed to protect against several categories of threats. The first category is Bot Server Compromise where even if an attacker gains full control of the bot server, they cannot steal funds because no private keys are stored there and all transactions require external wallet signatures or zkLogin proofs. The second category is Man-in-the-Middle Attacks where all communication channels use TLS encryption and transaction payloads include checksums to detect tampering. The third category is Social Engineering where the system implements confirmation flows that require users to review transaction details before signing. The fourth category is Phishing where the web dApp is hosted on a verified domain and users are educated to only sign transactions from the official interface. The fifth category is OAuth Compromise where for zkLogin users, even if an attacker compromises the OAuth account, they cannot access funds without also compromising the user's salt, making zkLogin effectively a two-factor authentication scheme.

### 5.2 Authentication Options Security Comparison

The AI Copilot Wallet supports two authentication mechanisms, each with distinct security properties.

**External Wallet Authentication (Slush/Sui Wallet Kit):** Security relies on the external wallet's key management. The Telegram bot never handles private keys. Transaction signing occurs entirely in the external wallet application. Users must secure their wallet's seed phrase or private key independently.

**zkLogin Authentication:** Security relies on the combination of OAuth credentials and user salt. No persistent private keys are stored anywhere in the system. Ephemeral keys are generated per session and automatically expire. Two-factor security ensures that compromising either OAuth account or salt alone is insufficient to access funds. The ZK proof system ensures privacy by not revealing OAuth identifiers on-chain.

### 5.3 zkLogin-Specific Security Considerations

For zkLogin implementations, several security properties must be maintained. JWT tokens are validated against the client ID (aud) to prevent cross-application attacks. The salt service must be secured and rate-limited to prevent brute-force attacks. Ephemeral private keys must be stored in encrypted session storage with appropriate expiration. The ZK proving service must be authenticated and rate-limited. Session expiration (max_epoch) should be set to reasonable values balancing convenience and security.

### 5.4 Data Protection

User data is protected through multiple mechanisms. Session data is encrypted using AES-256 before storage. Database access requires authentication and is logged. Contact books are stored with the user's Telegram ID as the encryption key salt. No financial data beyond public addresses is permanently stored. Voice recordings are deleted immediately after transcription.

### 5.5 API Security

All API endpoints implement security best practices. The Telegram webhook endpoint validates the secret token on all incoming requests. The Google AI Studio API calls use authenticated endpoints with API keys stored in environment variables. The Sui RPC calls use authenticated endpoints where available. Rate limiting is implemented at multiple levels to prevent abuse.

---

## 6. User Experience Specifications

### 6.1 Onboarding Flow

New users experience the following onboarding sequence designed to feel as familiar as Web2 applications.

**Step 1: Initial Contact**

The user sends /start to the bot and receives a welcome message explaining the bot's capabilities.

**Step 2: Wallet Selection**

The user is presented with three options:

```
┌─────────────────────────────────────────┐
│  👋 Welcome to AI Copilot Wallet!       │
│                                         │
│  Do you have a Sui wallet?              │
│                                         │
│  [🆕 Create New Wallet]                 │
│  [📥 I have a Slush Wallet]             │
│  [📱 I have another Sui Wallet]         │
└─────────────────────────────────────────┘
```

**Path A: Create New Wallet (zkLogin - Recommended for New Users)**

This path provides a Web2-like experience with no seed phrases or private keys to manage:

```
┌─────────────────────────────────────────┐
│  Create your wallet with:               │
│                                         │
│  [Google]    [Facebook]                 │
│  [Apple]     [Twitch]                   │
│                                         │
│  ℹ️ No seed phrase needed!               │
│  Just sign in like any other app.       │
└─────────────────────────────────────────┘
```

1. User clicks their preferred OAuth provider button
2. User completes standard OAuth login in browser
3. System generates ephemeral key pair and ZK proof
4. zkLogin Sui address is computed and linked to Telegram account
5. User is ready to transact immediately

**Path B: Import Slush Wallet (External Wallet)**

For users who already have a Slush wallet:

```
┌─────────────────────────────────────────┐
│  Connect your Slush wallet:             │
│                                         │
│  [🔗 Connect Wallet]                    │
│                                         │
│  This will open our web app where       │
│  you can securely connect Slush.        │
└─────────────────────────────────────────┘
```

1. User clicks "Connect Wallet" button
2. Web dApp opens with wallet connection interface
3. User connects Slush and signs a verification message
4. Wallet address is linked to Telegram account
5. All signing will happen in Slush wallet

**Path C: Import Other Sui Wallet**

For users with other Sui-compatible wallets:

1. User is prompted to enter their public Sui address
2. System validates the address format
3. User signs a verification message via the web dApp
4. Address is linked to Telegram account

**Step 3: Contact Import (Optional)**

The user can import contacts by sending a list of names and addresses or by connecting to their wallet's address book if supported.

**Step 4: Tutorial**

The bot sends a series of example commands the user can try, starting with low-risk read operations like balance checks before progressing to transaction building.

```
┌─────────────────────────────────────────┐
│  ✅ You're all set!                       │
│                                         │
│  Try these commands:                    │
│  • "What's my balance?"                 │
│  • "Show my NFTs"                       │
│  • "Send 1 SUI to alice.sui"            │
│                                         │
│  Or just chat naturally!                │
└─────────────────────────────────────────┘
```

### 6.2 Transaction Confirmation Flow

All write operations follow a consistent confirmation pattern. The first step is Intent Recognition where the user sends a natural language command like "Send 5 SUI to Alex". The second step is Parameter Extraction where Gemini extracts recipient (Alex), amount (5 SUI), and infers sender from session. The third step is Clarification (if needed) where, if any parameter is ambiguous, the bot asks a clarifying question such as "I found two contacts named Alex. Did you mean Alex Chen (0x1234...) or Alex Wong (0x5678...)?" The fourth step is Transaction Preview where the bot displays a formatted summary showing the action (Send SUI), amount (5.000000000 SUI), recipient (Alex Chen at the resolved address), estimated gas cost, and total deduction from wallet. The fifth step is Signing Link where the user receives an inline button labeled "Sign Transaction" that opens the web dApp. The sixth step is External Signing where the user reviews and signs in their wallet. The seventh step is Confirmation where the bot receives the transaction result and sends a confirmation message with the transaction digest and explorer link.

### 6.3 Error Handling

The system provides helpful error messages for common failure scenarios. For insufficient balance errors, the message explains that the wallet only has a certain amount of SUI available and the transaction requires more including gas. For invalid address errors, the message explains that the address format is invalid and provides the expected format. For contact not found errors, the message explains that no contact was found and prompts adding them. For network errors, the message explains that the Sui network is currently experiencing issues and prompts the user to try again. For transaction failure errors, the message explains that the transaction failed and provides the specific reason from the network.

### 6.4 Inline Keyboard Layouts

The bot makes extensive use of Telegram's inline keyboard feature for quick actions. Balance display keyboards include buttons for Send SUI, Receive (showing a QR code), and Refresh. NFT display keyboards include buttons for Transfer, View on Explorer, and Show More. Transaction confirmation keyboards include buttons for Sign Transaction, Edit Amount, and Cancel. History display keyboards include buttons for Previous Page, Next Page, and Filter.

---

## 7. Technical Requirements

### 7.1 Infrastructure Requirements

The production deployment requires the following infrastructure. The bot server needs two or more instances behind a load balancer with four GB RAM minimum per instance, persistent storage for session data, and outbound internet access for API calls. The database requires PostgreSQL 14 or higher with encryption at rest, automated backups with a minimum of seven days retention, and read replicas for high availability. The web dApp requires static hosting via CDN, an SSL certificate for the custom domain, and a fallback error page for maintenance. Monitoring requires logging aggregation via a service such as DataDog or CloudWatch, alerting for error rates and latency thresholds, and uptime monitoring for all endpoints.

### 7.2 Performance Requirements

The system must meet the following performance targets. Message response time must have a p95 under two seconds for read operations and a p95 under five seconds for transaction building. Voice transcription must have a p95 under three seconds for messages up to thirty seconds in length. Transaction confirmation must have webhook delivery within five seconds of network confirmation. The system must support concurrent users with at minimum one thousand simultaneous active sessions. Availability must be at minimum 99.9% uptime measured monthly.

### 7.3 Scalability Considerations

The architecture supports horizontal scaling through several mechanisms. Bot servers (telegram-gateway) are stateless with session data in external storage (Redis). The nlp-service scales independently and can be load-balanced. Database read replicas can be added for query scaling. The CDN-hosted web dApp scales automatically with demand.

---

## 8. Integration Specifications

### 8.1 Telegram Bot API Integration

The bot uses the Telegram Bot API version 9.2 with webhook mode for receiving updates. Required API methods include setWebhook, sendMessage, sendPhoto, answerCallbackQuery, editMessageText, editMessageReplyMarkup, getFile (for voice notes), and sendChatAction (for typing indicators). The webhook endpoint must be HTTPS with a valid certificate. Long polling mode is supported as a fallback for development environments.

**Key Telegram Bot API 9.2 Features Used:**

- Inline keyboards with callback data
- Voice message handling (OGG/OPUS format)
- Deep linking for wallet connection
- Message editing for real-time updates
- Webhook with secret token validation

### 8.2 Sui Network Integration

The bot integrates with the Sui network through the JSON-RPC API using the following methods: sui_getBalance for retrieving coin balances, sui_getOwnedObjects for listing NFTs and objects, sui_dryRunTransactionBlock for gas estimation, sui_executeTransactionBlock for broadcasting (from web dApp only), suix_queryTransactionBlocks for transaction history, and suix_resolveNameServiceAddress for SNS resolution.

**SDK Installation:**

```bash
npm install @mysten/sui opossum
# or
yarn add @mysten/sui opossum
# or
pnpm add @mysten/sui opossum
```

**Network Configuration:**

| Environment | RPC URL                               | Network |
| ----------- | ------------------------------------- | ------- |
| Development | `https://fullnode.testnet.sui.io:443` | Testnet |
| Staging     | `https://fullnode.testnet.sui.io:443` | Testnet |
| Production  | `https://fullnode.mainnet.sui.io:443` | Mainnet |

**Current Development Target:** Sui Testnet

The integration uses the Sui TypeScript SDK (`@mysten/sui`) version 1.0.0 or higher for transaction building and serialization. This is the unified package that includes all Sui functionality including zkLogin.

### 8.3 Google AI Studio API Integration (NLP Service)

The nlp-service integrates with Google AI Studio API for natural language processing using Gemini models.

**SDK Installation:**

```bash
npm install @google/generative-ai
# or
pip install google-generativeai
```

**Supported Models:**

| Model              | Use Case          | Context Window | Best For                 |
| ------------------ | ----------------- | -------------- | ------------------------ |
| `gemini-2.0-flash` | Fast inference    | 1M tokens      | Real-time chat responses |
| `gemini-1.5-pro`   | Complex reasoning | 2M tokens      | Multi-step tool calling  |
| `gemini-1.5-flash` | Balanced          | 1M tokens      | General purpose          |

**API Configuration:**

```typescript
// TypeScript/Node.js Implementation
import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  systemInstruction: `You are a Sui blockchain wallet assistant operating through Telegram. 
You help users manage their cryptocurrency by understanding natural language commands.
You have access to tools for building transactions, checking balances, and managing NFTs.
Always confirm transaction details before building them.
Never have access to private keys - all signing happens externally.`
});
```

**Tool Definitions (Function Calling):**

```typescript
const tools = [
  {
    functionDeclarations: [
      {
        name: 'build_send_sui_tx',
        description: 'Build an unsigned transaction to send SUI tokens to a recipient',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            recipient: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Recipient Sui address or contact name'
            },
            amount: {
              type: FunctionDeclarationSchemaType.NUMBER,
              description: 'Amount of SUI to send'
            }
          },
          required: ['recipient', 'amount']
        }
      },
      {
        name: 'build_send_token_tx',
        description: 'Build an unsigned transaction to send fungible tokens other than SUI',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            recipient: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Recipient Sui address or contact name'
            },
            amount: {
              type: FunctionDeclarationSchemaType.NUMBER,
              description: 'Amount of tokens to send'
            },
            tokenType: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Fully qualified token type (e.g., 0x2::sui::SUI)'
            }
          },
          required: ['recipient', 'amount', 'tokenType']
        }
      },
      {
        name: 'get_balance',
        description: 'Get the current balance of SUI and other tokens for a wallet',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            address: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Wallet address to query'
            },
            includeTokens: {
              type: FunctionDeclarationSchemaType.BOOLEAN,
              description: 'Include non-SUI tokens in response'
            }
          },
          required: ['address']
        }
      },
      {
        name: 'list_recent_nfts',
        description: 'List NFTs acquired by the user within a time window',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            owner: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Owner Sui address'
            },
            since: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'ISO 8601 timestamp for filtering (default: 24h ago)'
            },
            collection: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Optional collection filter'
            }
          },
          required: ['owner']
        }
      },
      {
        name: 'build_nft_transfer_tx',
        description: 'Build an unsigned transaction to transfer an NFT',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            nftId: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Object ID of the NFT'
            },
            recipient: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Recipient address or contact name'
            }
          },
          required: ['nftId', 'recipient']
        }
      },
      {
        name: 'get_transaction_history',
        description: 'Get recent transaction history for a wallet',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            address: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Wallet address'
            },
            limit: {
              type: FunctionDeclarationSchemaType.NUMBER,
              description: 'Maximum number of transactions (default: 10)'
            },
            filter: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Filter: sent, received, or all'
            }
          },
          required: ['address']
        }
      },
      {
        name: 'resolve_contact',
        description: 'Resolve a contact name or partial address to a full Sui address',
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: {
            query: {
              type: FunctionDeclarationSchemaType.STRING,
              description: 'Contact name or partial address'
            }
          },
          required: ['query']
        }
      }
    ]
  }
];
```

**Chat Implementation with Tool Calling:**

```typescript
interface ConversationMessage {
  role: 'user' | 'model' | 'function';
  parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }>;
}

class NLPService {
  private model: GenerativeModel;
  private conversationHistory: Map<string, ConversationMessage[]> = new Map();

  constructor() {
    this.model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      tools
    });
  }

  async processMessage(
    userId: string,
    message: string,
    userContext: UserContext
  ): Promise<NLPResponse> {
    // Get or initialize conversation history
    let history = this.conversationHistory.get(userId) || [];

    // Add context to system instruction
    const contextualInstruction = this.buildContextualInstruction(userContext);

    // Start chat with history
    const chat = this.model.startChat({
      history,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024
      }
    });

    // Send message
    const result = await chat.sendMessage(message);
    const response = result.response;

    // Check for function calls
    const functionCalls = response.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
      const toolCall = functionCalls[0];
      return {
        intent: this.mapFunctionToIntent(toolCall.name),
        confidence: 0.95,
        toolCall: {
          name: toolCall.name,
          parameters: toolCall.args
        }
      };
    }

    // Regular text response
    return {
      intent: 'conversation',
      confidence: 1.0,
      response: response.text()
    };
  }

  private mapFunctionToIntent(functionName: string): string {
    const mapping: Record<string, string> = {
      build_send_sui_tx: 'send_sui',
      build_send_token_tx: 'send_token',
      get_balance: 'check_balance',
      list_recent_nfts: 'list_nfts',
      build_nft_transfer_tx: 'transfer_nft',
      get_transaction_history: 'view_history',
      resolve_contact: 'resolve_contact'
    };
    return mapping[functionName] || 'unknown';
  }

  private buildContextualInstruction(context: UserContext): string {
    return `
User's wallet address: ${context.walletAddress}
Known contacts: ${context.contacts.map((c) => `${c.name}: ${c.address}`).join(', ')}
Preferred currency display: ${context.preferences.displayCurrency}
Authentication method: ${context.authMethod}
    `.trim();
  }
}
```

**Alternative: Python Implementation (FastAPI):**

> **Note:** The primary implementation uses Node.js/TypeScript (see Section 3.4). This Python example is provided as an alternative for teams preferring Python.

```python
# nlp-service/main.py
import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import os

app = FastAPI(title="NLP Service", version="1.0.0")

# Configure Google AI
genai.configure(api_key=os.environ["GOOGLE_AI_API_KEY"])

# Tool definitions
tools = [
    genai.protos.Tool(
        function_declarations=[
            genai.protos.FunctionDeclaration(
                name="build_send_sui_tx",
                description="Build an unsigned transaction to send SUI tokens",
                parameters=genai.protos.Schema(
                    type=genai.protos.Type.OBJECT,
                    properties={
                        "recipient": genai.protos.Schema(type=genai.protos.Type.STRING),
                        "amount": genai.protos.Schema(type=genai.protos.Type.NUMBER),
                    },
                    required=["recipient", "amount"],
                ),
            ),
            # ... other function declarations
        ]
    )
]

# Initialize model
model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    tools=tools,
    system_instruction="""You are a Sui blockchain wallet assistant...""",
)

# Conversation history storage (use Redis in production)
conversations: Dict[str, List] = {}

class ParseRequest(BaseModel):
    message: str
    userId: str
    conversationHistory: Optional[List[Dict]] = []
    userContext: Dict[str, Any]

class ParseResponse(BaseModel):
    intent: str
    confidence: float
    toolCall: Optional[Dict[str, Any]] = None
    response: Optional[str] = None

@app.post("/parse", response_model=ParseResponse)
async def parse_message(request: ParseRequest):
    try:
        # Get or create chat session
        history = conversations.get(request.userId, [])

        chat = model.start_chat(history=history)
        response = chat.send_message(request.message)

        # Update history
        conversations[request.userId] = chat.history

        # Check for function calls
        if response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'function_call') and part.function_call:
                    fc = part.function_call
                    return ParseResponse(
                        intent=map_function_to_intent(fc.name),
                        confidence=0.95,
                        toolCall={
                            "name": fc.name,
                            "parameters": dict(fc.args),
                        }
                    )

        return ParseResponse(
            intent="conversation",
            confidence=1.0,
            response=response.text
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/ready")
async def ready():
    # Check if model is accessible
    try:
        model.count_tokens("test")
        return {"status": "ready"}
    except:
        raise HTTPException(status_code=503, detail="Model not ready")

def map_function_to_intent(function_name: str) -> str:
    mapping = {
        "build_send_sui_tx": "send_sui",
        "build_send_token_tx": "send_token",
        "get_balance": "check_balance",
        "list_recent_nfts": "list_nfts",
        "build_nft_transfer_tx": "transfer_nft",
        "get_transaction_history": "view_history",
        "resolve_contact": "resolve_contact",
    }
    return mapping.get(function_name, "unknown")
```

**Voice Input Processing with Google AI:**

```typescript
// For voice transcription, use Google Cloud Speech-to-Text
// or process through Gemini's multimodal capabilities

import { GoogleGenerativeAI } from '@google/generative-ai';

async function processVoiceInput(audioBuffer: Buffer): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Convert audio to base64
  const audioBase64 = audioBuffer.toString('base64');

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'audio/ogg',
        data: audioBase64
      }
    },
    { text: 'Transcribe this audio message. Return only the transcription.' }
  ]);

  return result.response.text();
}
```

**Rate Limiting and Quotas:**

| Tier          | Requests per Minute | Tokens per Minute | Daily Limit |
| ------------- | ------------------: | ----------------: | ----------: |
| Free          |                  15 |         1,000,000 |       1,500 |
| Pay-as-you-go |              1,000+ |        4,000,000+ |   Unlimited |

**Error Handling:**

```typescript
import { GoogleGenerativeAIError } from '@google/generative-ai';

async function handleNLPRequest(message: string) {
  try {
    return await nlpService.processMessage(userId, message, context);
  } catch (error) {
    if (error instanceof GoogleGenerativeAIError) {
      if (error.message.includes('RATE_LIMIT')) {
        // Implement exponential backoff
        await delay(calculateBackoff(retryCount));
        return handleNLPRequest(message);
      }
      if (error.message.includes('SAFETY')) {
        return {
          intent: 'blocked',
          response: 'I cannot process that request.'
        };
      }
    }
    throw error;
  }
}
```

### 8.4 zkLogin Service Integration

The bot integrates with zkLogin services for OAuth-based authentication and transaction signing.

**Salt Service Integration:**

The salt service provides a unique user salt based on JWT claims (iss, aud, sub). The AI Copilot Wallet supports multiple salt management strategies:

| Strategy                | Description                            | Pros                                 | Cons                                             |
| ----------------------- | -------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| Enoki Salt API          | Hosted service returning salt + address | No infrastructure needed, consistent | External dependency, API key required             |
| Self-Hosted Database    | Store sub → salt mapping in PostgreSQL | Full control, simple implementation  | Database maintenance, backup required            |
| Self-Hosted HKDF        | Derive salt using master seed          | No database needed, deterministic    | Cannot rotate master seed without address change |
| User-Provided           | User remembers/stores their salt       | Maximum decentralization             | Poor UX, risk of loss                            |

For Enoki salt integration:

```bash
curl -X GET https://api.enoki.mystenlabs.com/v1/zklogin \
  -H "Authorization: Bearer $ENOKI_API_KEY" \
  -H "zklogin-jwt: $JWT_TOKEN"
```

**ZK Proving Service Integration:**

The proving service generates Groth16 zero-knowledge proofs. Two deployment options are available:

| Option                     | Description                                   | Use Case                            |
| -------------------------- | --------------------------------------------- | ----------------------------------- |
| Enoki Hosted               | Managed service with auto-scaling             | Production, high availability       |
| Self-Hosted Docker         | Run prover-stable and prover-fe-stable images | Custom deployment, data sovereignty |

Proving service request format:

```json
{
  "jwt": "<JWT_TOKEN>",
  "extendedEphemeralPublicKey": "<BASE64_OR_BIGINT>",
  "maxEpoch": "10",
  "jwtRandomness": "<BASE64_OR_BIGINT>",
  "salt": "<BASE64_OR_BIGINT>",
  "keyClaimName": "sub"
}
```

Response format:

```json
{
  "proofPoints": {
    "a": ["<BIGINT>", "<BIGINT>", "1"],
    "b": [
      ["<BIGINT>", "<BIGINT>"],
      ["<BIGINT>", "<BIGINT>"],
      ["1", "0"]
    ],
    "c": ["<BIGINT>", "<BIGINT>", "1"]
  },
  "issBase64Details": {
    "value": "<BASE64_STRING>",
    "indexMod4": 2
  },
  "headerBase64": "<BASE64_JWT_HEADER>"
}
```

**zkLogin TypeScript SDK Functions:**

| Function                          | Purpose                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `generateNonce()`                 | Generate nonce from ephemeral public key, maxEpoch, randomness |
| `generateRandomness()`            | Generate cryptographically secure randomness for nonce         |
| `jwtToAddress()`                  | Compute zkLogin Sui address from JWT and salt                  |
| `getExtendedEphemeralPublicKey()` | Generate extended ephemeral public key for ZKP                 |
| `genAddressSeed()`                | Generate address seed from salt, claim name, claim value, aud  |
| `getZkLoginSignature()`           | Serialize zkLogin signature from proof and ephemeral signature |
| `parseZkLoginSignature()`         | Parse serialized zkLogin signature                             |
| `computeZkLoginAddress()`         | Compute address from individual components                     |

**Zkey File Verification:**

| Network          | File Name         | Blake2b Hash                                                                                                                       |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Mainnet, Testnet | zkLogin-main.zkey | `060beb961802568ac9ac7f14de0fbcd55e373e8f5ec7cc32189e26fb65700aa4e36f5604f868022c765e634d14ea1cd58bd4d79cef8f3cf9693510696bcbcbce` |
| Devnet           | zkLogin-test.zkey | `686e2f5fd969897b1c034d7654799ee2c3952489814e4eaaf3d7e1bb539841047ae8ee5fdcdaca5f4ddd76abb5a8e8eb77b44b693a2ba9d4be57e94292b26ce2` |

---

## 9. Compliance and Legal Considerations

### 9.1 Telegram Platform Compliance

The bot is designed to comply with Telegram's policies regarding cryptocurrency functionality. The key compliance strategy involves the bot operating as a "remote control" that sends links rather than as a Mini App with embedded Web3 functionality. Transactions are signed in external wallets, not within Telegram. The bot does not process payments directly through Telegram. No TON blockchain integration is included, avoiding conflicts with TON-exclusive policies for mini apps.

### 9.2 Data Privacy

The system handles user data in accordance with privacy best practices. The only personal data stored is Telegram user IDs and linked public wallet addresses. No private keys, seed phrases, or authentication credentials are ever stored. Voice recordings are processed transiently and immediately deleted. Users can request deletion of all their data via the /settings command. A privacy policy is provided explaining data handling practices.

### 9.3 Financial Regulations

The system is designed to minimize regulatory exposure. The bot does not custody user funds at any point. It does not facilitate fiat currency exchange. It does not provide investment advice. Transaction history features do not constitute financial reporting. Users retain full control and responsibility for their transactions.

---

## 10. Development Roadmap

### 10.1 Phase 1: Minimum Viable Product (Weeks 1-4)

The MVP phase includes core bot functionality with text-based commands, basic transaction building for SUI transfers, web dApp with wallet connection and signing, balance and NFT viewing capabilities, contact book management, and zkLogin authentication with Google OAuth provider.

### 10.2 Phase 2: Enhanced Features (Weeks 5-8)

The enhanced features phase includes voice input with speech-to-text transcription, support for fungible token transfers beyond SUI, transaction history viewing and filtering, improved natural language understanding with context, inline keyboard shortcuts for common actions, and zkLogin support for additional OAuth providers (Facebook, Twitch, Apple).

### 10.3 Phase 3: Stretch Goals (Weeks 9-12)

The stretch goals phase includes real-time voice transcription display, transaction preview images generated dynamically, multi-language support for natural language commands, integration with Sui DeFi protocols for swaps, and group chat support for shared wallet management.

---

## 11. Success Metrics

### 11.1 User Engagement Metrics

The system will track daily active users (DAU), messages processed per day, transaction success rate, average session duration, user retention at day 7 and day 30, and voice versus text input ratio.

### 11.2 Technical Performance Metrics

The system will track API response latency percentiles, error rates by category, uptime percentage, Google AI Studio token usage and costs, and infrastructure resource utilization.

### 11.3 Business Metrics

The system will track total transaction volume processed (informational only, no fees), user growth rate, feature adoption rates, and user satisfaction through feedback and ratings.

---

## 12. Appendices

### Appendix A: Example Conversations

**Example 1: Simple Send Transaction**

User: "Send 10 SUI to vitalik.sui"

Bot: "I'll prepare a transaction to send 10 SUI to vitalik.sui. Let me resolve that address... ✓ Resolved: vitalik.sui → 0x7d8e...3f2a. Transaction Summary: Action is Send SUI. Amount is 10.000000000 SUI. Recipient is vitalik.sui (0x7d8e...3f2a). Estimated gas is approximately 0.001 SUI. Total deduction is approximately 10.001 SUI. [Sign Transaction button] [Cancel button]"

**Example 2: Ambiguous Contact Resolution**

User: "Send 5 SUI to Alex"

Bot: "I found multiple contacts named Alex. Which one did you mean? 1. Alex Chen - 0x1234...5678 2. Alex Wong - 0x9abc...def0 Please reply with the number or provide more details."

User: "1"

Bot: "Got it! Preparing transaction to send 5 SUI to Alex Chen... [continues with confirmation]"

**Example 3: Voice Command with Confirmation**

User: [Voice note] "Hey, can you show me the NFTs I got this week?"

Bot: "🎤 Transcribed: 'Hey, can you show me the NFTs I got this week?' Fetching NFTs acquired in the last 7 days... You acquired 3 NFTs this week: 1. Sui Frens #4521 (Collection: Sui Frens, acquired December 6). 2. Sui Punks #892 (Collection: Sui Punks, acquired December 5). 3. Sui Frens #4522 (Collection: Sui Frens, acquired December 4). [View Details button] [Transfer button]"

### Appendix B: Error Code Reference

| Code | Description                   | User Message                    | Resolution                            |
| ---- | ----------------------------- | ------------------------------- | ------------------------------------- |
| E001 | Insufficient SUI balance      | "Not enough SUI in wallet"      | Check balance, request lower amount   |
| E002 | Invalid recipient address     | "Address format is invalid"     | Verify address or use contact name    |
| E003 | Contact not found             | "No matching contact found"     | Add contact or use full address       |
| E004 | Transaction simulation failed | "Transaction would fail"        | Review parameters, check object state |
| E005 | Network unreachable           | "Cannot connect to Sui network" | Retry later, check network status     |
| E006 | Wallet connection failed      | "Could not connect wallet"      | Refresh page, try different wallet    |
| E007 | Signing rejected              | "Transaction was cancelled"     | Retry when ready to sign              |
| E008 | Voice transcription failed    | "Could not understand audio"    | Try again or type command             |
| E009 | Rate limit exceeded           | "Too many requests"             | Wait and retry                        |
| E010 | Session expired               | "Please reconnect wallet"       | Use /start to reconnect               |

### Appendix C: Supported Token Types

The system supports SUI as the native gas token, all Coin<T> standard fungible tokens, major bridged assets including USDC, USDT, and WETH, and any token with standard coin module implementation.

### Appendix D: Glossary

**Deep Link:** A URL that opens directly to a specific page or state within an application, used to pass transaction data to the web dApp.

**MIST:** The smallest unit of SUI, where 1 SUI = 1,000,000,000 MIST, similar to wei in Ethereum.

**Move:** The programming language used for Sui smart contracts.

**Object ID:** A unique identifier for objects on the Sui blockchain, including NFTs and coin objects.

**Slush:** A Sui-compatible wallet application that supports the Sui Wallet Kit standard.

**SNS (Sui Name Service):** A naming service that maps human-readable names like "alice.sui" to Sui addresses.

**Sui Wallet Kit:** A standard interface for wallet connections on Sui, similar to WalletConnect on other chains.

**Transaction Block:** A Sui transaction that can contain multiple operations executed atomically.

**TransactionDigest:** A unique hash identifying a completed transaction on the Sui network.

### Appendix E: zkLogin Frequently Asked Questions

**What happens if my OAuth account is compromised?**
Because zkLogin is a 2FA system, an attacker that has compromised your OAuth account cannot access your zkLogin address unless they have separately compromised your salt. The user salt acts as a second authentication factor.

**What happens if I lose access to my OAuth account?**
You must be able to log into your OAuth account and produce a current JWT in order to use zkLogin. However, most OAuth providers offer account recovery flows. In the event of permanent OAuth account loss, access to that zkLogin wallet would be lost, which is why the AI Copilot Wallet recommends setting up a backup authentication method or using Sui's native Multisig functionality.

**Will my zkLogin address ever change?**
Your zkLogin address remains constant as long as you log in to the same wallet with the same OAuth provider, since sub, iss, aud, and user_salt remain unchanged. However, logging in with different OAuth providers or different wallets may result in different addresses because iss and aud differ per provider, and each wallet maintains its own user_salt.

**Can I have multiple addresses with the same OAuth provider?**
Yes, this is possible by using a different wallet provider or different user_salt for each account. This is useful for separating funds between different accounts.

**Is zkLogin custodial?**
No. A zkLogin wallet is non-custodial. It can be viewed as a 2-of-2 Multisig where the two credentials are the user OAuth credentials (maintained by the user) and the salt. Neither the OAuth provider, the wallet vendor, the ZK proving service, nor the salt service provider is a custodian.

**Do I need a new ZK proof for every transaction?**
No. Proof generation is only required when the ephemeral key pair expires. Since the nonce commits to the ephemeral public key and expiry (max_epoch), the ZK proof is valid until that expiry. The proof can be cached and the same ephemeral key can be used to sign multiple transactions until it expires.

**Can I convert my traditional wallet to a zkLogin wallet?**
No. The zkLogin wallet address is derived differently compared to a private key address. You would need to transfer your assets to the new zkLogin address.

**Can zkLogin be used with Multisig?**
Yes. Sui natively supports including zkLogin signers inside a Multisig wallet for additional security, such as using zkLogin as 2FA in k-of-N settings.

---

**Document End**

_This specification is subject to revision as development progresses and requirements evolve._
