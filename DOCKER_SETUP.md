# Docker Setup Instructions

This directory contains the Docker configuration for the AI Copilot Wallet microservices architecture.

## Architecture Overview

This setup uses **PostgreSQL 16** as the primary database for all services.

### External Services Used

| Service                   | URL                                        | Purpose                       |
| ------------------------- | ------------------------------------------ | ----------------------------- |
| Mysten Labs Salt          | `https://salt.api.mystenlabs.com/get_salt` | Deterministic salt retrieval  |
| Mysten Labs Prover (dev)  | `https://prover-dev.mystenlabs.com/v1`     | ZK proof generation (testnet) |
| Mysten Labs Prover (prod) | `https://prover.mystenlabs.com/v1`         | ZK proof generation (mainnet) |

## Prerequisites

1. **Install Docker Desktop**
   - Windows: https://docs.docker.com/desktop/install/windows-install/
   - Mac: https://docs.docker.com/desktop/install/mac-install/
   - Linux: https://docs.docker.com/desktop/install/linux-install/

2. **Verify Installation**
   ```bash
   docker --version
   docker-compose --version
   ```

## Quick Start

### 1. Generate SSL Certificates (First Time Only)

For local development, generate self-signed certificates:

```bash
# Windows (PowerShell)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout nginx/ssl/privkey.pem -out nginx/ssl/fullchain.pem -subj "/C=US/ST=State/L=City/O=Dev/CN=caishen.iseethereaper.com"

# Linux/Mac
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/C=US/ST=State/L=City/O=Dev/CN=caishen.iseethereaper.com"
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required variables:

- `TELEGRAM_BOT_TOKEN` - Get from @BotFather on Telegram
- `GOOGLE_AI_API_KEY` - Get from Google AI Studio
- `POSTGRES_PASSWORD` - Set a strong password for PostgreSQL
- `DATABASE_URL` - PostgreSQL connection string (auto-generated in compose)
- `GOOGLE_CLIENT_ID` - For zkLogin OAuth (from Google Cloud Console)

Optional zkLogin variables:

- `ZKLOGIN_PROVER_URL` - Defaults to testnet prover

### 3. Start All Services

```bash
# Start all services in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f telegram-gateway
```

### 4. Verify Services are Running

```bash
# Check service status
docker-compose ps

# Check nginx health
curl -k https://caishen.iseethereaper.com/health

# Check individual services
docker-compose exec telegram-gateway wget -q -O- http://localhost:3001/health
```

## Service URLs

- **nginx (Front-end)**: https://caishen.iseethereaper.com:443
- **Telegram Gateway**: Internal only (port 3001) - includes zkLogin client
- **NLP Service**: Internal only (port 3002)
- **Transaction Builder**: Internal only (port 3003)
- **User Service**: Internal only (port 3005)
- **Notification Service**: Internal only (port 3006)
- **PostgreSQL**: Internal only (port 5432)
- **Web dApp (static)**: Served by nginx from `services/web-dapp/out` at https://caishen.iseethereaper.com

> **Note:** zkLogin operations use external Mysten Labs APIs - no local service needed.

### Updating the Web dApp

The static signing portal lives in `services/web-dapp/out`. After editing those assets:

```bash
docker-compose up -d --build nginx
```

nginx will serve the refreshed files at `https://caishen.iseethereaper.com`.

## Common Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Stop and remove volumes (⚠️ deletes data)
docker-compose down -v

# Rebuild specific service
docker-compose up -d --build telegram-gateway

# View logs
docker-compose logs -f [service-name]

# Execute command in container
docker-compose exec telegram-gateway sh

# Restart specific service
docker-compose restart telegram-gateway
```

## Database Operations (PostgreSQL)

### Accessing PostgreSQL

```bash
# Connect to PostgreSQL via psql
docker-compose exec postgres psql -U caishen -d caishen_wallet

# Common psql commands
\dt          -- List tables
\d users     -- Describe users table
\d+          -- List tables with size info
\q           -- Quit
```

### Example Queries

```sql
-- List all users
SELECT * FROM users;

-- List all contacts for a user
SELECT * FROM contacts WHERE telegram_id = '123456789';

-- Check transactions
SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;

-- Check sessions
SELECT * FROM sessions WHERE expires_at > NOW();
```

### Backup Database

```bash
# Create a full backup
docker-compose exec postgres pg_dump -U caishen caishen_wallet > backup.sql

# Backup to compressed format
docker-compose exec postgres pg_dump -U caishen -Fc caishen_wallet > backup.dump
```

### Restore Database

```bash
# Restore from SQL file
docker-compose exec -T postgres psql -U caishen -d caishen_wallet < backup.sql

# Restore from compressed dump
docker-compose exec postgres pg_restore -U caishen -d caishen_wallet -c backup.dump
```

## Memory Monitoring

```bash
# Check memory usage of all containers
docker stats --no-stream

# Expected memory usage (approximate):
# - nginx: ~20-50MB
# - api-gateway: ~10-30MB
# - telegram-gateway: ~100-200MB
# - nlp-service: ~100-150MB
# - transaction-builder: ~80-120MB
# - user-service: ~80-120MB
# - notification-service: ~50-80MB
# - postgres: ~100-256MB
```

## Troubleshooting

### Port Already in Use

```bash
# Find what's using port 443
netstat -ano | findstr :443  # Windows
lsof -i :443                 # Linux/Mac

# Stop the process or change ports in docker-compose.yml
```

### Container Won't Start

```bash
# Check logs
docker-compose logs telegram-gateway

# Check container status
docker-compose ps

# Rebuild from scratch
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Test connection
docker-compose exec postgres pg_isready -U caishen

# Check PostgreSQL logs
docker-compose logs postgres

# Reset database (⚠️ deletes all data)
docker-compose down -v
docker-compose up -d
```

### SSL Certificate Issues

```bash
# Regenerate self-signed certificate
rm nginx/ssl/*.pem
# Then run the openssl command again
```

## Development Workflow

### Hot Reload (Current Setup)

The current `docker-compose.yml` mounts your local code as volumes, so changes are reflected immediately:

```bash
# Edit code locally
# Changes auto-reload in containers
```

### Run Without Docker (For Faster Development)

```bash
# Start only PostgreSQL
docker-compose up -d postgres

# Set DATABASE_URL locally
export DATABASE_URL=postgresql://caishen:changeme@localhost:5432/caishen_wallet

# Run app locally
npm run dev
```

## Production Deployment

For production deployment:

1. Build optimized Docker images (`docker-compose build --no-cache`)
2. Use proper SSL certificates (Let's Encrypt/Certbot)
3. Set strong `POSTGRES_PASSWORD`
4. Configure PostgreSQL for production (tune `shared_buffers`, `work_mem`)
5. Set up database backups (pg_dump cron job)
6. Use external Mysten Labs APIs for zkLogin (no local prover)

See `IMPLEMENTATION_STATUS.md` Phase 6 for production checklist.

## Network Architecture

```
Internet → nginx:443 (SSL termination, rate limiting)
            ↓
            api-gateway:8080 (internal routing)
            ↓
            ├─→ telegram-gateway:3001 (+ zkLogin client)
            ├─→ nlp-service:3002
            ├─→ transaction-builder:3003
            ├─→ user-service:3005
            └─→ notification-service:3006
                ↓
                ├─→ PostgreSQL:5432 (shared database)
                └─→ External Mysten Labs APIs (zkLogin)
```

## Database Schema

The schema is defined in `database/init/001_schema.sql` and includes:

- **users** - Telegram users with optional wallet links
- **contacts** - User's saved contact aliases
- **sessions** - Authentication sessions
- **transactions** - Transaction history and status
- **zklogin_state** - zkLogin OAuth state management
- **user_salt** - zkLogin salt storage

## Next Steps

1. ✅ Docker Compose created with PostgreSQL
2. ✅ nginx configuration created
3. ✅ Service directories created with implementations
4. ✅ PostgreSQL schema ready (database/init/001_schema.sql)
5. ⏸️ Configure environment variables (`.env` from `.env.example`)
6. ⏸️ Test the complete stack

See `IMPLEMENTATION_STATUS.md` for detailed checkpoint tracking.
