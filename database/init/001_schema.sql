-- Base schema and RLS for AI Copilot Wallet microservices
-- Tables are keyed by Telegram user (text) to align with bot identity.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

-- Helper to read the caller's Telegram user id from the session
CREATE OR REPLACE FUNCTION app.current_telegram_id() RETURNS text AS $$
  SELECT current_setting('app.current_telegram_id', true);
$$ LANGUAGE sql STABLE;

-- Users
CREATE TABLE IF NOT EXISTS users (
  telegram_id text PRIMARY KEY,
  username text,
  first_name text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Wallet links (manual or zkLogin-derived)
CREATE TABLE IF NOT EXISTS wallet_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id text NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  address text NOT NULL,
  label text,
  linked_via text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, address)
);

-- Contact book
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id text NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  alias text NOT NULL,
  address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_telegram_alias ON contacts (telegram_id, alias);

-- Session + one-time tokens (hashed)
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id text NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- zkLogin salt + subject bindings (with encrypted storage)
CREATE TABLE IF NOT EXISTS zklogin_salts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id text NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  provider text NOT NULL,
  subject text NOT NULL,
  audience text NOT NULL,                    -- OAuth client ID (for identity uniqueness)
  salt text NOT NULL,                        -- Plain salt (legacy, being phased out)
  salt_encrypted bytea,                      -- AES-256-GCM encrypted salt
  encryption_iv bytea,                       -- Initialization vector for decryption
  derived_address text,                      -- Pre-computed zkLogin address for lookups
  key_claim_name text NOT NULL DEFAULT 'sub',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject, audience)
);
CREATE INDEX IF NOT EXISTS idx_zklogin_salts_address ON zklogin_salts(derived_address);

-- OAuth/nonce state tracking
CREATE TABLE IF NOT EXISTS oauth_states (
  state text PRIMARY KEY,
  telegram_id text NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  provider text NOT NULL,
  redirect_uri text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Transaction logs (bot-level intent + chain digest)
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id text REFERENCES users(telegram_id) ON DELETE SET NULL,
  tx_bytes text,
  status text NOT NULL DEFAULT 'pending',
  digest text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_telegram_id ON transactions (telegram_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC);

-- RLS: only allow rows for the current Telegram user
DO $$
DECLARE
  tbl text;
  policy_name text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['users','wallet_links','contacts','sessions','zklogin_salts','oauth_states','transactions']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    policy_name := tbl || '_owner_isolation';
    -- Drop policy if exists, then create (CREATE POLICY doesn't support IF NOT EXISTS)
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', policy_name, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (telegram_id = current_setting(''app.current_telegram_id'', true)) WITH CHECK (telegram_id = current_setting(''app.current_telegram_id'', true));',
      policy_name,
      tbl
    );
  END LOOP;
END $$;

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_wallet_links_address ON wallet_links (address);
CREATE INDEX IF NOT EXISTS idx_contacts_alias ON contacts (alias);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states (expires_at);
