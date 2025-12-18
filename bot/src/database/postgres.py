"""PostgreSQL database module for user and wallet management"""

import asyncio
import logging
from typing import Optional, List, Dict, Any
import asyncpg

from src.core import settings

logger = logging.getLogger(__name__)

# Connection pool
_pool: Optional[asyncpg.Pool] = None


async def init_database() -> asyncpg.Pool:
    """Initialize PostgreSQL connection pool"""
    global _pool
    if _pool is not None:
        return _pool

    try:
        _pool = await asyncpg.create_pool(
            host=settings.POSTGRES_HOST,
            port=settings.POSTGRES_PORT,
            user=settings.POSTGRES_USER,
            password=settings.POSTGRES_PASSWORD,
            database=settings.POSTGRES_DB,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        logger.info("PostgreSQL connection pool initialized")

        # Create tables if they don't exist
        await _create_tables()

        return _pool
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


async def _create_tables():
    """Create tables if they don't exist"""
    async with _pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                telegram_id VARCHAR(64) PRIMARY KEY,
                username VARCHAR(255),
                first_name VARCHAR(255),
                first_seen_at TIMESTAMP DEFAULT NOW(),
                last_seen_at TIMESTAMP DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS wallet_links (
                id SERIAL PRIMARY KEY,
                telegram_id VARCHAR(64) NOT NULL,
                address VARCHAR(66) NOT NULL,
                linked_via VARCHAR(32) DEFAULT 'manual',
                label VARCHAR(255),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(telegram_id, address)
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id SERIAL PRIMARY KEY,
                telegram_id VARCHAR(64) NOT NULL,
                alias VARCHAR(255) NOT NULL,
                address VARCHAR(66) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(telegram_id, alias)
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS linking_sessions (
                token VARCHAR(64) PRIMARY KEY,
                telegram_id VARCHAR(64) NOT NULL,
                telegram_username VARCHAR(255),
                telegram_first_name VARCHAR(255),
                status VARCHAR(32) DEFAULT 'pending_wallet',
                wallet_address VARCHAR(66),
                wallet_type VARCHAR(32),
                zklogin_salt TEXT,
                zklogin_sub TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS conversation_history (
                id SERIAL PRIMARY KEY,
                telegram_id VARCHAR(64) NOT NULL,
                role VARCHAR(16) NOT NULL, -- 'user' or 'assistant'
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_convhist_telegram
            ON conversation_history(telegram_id, created_at DESC)
        """)

        # zkLogin salts table (used by transaction-builder for salt derivation)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS zklogin_salts (
                id SERIAL PRIMARY KEY,
                telegram_id VARCHAR(64) NOT NULL,
                provider TEXT NOT NULL,
                subject TEXT NOT NULL,
                audience TEXT NOT NULL,
                salt TEXT NOT NULL,
                salt_encrypted BYTEA,
                encryption_iv BYTEA,
                derived_address TEXT,
                key_claim_name TEXT NOT NULL DEFAULT 'sub',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (provider, subject, audience)
            )
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_zklogin_salts_telegram
            ON zklogin_salts(telegram_id)
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_zklogin_salts_address
            ON zklogin_salts(derived_address)
        """)

        logger.info("Database tables verified/created")


async def close_database():
    """Close the database pool"""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("PostgreSQL connection pool closed")


async def get_pool() -> asyncpg.Pool:
    """Get or create the connection pool"""
    if _pool is None:
        await init_database()
    return _pool


async def ensure_user(telegram_id: str, username: Optional[str] = None, first_name: Optional[str] = None):
    """Ensure user exists in database"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO users (telegram_id, username, first_name, last_seen_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (telegram_id) DO UPDATE SET
                username = COALESCE($2, users.username),
                first_name = COALESCE($3, users.first_name),
                last_seen_at = NOW()
        """, telegram_id, username, first_name)


async def get_user(telegram_id: str) -> Optional[Dict[str, Any]]:
    """Get user by telegram ID"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT telegram_id, username, first_name, first_seen_at, last_seen_at FROM users WHERE telegram_id = $1",
            telegram_id
        )
        return dict(row) if row else None


async def get_user_wallet(telegram_id: str) -> Optional[str]:
    """Get user's primary wallet address"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT address FROM wallet_links
            WHERE telegram_id = $1
            ORDER BY created_at ASC
            LIMIT 1
        """, telegram_id)
        return row['address'] if row else None


async def link_wallet(
    telegram_id: str,
    address: str,
    linked_via: str = 'manual',
    label: Optional[str] = None
):
    """Link a wallet to user"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO wallet_links (telegram_id, address, linked_via, label)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (telegram_id, address) DO UPDATE SET
                label = COALESCE($4, wallet_links.label)
        """, telegram_id, address, linked_via, label)


async def unlink_wallet(telegram_id: str, address: Optional[str] = None) -> bool:
    """
    Unlink wallet(s) from user.
    If address is provided, only unlink that specific wallet.
    If address is None, unlink ALL wallets for the user.
    """
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            if address:
                result = await conn.execute(
                    "DELETE FROM wallet_links WHERE telegram_id = $1 AND address = $2",
                    telegram_id, address
                )
            else:
                result = await conn.execute(
                    "DELETE FROM wallet_links WHERE telegram_id = $1",
                    telegram_id
                )
            deleted_count = int(result.split()[-1]) if result else 0
            logger.info(f"Unlinked {deleted_count} wallet(s) for user {telegram_id}")
            return deleted_count > 0
    except Exception as e:
        logger.error(f"Failed to unlink wallet: {e}")
        return False


async def get_all_user_wallets(telegram_id: str) -> List[Dict[str, Any]]:
    """Get all wallets linked to a user"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT address, linked_via, label, created_at 
            FROM wallet_links
            WHERE telegram_id = $1
            ORDER BY created_at ASC
        """, telegram_id)
        return [dict(row) for row in rows]


async def full_account_reset(telegram_id: str) -> Dict[str, int]:
    """
    Completely reset a user's account:
    - Unlink all wallets
    - Clear conversation history
    - Remove all contacts
    Returns count of items removed.
    """
    pool = await get_pool()
    results = {"wallets": 0, "conversations": 0, "contacts": 0}
    
    async with pool.acquire() as conn:
        # Unlink wallets
        wallet_result = await conn.execute(
            "DELETE FROM wallet_links WHERE telegram_id = $1", telegram_id
        )
        results["wallets"] = int(wallet_result.split()[-1]) if wallet_result else 0
        
        # Clear conversation history
        conv_result = await conn.execute(
            "DELETE FROM conversation_history WHERE telegram_id = $1", telegram_id
        )
        results["conversations"] = int(conv_result.split()[-1]) if conv_result else 0
        
        # Remove contacts
        contact_result = await conn.execute(
            "DELETE FROM contacts WHERE telegram_id = $1", telegram_id
        )
        results["contacts"] = int(contact_result.split()[-1]) if contact_result else 0
    
    logger.info(f"Full account reset for {telegram_id}: {results}")
    return results


async def get_contacts(telegram_id: str) -> List[Dict[str, str]]:
    """Get user's contacts"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT alias, address FROM contacts WHERE telegram_id = $1 ORDER BY alias",
            telegram_id
        )
        return [dict(row) for row in rows]


async def add_contact(telegram_id: str, alias: str, address: str) -> bool:
    """Add a contact"""
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO contacts (telegram_id, alias, address)
                VALUES ($1, $2, $3)
                ON CONFLICT (telegram_id, alias) DO UPDATE SET address = $3
            """, telegram_id, alias, address)
        return True
    except Exception as e:
        logger.error(f"Failed to add contact: {e}")
        return False


async def remove_contact(telegram_id: str, alias: str) -> bool:
    """Remove a contact"""
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM contacts WHERE telegram_id = $1 AND alias = $2",
                telegram_id, alias
            )
            return result != "DELETE 0"
    except Exception as e:
        logger.error(f"Failed to remove contact: {e}")
        return False


async def resolve_contact(telegram_id: str, alias: str) -> Optional[str]:
    """Resolve contact alias to address"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT address FROM contacts WHERE telegram_id = $1 AND LOWER(alias) = LOWER($2)",
            telegram_id, alias
        )
        return row['address'] if row else None


async def get_conversation_history(telegram_id: str, limit: int = 20) -> List[Dict[str, str]]:
    """Get recent conversation history in chronological order"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT role, content as text
            FROM conversation_history
            WHERE telegram_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        """, telegram_id, limit)
    return [dict(row) for row in reversed(rows)]


async def add_to_conversation(telegram_id: str, role: str, content: str):
    """Persist a message in the conversation history"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO conversation_history (telegram_id, role, content)
            VALUES ($1, $2, $3)
        """, telegram_id, role, content)


async def clear_conversation_history(telegram_id: str):
    """Clear all stored conversation history for a user"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM conversation_history WHERE telegram_id = $1",
            telegram_id
        )


# Linking session functions
async def create_linking_session(
    token: str,
    telegram_id: str,
    username: Optional[str],
    first_name: Optional[str],
    expires_at
) -> Dict[str, Any]:
    """Create a new linking session"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO linking_sessions (token, telegram_id, telegram_username, telegram_first_name, expires_at)
            VALUES ($1, $2, $3, $4, $5)
        """, token, telegram_id, username, first_name, expires_at)

    return {
        "token": token,
        "telegram_id": telegram_id,
        "telegram_username": username,
        "telegram_first_name": first_name,
        "status": "pending_wallet",
        "expires_at": expires_at
    }


async def get_linking_session(token: str) -> Optional[Dict[str, Any]]:
    """Get a linking session by token"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM linking_sessions WHERE token = $1 AND expires_at > NOW()",
            token
        )
        return dict(row) if row else None


async def update_linking_session(token: str, **updates) -> bool:
    """Update a linking session"""
    pool = await get_pool()

    # Build SET clause dynamically
    set_parts = []
    values = []
    for i, (key, value) in enumerate(updates.items(), start=1):
        set_parts.append(f"{key} = ${i}")
        values.append(value)

    if not set_parts:
        return False

    values.append(token)
    query = f"UPDATE linking_sessions SET {', '.join(set_parts)} WHERE token = ${len(values)}"

    try:
        async with pool.acquire() as conn:
            await conn.execute(query, *values)
        return True
    except Exception as e:
        logger.error(f"Failed to update linking session: {e}")
        return False


async def set_linking_wallet(
    token: str,
    wallet_address: str,
    wallet_type: str,
    zklogin_salt: Optional[str] = None,
    zklogin_sub: Optional[str] = None,
) -> bool:
    """Attach wallet details to a linking session."""
    updates = {
        "wallet_address": wallet_address,
        "wallet_type": wallet_type,
        "status": "pending_telegram_confirm",
    }
    if zklogin_salt:
        updates["zklogin_salt"] = zklogin_salt
    if zklogin_sub:
        updates["zklogin_sub"] = zklogin_sub
    return await update_linking_session(token, **updates)


async def complete_linking_session(token: str) -> Optional[Dict[str, Any]]:
    """Complete a linking session and link the wallet"""
    session = await get_linking_session(token)
    if not session or session['status'] == 'completed':
        return None

    # Update session status
    await update_linking_session(token, status='completed')

    # Link the wallet to the user
    if session.get('wallet_address'):
        await link_wallet(
            session['telegram_id'],
            session['wallet_address'],
            session.get('wallet_type', 'zklogin')
        )

    session['status'] = 'completed'
    return session
