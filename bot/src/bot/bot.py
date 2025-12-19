"""AI Copilot Wallet - Telegram Bot Entry Point"""

import hashlib
import hmac
import logging
import sys

import aiohttp
from aiohttp import web

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application

from src.core import settings
from src.bot.handlers.router import router
from src.database.postgres import (
    init_database,
    close_database,
    get_linking_session,
    set_linking_wallet,
    complete_linking_session,
    store_ephemeral_key,
    get_ephemeral_key,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# Initialize Bot instance
bot = Bot(
    token=settings.TELEGRAM_BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML),
)


async def on_startup(bot: Bot) -> None:
    """Initialize database and set webhook on startup"""
    logger.info("Starting bot...")

    # Initialize database
    try:
        await init_database()
        logger.info("Database initialized")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        # Continue anyway - db might be unavailable temporarily

    # Set webhook
    webhook_url = f"{settings.WEBHOOK_BASE_URL}{settings.WEBHOOK_PATH}"
    logger.info(f"Setting webhook to: {webhook_url}")

    await bot.set_webhook(
        webhook_url,
        secret_token=settings.TELEGRAM_WEBHOOK_SECRET,
    )
    logger.info("Webhook set successfully")


async def on_shutdown(bot: Bot) -> None:
    """Cleanup on shutdown"""
    logger.info("Shutting down...")
    await close_database()
    logger.info("Database connection closed")


def main() -> None:
    """Main entry point"""
    logger.info("=" * 50)
    logger.info("AI Copilot Wallet - Python Bot")
    logger.info("=" * 50)

    # Dispatcher is a root router
    dp = Dispatcher()

    # Attach routers
    dp.include_router(router)

    # Register startup/shutdown hooks
    dp.startup.register(on_startup)
    dp.shutdown.register(on_shutdown)

    # Create aiohttp web application
    app = web.Application()

    # Create webhook request handler
    webhook_requests_handler = SimpleRequestHandler(
        dispatcher=dp,
        bot=bot,
        secret_token=settings.TELEGRAM_WEBHOOK_SECRET,
    )

    # Register webhook handler
    webhook_requests_handler.register(app, path=settings.WEBHOOK_PATH)

    # ------------------------------------------------------------------ #
    # REST endpoints for web-dapp linking
    # ------------------------------------------------------------------ #

    def verify_telegram_auth(auth_payload: dict, provided_hash: str) -> bool:
        """Verify Telegram Login Widget payload using HMAC-SHA256."""
        if not provided_hash:
            return False

        try:
            data_check_string = "\n".join(
                f"{k}={auth_payload[k]}"
                for k in sorted(auth_payload.keys())
                if auth_payload[k] is not None
            )
            secret_key = hashlib.sha256(settings.TELEGRAM_BOT_TOKEN.encode()).digest()
            computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(computed_hash, provided_hash)
        except Exception as exc:
            logger.error("Failed to verify Telegram auth: %s", exc)
            return False

    def serialize_session(session: dict) -> dict:
        """Convert DB session (with datetimes) into JSON-safe dict."""
        out = dict(session)
        if "expires_at" in out and hasattr(out["expires_at"], "timestamp"):
            out["expiresAt"] = int(out["expires_at"].timestamp() * 1000)
            del out["expires_at"]
        if "created_at" in out and hasattr(out["created_at"], "timestamp"):
            out["createdAt"] = int(out["created_at"].timestamp() * 1000)
            del out["created_at"]
        if "telegram_username" in out:
            out["telegramUsername"] = out.pop("telegram_username")
        if "telegram_first_name" in out:
            out["telegramFirstName"] = out.pop("telegram_first_name")
        if "wallet_address" in out:
            out["walletAddress"] = out.pop("wallet_address")
        if "wallet_type" in out:
            out["walletType"] = out.pop("wallet_type")
        if "zklogin_salt" in out:
            out["zkLoginSalt"] = out.pop("zklogin_salt")
        if "zklogin_sub" in out:
            out["zkLoginSub"] = out.pop("zklogin_sub")
        return out

    async def handle_get_link(request: web.Request) -> web.Response:
        token = request.match_info.get("token")
        if not token:
            return web.json_response({"error": "token_required"}, status=400)

        session = await get_linking_session(token)
        if not session:
            return web.json_response({"error": "not_found"}, status=404)

        return web.json_response(serialize_session(session))

    async def handle_set_wallet(request: web.Request) -> web.Response:
        token = request.match_info.get("token")
        if not token:
            return web.json_response({"error": "token_required"}, status=400)

        body = await request.json()
        wallet_address = body.get("walletAddress")
        wallet_type = body.get("walletType", "zklogin")
        zklogin_salt = body.get("zkLoginSalt")
        zklogin_sub = body.get("zkLoginSub")

        if not wallet_address:
            return web.json_response({"error": "walletAddress_required"}, status=400)

        session = await get_linking_session(token)
        if not session:
            return web.json_response({"error": "not_found"}, status=404)

        ok = await set_linking_wallet(token, wallet_address, wallet_type, zklogin_salt, zklogin_sub)
        if not ok:
            return web.json_response({"error": "update_failed"}, status=500)

        return web.json_response({"status": "ok"})

    async def handle_telegram_verify(request: web.Request) -> web.Response:
        token = request.match_info.get("token")
        if not token:
            return web.json_response({"error": "token_required"}, status=400)

        session = await get_linking_session(token)
        if not session:
            return web.json_response({"error": "not_found"}, status=404)

        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json"}, status=400)

        auth_payload = dict(body)
        provided_hash = auth_payload.pop("hash", None)
        telegram_id = auth_payload.get("id")
        telegram_id = str(telegram_id) if telegram_id is not None else None

        if not telegram_id:
            return web.json_response({"error": "telegram_id_required"}, status=400)

        if not verify_telegram_auth(auth_payload, provided_hash):
            return web.json_response({"error": "invalid_telegram_auth"}, status=401)

        if session.get("telegram_id") and telegram_id != str(session["telegram_id"]):
            return web.json_response({"error": "telegram_id_mismatch"}, status=400)

        completed_session = await complete_linking_session(token)
        if not completed_session:
            return web.json_response({"error": "complete_failed"}, status=400)

        wallet_address = completed_session.get("wallet_address")

        try:
            if wallet_address:
                await bot.send_message(
                    telegram_id,
                    (
                        "✅ Wallet linked!\n\n"
                        f"<b>Wallet:</b> <code>{wallet_address}</code>\n"
                        "You can now use /balance, /send, and /history."
                    ),
                )
        except Exception as exc:
            logger.warning("Failed to notify user %s of linking: %s", telegram_id, exc)

        return web.json_response({
            "status": "completed",
            "walletAddress": wallet_address,
            "walletType": completed_session.get("wallet_type"),
            "telegramId": telegram_id,
        })

    async def handle_complete(request: web.Request) -> web.Response:
        token = request.match_info.get("token")
        if not token:
            return web.json_response({"error": "token_required"}, status=400)

        session = await complete_linking_session(token)
        if not session:
            return web.json_response({"error": "not_found_or_already_completed"}, status=404)

        return web.json_response({"status": "ok"})

    async def handle_zklogin_salt(request: web.Request) -> web.Response:
        """Proxy zkLogin salt request to transaction-builder service."""
        token = request.match_info.get("token")
        if not token:
            return web.json_response({"error": "token_required"}, status=400)

        # Verify token exists
        session = await get_linking_session(token)
        if not session:
            return web.json_response({"error": "not_found"}, status=404)

        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json"}, status=400)

        jwt = body.get("jwt")
        if not jwt:
            return web.json_response({"error": "jwt_required"}, status=400)

        # Get telegramId from session for salt derivation
        telegram_id = session.get("telegram_id")

        # Call transaction-builder salt service
        tx_service_url = settings.TX_SERVICE_URL
        salt_url = f"{tx_service_url}/api/v1/zklogin/salt"

        try:
            async with aiohttp.ClientSession() as client_session:
                async with client_session.post(
                    salt_url,
                    json={"jwt": jwt, "telegramId": str(telegram_id) if telegram_id else None},
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        logger.error(f"Salt service error: {resp.status} - {error_text}")
                        return web.json_response(
                            {"error": f"Salt service error: {error_text}"},
                            status=resp.status
                        )

                    salt_data = await resp.json()
                    return web.json_response(salt_data)

        except aiohttp.ClientError as e:
            logger.error(f"Failed to connect to salt service: {e}")
            return web.json_response(
                {"error": "Failed to connect to salt service"},
                status=503
            )
        except Exception as e:
            logger.error(f"Unexpected error in zklogin-salt: {e}")
            return web.json_response({"error": "Internal server error"}, status=500)

    async def handle_store_ephemeral(request: web.Request) -> web.Response:
        """Store ephemeral key for zkLogin OAuth flow."""
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json"}, status=400)

        session_id = body.get("sessionId")
        secret_key = body.get("secretKey")
        max_epoch = body.get("maxEpoch")
        randomness = body.get("randomness")
        tx_params = body.get("txParams")

        if not all([session_id, secret_key, max_epoch, randomness]):
            return web.json_response({"error": "missing_fields"}, status=400)

        # Convert secret key array to bytes
        # Handle list (from JSON) - elements might be ints or strings
        try:
            if isinstance(secret_key, list):
                # Convert each element to int in case they're strings
                secret_key_bytes = bytes([int(x) for x in secret_key])
            elif isinstance(secret_key, str):
                # Try to parse as JSON array if it's a string
                import json as json_mod
                secret_key_list = json_mod.loads(secret_key)
                secret_key_bytes = bytes([int(x) for x in secret_key_list])
            else:
                return web.json_response({"error": "secret_key_must_be_array"}, status=400)
        except (ValueError, TypeError) as e:
            logger.error(f"Failed to parse secret_key: {e}, type={type(secret_key)}")
            return web.json_response({"error": "invalid_secret_key_format"}, status=400)

        success = await store_ephemeral_key(
            session_id=session_id,
            secret_key=secret_key_bytes,
            max_epoch=max_epoch,
            randomness=randomness,
            tx_params=tx_params,
            ttl_minutes=10
        )

        if success:
            return web.json_response({"status": "ok", "sessionId": session_id})
        else:
            return web.json_response({"error": "storage_failed"}, status=500)

    async def handle_get_ephemeral(request: web.Request) -> web.Response:
        """Retrieve ephemeral key (one-time use, deletes after retrieval)."""
        session_id = request.match_info.get("sessionId")
        if not session_id:
            return web.json_response({"error": "session_id_required"}, status=400)

        data = await get_ephemeral_key(session_id)
        if not data:
            return web.json_response({"error": "not_found_or_expired"}, status=404)

        return web.json_response(data)

    app.router.add_get("/api/link/{token}", handle_get_link)
    app.router.add_post("/api/link/{token}/wallet", handle_set_wallet)
    app.router.add_post("/api/link/{token}/telegram-verify", handle_telegram_verify)
    app.router.add_post("/api/link/{token}/complete", handle_complete)
    app.router.add_post("/api/link/{token}/zklogin-salt", handle_zklogin_salt)
    app.router.add_post("/api/ephemeral", handle_store_ephemeral)
    app.router.add_get("/api/ephemeral/{sessionId}", handle_get_ephemeral)

    # Mount dispatcher hooks to aiohttp application
    setup_application(app, dp, bot=bot)

    # Start web server
    logger.info(f"Starting server on 0.0.0.0:{settings.PORT}")
    web.run_app(app, host="0.0.0.0", port=settings.PORT)


if __name__ == "__main__":
    main()
