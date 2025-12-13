"""AI Copilot Wallet - Telegram Bot Entry Point"""

import logging
import sys

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
    link_wallet,
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

    def serialize_session(session: dict) -> dict:
        """Convert DB session (with datetimes) into JSON-safe dict."""
        out = dict(session)
        if "expires_at" in out and hasattr(out["expires_at"], "timestamp"):
            out["expiresAt"] = int(out["expires_at"].timestamp() * 1000)
            del out["expires_at"]
        if "created_at" in out and hasattr(out["created_at"], "timestamp"):
            out["createdAt"] = int(out["created_at"].timestamp() * 1000)
            del out["created_at"]
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

        body = await request.json()
        telegram_id = str(body.get("id"))
        # Optional: basic identity match
        if telegram_id and session.get("telegram_id") and telegram_id != session["telegram_id"]:
            return web.json_response({"error": "telegram_id_mismatch"}, status=400)

        # Complete linking (persists wallet link)
        await complete_linking_session(token)
        return web.json_response({"status": "ok"})

    async def handle_complete(request: web.Request) -> web.Response:
        token = request.match_info.get("token")
        if not token:
            return web.json_response({"error": "token_required"}, status=400)

        session = await complete_linking_session(token)
        if not session:
            return web.json_response({"error": "not_found_or_already_completed"}, status=404)

        return web.json_response({"status": "ok"})

    app.router.add_get("/api/link/{token}", handle_get_link)
    app.router.add_post("/api/link/{token}/wallet", handle_set_wallet)
    app.router.add_post("/api/link/{token}/telegram-verify", handle_telegram_verify)
    app.router.add_post("/api/link/{token}/complete", handle_complete)

    # Mount dispatcher hooks to aiohttp application
    setup_application(app, dp, bot=bot)

    # Start web server
    logger.info(f"Starting server on 0.0.0.0:{settings.PORT}")
    web.run_app(app, host="0.0.0.0", port=settings.PORT)


if __name__ == "__main__":
    main()
