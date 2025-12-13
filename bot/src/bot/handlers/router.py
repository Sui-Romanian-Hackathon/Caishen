"""Telegram bot handlers - wallet commands, voice, and AI chat"""

import logging
import secrets
import re
from datetime import datetime, timedelta
from typing import Optional

from aiogram import Bot, Router, F
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import CommandStart, Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton

from src.core import settings
from src.utils import download_file_from_telegram, convert_ogg_to_wav
from src.services.gemini import gemini_service
from src.services.sui import sui_service
from src.database.postgres import (
    ensure_user,
    get_user_wallet,
    link_wallet,
    get_contacts,
    add_contact,
    resolve_contact,
    create_linking_session,
    get_linking_session,
    get_conversation_history,
    add_to_conversation,
    clear_conversation_history,
)

logger = logging.getLogger(__name__)
router = Router()


async def safe_answer(message: Message, text: str, **kwargs) -> None:
    """Send a reply and swallow Telegram 'chat not found' errors (blocked/invalid chat)."""
    try:
        await message.answer(text, **kwargs)
    except TelegramBadRequest as exc:
        logger.warning("Failed to send message to chat %s: %s", message.chat.id, exc)


async def safe_edit(status_msg: Message, text: str, **kwargs) -> None:
    """Edit a message and swallow Telegram 'chat not found' errors (blocked/invalid chat)."""
    try:
        await status_msg.edit_text(text, **kwargs)
    except TelegramBadRequest as exc:
        logger.warning("Failed to edit message in chat %s: %s", status_msg.chat.id, exc)


# Main menu keyboard
def get_main_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="📋 Help", callback_data="action_help"),
            InlineKeyboardButton(text="💰 Balance", callback_data="action_balance"),
        ],
        [
            InlineKeyboardButton(text="👥 Contacts", callback_data="action_contacts"),
            InlineKeyboardButton(text="🧾 History", callback_data="action_history"),
        ],
        [InlineKeyboardButton(text="✉️ Send SUI", callback_data="action_send_prompt")],
    ])


def is_valid_sui_address(address: str) -> bool:
    """Check if string is a valid Sui address"""
    return bool(re.match(r"^0x[a-fA-F0-9]{40,64}$", address))


# ============================================================================
# Command Handlers
# ============================================================================

@router.message(CommandStart())
async def command_start_handler(message: Message) -> None:
    """Handle /start command - initiate wallet linking flow"""
    user_id = str(message.from_user.id)
    username = message.from_user.username
    first_name = message.from_user.first_name

    # Ensure user exists in database
    await ensure_user(user_id, username, first_name)

    # Check if user already has a wallet linked
    wallet_address = await get_user_wallet(user_id)

    if wallet_address:
        await safe_answer(message,
            f"👋 Welcome back, <b>{first_name or username or 'friend'}</b>!\n\n"
            f"📱 Telegram: @{username or user_id}\n"
            f"💳 Wallet: <code>{wallet_address[:10]}...{wallet_address[-8:]}</code>\n\n"
            "Use the menu below to manage your wallet.",
            reply_markup=get_main_menu(),
        )
        return

    # Create a new linking session
    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(minutes=15)

    await create_linking_session(token, user_id, username, first_name, expires_at)

    # Generate linking URL
    link_path = f"@{username}" if username else user_id
    linking_url = f"{settings.WEBAPP_URL}/link/{link_path}?token={token}"

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔗 Connect Wallet", url=linking_url)],
        [InlineKeyboardButton(text="❓ What is zkLogin?", callback_data="action_zklogin_info")],
    ])

    await safe_answer(message,
        f"👋 Welcome to <b>AI Copilot Wallet</b>!\n\n"
        "To get started, connect your wallet:\n\n"
        '🔐 <b>Step 1:</b> Click the button below\n'
        '🔑 <b>Step 2:</b> Choose "Create zkLogin wallet" (with Google) or connect your existing Slush wallet\n'
        "✅ <b>Step 3:</b> Verify your Telegram account\n\n"
        "⏱️ This link expires in 15 minutes.",
        reply_markup=keyboard,
    )


@router.message(Command("help"))
async def command_help_handler(message: Message) -> None:
    """Handle /help command"""
    await safe_answer(
        "<b>Commands:</b>\n"
        "/start - Connect your wallet\n"
        "/connect &lt;address&gt; - Manually link a wallet\n"
        "/help - This help menu\n"
        "/balance - Check your SUI balance\n"
        "/send &lt;amount&gt; &lt;address&gt; - Send SUI\n"
        "/contacts - List saved contacts\n"
        "/contacts add &lt;name&gt; &lt;address&gt; - Add a contact\n"
        "/history - Recent transactions\n"
        "/reset - Clear conversation history\n\n"
        "<b>Or just chat naturally:</b>\n"
        '"What\'s my balance?"\n'
        '"Send 1 SUI to alice"\n'
        '"Show my transaction history"',
        reply_markup=get_main_menu(),
    )


@router.message(Command("reset"))
async def command_reset_handler(message: Message) -> None:
    """Handle /reset command - clear conversation history"""
    user_id = str(message.from_user.id)

    await clear_conversation_history(user_id)

    await safe_answer(
        message,
        "🧹 Conversation history cleared.\n\nI've forgotten our previous chat. How can I help you?",
        reply_markup=get_main_menu(),
    )


@router.message(Command("balance"))
async def command_balance_handler(message: Message) -> None:
    """Handle /balance command"""
    user_id = str(message.from_user.id)
    wallet_address = await get_user_wallet(user_id)

    if not wallet_address:
        await safe_answer(message, "❌ No wallet linked yet.\n\nUse /start to connect your wallet first.")
        return

    try:
        status_msg = await message.answer("⏳ Fetching balance...")
        balance = await sui_service.get_all_balances(wallet_address)

        text = (
            f"💰 <b>Wallet Balance</b>\n\n"
            f"<code>{wallet_address}</code>\n\n"
            f"<b>SUI:</b> {balance['sui']['formatted']}\n"
        )

        if balance['tokens']:
            text += "\n<b>Other Tokens:</b>\n"
            for token in balance['tokens'][:5]:
                text += f"• {token['symbol']}: {token['totalBalance']}\n"

        await safe_edit(status_msg, text, reply_markup=get_main_menu())

    except Exception as e:
        logger.error(f"Balance fetch failed: {e}")
        await safe_answer(message,
            "❌ Failed to fetch balance. Please try again later."
        )


@router.message(Command("history"))
async def command_history_handler(message: Message) -> None:
    """Handle /history command"""
    user_id = str(message.from_user.id)
    wallet_address = await get_user_wallet(user_id)

    if not wallet_address:
        await safe_answer(
            "❌ No wallet linked yet.\n\nUse /start to connect your wallet first."
        )
        return

    try:
        status_msg = await message.answer("⏳ Fetching transaction history...")
        history = await sui_service.get_transaction_history(wallet_address, limit=10)

        if not history['items']:
            await safe_edit(status_msg, "📭 No transactions found yet.")
            return

        text = f"🧾 <b>Recent Transactions</b>\n\n"
        for tx in history['items']:
            ts = datetime.fromtimestamp(tx['timestampMs'] / 1000).strftime('%m/%d %H:%M') if tx['timestampMs'] else '?'
            icon = "📤" if tx['kind'] == 'sent' else "📥"
            status_icon = "✅" if tx['status'] == 'success' else "❌"
            digest_short = f"{tx['digest'][:6]}...{tx['digest'][-4:]}"
            text += f"{icon} {ts} {status_icon} <a href=\"{tx['explorerUrl']}\">{digest_short}</a>\n"

        await safe_edit(status_msg, text, disable_web_page_preview=True)

    except Exception as e:
        logger.error(f"History fetch failed: {e}")
        await safe_answer(message,
            "❌ Failed to fetch history. Please try again later."
        )


@router.message(Command("contacts"))
async def command_contacts_handler(message: Message) -> None:
    """Handle /contacts command"""
    user_id = str(message.from_user.id)
    text = message.text.strip()
    parts = text.split()

    # /contacts add <name> <address>
    if len(parts) >= 4 and parts[1].lower() == "add":
        name = parts[2]
        address = parts[3]

        if not is_valid_sui_address(address):
            await safe_answer(message, "❌ Invalid Sui address. Addresses start with 0x and are 40-64 hex characters.")
            return

        success = await add_contact(user_id, name, address)
        if success:
            await safe_answer(message, f'✅ Added contact "<b>{name}</b>" → <code>{address}</code>')
        else:
            await safe_answer(message, "❌ Failed to add contact. Please try again.")
        return

    # /contacts (list)
    contacts = await get_contacts(user_id)

    if not contacts:
        await safe_answer(message, "📭 No contacts saved yet.\n\nAdd one with:\n<code>/contacts add alice 0x123...</code>")
        return

    text = "👥 <b>Your Contacts</b>\n\n"
    for c in contacts:
        text += f"• <b>{c['alias']}</b>: <code>{c['address'][:10]}...{c['address'][-6:]}</code>\n"

    await safe_answer(message, text)


@router.message(Command("connect"))
async def command_connect_handler(message: Message) -> None:
    """Manually link a wallet: /connect <address>"""
    parts = message.text.strip().split()
    if len(parts) != 2:
        await safe_answer(message, "Usage: /connect <wallet_address>")
        return

    address = parts[1]
    if not is_valid_sui_address(address):
        await safe_answer(message, "❌ Invalid Sui address. Addresses start with 0x and are 40-64 hex characters.")
        return

    user_id = str(message.from_user.id)
    username = message.from_user.username
    first_name = message.from_user.first_name
    await ensure_user(user_id, username, first_name)
    await link_wallet(user_id, address, linked_via="manual")

    await safe_answer(
        message,
        f"✅ Wallet linked!\n<code>{address}</code>\n\nYou can now use /balance, /send, /contacts, /history."
    )


@router.message(Command("send"))
async def command_send_handler(message: Message) -> None:
    """Handle /send command"""
    user_id = str(message.from_user.id)
    wallet_address = await get_user_wallet(user_id)

    if not wallet_address:
        await message.answer(
            "❌ No wallet linked yet.\n\nUse /start to connect your wallet first."
        )
        return

    text = message.text.strip()
    parts = text.split()

    if len(parts) < 3:
        await safe_answer(message,
            "Usage: /send &lt;amount&gt; &lt;recipient&gt;\n"
            "Example: <code>/send 0.5 0xabc123...</code>\n"
            "Or: <code>/send 1 alice</code> (using contact name)"
        )
        return

    try:
        amount = float(parts[1])
    except ValueError:
        await safe_answer(message, "❌ Invalid amount. Please use a number like 0.5 or 1")
        return

    if amount <= 0:
        await safe_answer(message, "❌ Amount must be greater than 0")
        return

    recipient = parts[2]

    # Resolve contact if not an address
    if not is_valid_sui_address(recipient):
        resolved = await resolve_contact(user_id, recipient)
        if not resolved:
            await safe_answer(message,
                f'❌ Contact "{recipient}" not found.\n\n'
                "Add it with: <code>/contacts add {recipient} 0x...</code>\n"
                "Or provide a full Sui address."
            )
            return
        recipient = resolved

    # Create pending transaction and show signing link
    # For now, just show the transaction details
    webapp_url = settings.WEBAPP_URL
    tx_url = f"{webapp_url}?mode=wallet&recipient={recipient}&amount={amount}&sender={wallet_address}"

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✍️ Sign & Send", url=tx_url)],
    ])

    await safe_answer(message,
        f"📋 <b>Transaction Ready</b>\n\n"
        f"<b>From:</b> <code>{wallet_address[:10]}...{wallet_address[-6:]}</code>\n"
        f"<b>To:</b> <code>{recipient[:10]}...{recipient[-6:]}</code>\n"
        f"<b>Amount:</b> {amount} SUI\n\n"
        "Click below to sign with your wallet:",
        reply_markup=keyboard,
    )


# ============================================================================
# Callback Query Handlers
# ============================================================================

@router.callback_query(F.data == "action_help")
async def callback_help(callback: CallbackQuery) -> None:
    await callback.answer()
    await safe_answer(callback.message,
        "Use the commands or just chat naturally!\n\n"
        "/balance - Check balance\n"
        "/send - Send SUI\n"
        "/contacts - Manage contacts\n"
        "/history - View transactions",
        reply_markup=get_main_menu(),
    )


@router.callback_query(F.data == "action_balance")
async def callback_balance(callback: CallbackQuery) -> None:
    await callback.answer()
    user_id = str(callback.from_user.id)
    wallet_address = await get_user_wallet(user_id)

    if not wallet_address:
        await callback.message.answer(
            "❌ No wallet linked yet.\n\nUse /start to connect your wallet first.",
            reply_markup=get_main_menu(),
        )
        return

    status_msg = await callback.message.answer("⏳ Fetching balance...")
    try:
        balance = await sui_service.get_all_balances(wallet_address)

        text = (
            f"💰 <b>Wallet Balance</b>\n\n"
            f"<code>{wallet_address}</code>\n\n"
            f"<b>SUI:</b> {balance['sui']['formatted']}\n"
        )

        if balance['tokens']:
            text += "\n<b>Other Tokens:</b>\n"
            for token in balance['tokens'][:5]:
                text += f"• {token['symbol']}: {token['totalBalance']}\n"

        await safe_edit(status_msg, text, reply_markup=get_main_menu())
    except Exception as e:
        logger.error(f"Balance fetch failed (callback): {e}")
        await safe_edit(
            status_msg,
            "❌ Failed to fetch balance. Please try again later.",
            reply_markup=get_main_menu(),
        )


@router.callback_query(F.data == "action_contacts")
async def callback_contacts(callback: CallbackQuery) -> None:
    await callback.answer()
    user_id = str(callback.from_user.id)

    contacts = await get_contacts(user_id)

    if not contacts:
        await safe_answer(
            callback.message,
            "📭 No contacts saved yet.\n\nAdd one with:\n<code>/contacts add alice 0x123...</code>",
            reply_markup=get_main_menu(),
        )
        return

    text = "👥 <b>Your Contacts</b>\n\n"
    for c in contacts:
        text += f"• <b>{c['alias']}</b>: <code>{c['address'][:10]}...{c['address'][-6:]}</code>\n"

    await safe_answer(callback.message, text, reply_markup=get_main_menu())


@router.callback_query(F.data == "action_history")
async def callback_history(callback: CallbackQuery) -> None:
    await callback.answer()
    user_id = str(callback.from_user.id)
    wallet_address = await get_user_wallet(user_id)

    if not wallet_address:
        await safe_answer(
            callback.message,
            "❌ No wallet linked yet.\n\nUse /start to connect your wallet first.",
            reply_markup=get_main_menu(),
        )
        return

    status_msg = await callback.message.answer("⏳ Fetching transaction history...")
    try:
        history = await sui_service.get_transaction_history(wallet_address, limit=5)

        if not history['items']:
            await safe_edit(status_msg, "📭 No transactions found yet.", reply_markup=get_main_menu())
            return

        text = "🧾 <b>Recent Transactions</b>\n\n"
        for tx in history['items']:
            ts = datetime.fromtimestamp(tx['timestampMs'] / 1000).strftime('%m/%d %H:%M') if tx.get('timestampMs') else '?'
            icon = "📤" if tx.get('kind') == 'sent' else "📥"
            status_icon = "✅" if tx.get('status') == 'success' else "❌"
            digest = tx.get('digest', '')
            digest_short = f"{digest[:6]}...{digest[-4:]}" if digest else "tx"
            explorer_url = tx.get('explorerUrl', '')
            text += f"{icon} {ts} {status_icon} <a href=\"{explorer_url}\">{digest_short}</a>\n"

        await safe_edit(status_msg, text, disable_web_page_preview=True, reply_markup=get_main_menu())
    except Exception as e:
        logger.error(f"History fetch failed (callback): {e}")
        await safe_edit(
            status_msg,
            "❌ Failed to fetch history. Please try again later.",
            reply_markup=get_main_menu(),
        )


@router.callback_query(F.data == "action_send_prompt")
async def callback_send_prompt(callback: CallbackQuery) -> None:
    await callback.answer()
    await callback.message.answer(
        "✉️ <b>Send SUI</b>\n\n"
        "Type: <code>/send &lt;amount&gt; &lt;recipient&gt;</code>\n\n"
        "Examples:\n"
        "• <code>/send 0.5 0xabc123...</code>\n"
        "• <code>/send 1 alice</code> (contact name)",
    )


@router.callback_query(F.data == "action_zklogin_info")
async def callback_zklogin_info(callback: CallbackQuery) -> None:
    await callback.answer()
    await callback.message.answer(
        "🔐 <b>What is zkLogin?</b>\n\n"
        "zkLogin lets you create a Sui wallet using your Google account - no seed phrases needed!\n\n"
        "<b>How it works:</b>\n"
        "1. You sign in with Google\n"
        "2. A unique wallet address is generated from your Google identity\n"
        "3. Zero-knowledge proofs keep your Google account private\n\n"
        "<b>Security:</b>\n"
        "✅ No one can access your wallet without your Google account\n"
        "✅ Your Google email is never stored on the blockchain\n"
        "✅ Built by Mysten Labs for the Sui blockchain\n\n"
        "Already have a Slush wallet? You can connect that instead!",
    )


# ============================================================================
# Voice Message Handler
# ============================================================================

@router.message(F.voice)
async def voice_message_handler(message: Message) -> None:
    """Handle voice messages - transcribe with Gemini and process"""
    status_msg = await message.answer("🎤 Processing your voice message...")

    try:
        # Download and convert audio
        audio_file_id = message.voice.file_id
        ogg_path = await download_file_from_telegram(message.bot, audio_file_id)
        wav_path = convert_ogg_to_wav(ogg_path)

        # Transcribe with Gemini
        transcription = await gemini_service.transcribe_audio(wav_path)

        if not transcription:
            await safe_edit(status_msg, "❌ Could not transcribe audio. Please try again or type your message.")
            return

        # Show transcription and process as text
        await safe_edit(status_msg, f'🎤 I heard: "<i>{transcription}</i>"\n\nProcessing...')

        # Process transcribed text as a regular message
        await process_text_message(message, transcription, status_msg)

    except Exception as e:
        logger.error(f"Voice processing failed: {e}")
        await safe_edit(status_msg, "❌ Error processing voice message. Please try again or type your message.")


# ============================================================================
# Text Message Handler (Natural Language)
# ============================================================================

@router.message(F.text)
async def text_message_handler(message: Message) -> None:
    """Handle regular text messages with AI"""
    await process_text_message(message, message.text)


async def process_text_message(
    message: Message,
    text: str,
    status_msg: Optional[Message] = None
) -> None:
    """Process text message with Gemini AI"""
    user_id = str(message.from_user.id)

    # Ensure user exists
    await ensure_user(user_id, message.from_user.username, message.from_user.first_name)

    # Get wallet address
    wallet_address = await get_user_wallet(user_id)
    history = await get_conversation_history(user_id, limit=20)

    try:
        # Persist user message first
        await add_to_conversation(user_id, "user", text)

        # Get AI response
        response = await gemini_service.chat(
            message=text,
            wallet_address=wallet_address,
            history=history,
        )

        # Handle function calls
        if response.get("function_call"):
            fc = response["function_call"]
            await handle_function_call(message, fc, wallet_address, status_msg)
            await add_to_conversation(user_id, "assistant", f"[Called {fc.get('name')}]")
            return

        # Send text response
        reply_text = response.get("text", "I'm not sure how to help with that.")
        await add_to_conversation(user_id, "assistant", reply_text)

        if status_msg:
            await safe_edit(status_msg, reply_text)
        else:
            await safe_answer(message, reply_text)

    except Exception as e:
        logger.error(f"AI processing failed: {e}")
        error_text = "❌ Sorry, I had trouble understanding that. Try using a command like /help"
        if status_msg:
            await safe_edit(status_msg, error_text)
        else:
            await safe_answer(message, error_text)


async def handle_function_call(
    message: Message,
    fc: dict,
    wallet_address: Optional[str],
    status_msg: Optional[Message] = None
) -> None:
    """Handle AI function calls"""
    user_id = str(message.from_user.id)
    func_name = fc.get("name")
    args = fc.get("args", {})

    async def reply(text: str, **kwargs):
        if status_msg:
            await safe_edit(status_msg, text, **kwargs)
        else:
            await safe_answer(message, text, **kwargs)

    try:
        if func_name == "get_balance":
            if not wallet_address:
                await reply("❌ No wallet linked. Use /start to connect your wallet first.")
                return

            balance = await sui_service.get_all_balances(wallet_address)
            await reply(
                f"💰 <b>Balance:</b> {balance['sui']['formatted']}\n"
                f"<code>{wallet_address}</code>",
                reply_markup=get_main_menu(),
            )

        elif func_name == "send_sui":
            if not wallet_address:
                await reply("❌ No wallet linked. Use /start to connect your wallet first.")
                return

            amount = args.get("amount", 0)
            recipient = args.get("recipient", "")

            # Resolve contact
            if not is_valid_sui_address(recipient):
                resolved = await resolve_contact(user_id, recipient)
                if resolved:
                    recipient = resolved
                else:
                    await reply(f'❌ Contact "{recipient}" not found. Please add it or use a full address.')
                    return

            webapp_url = settings.WEBAPP_URL
            tx_url = f"{webapp_url}?mode=wallet&recipient={recipient}&amount={amount}&sender={wallet_address}"

            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="✍️ Sign & Send", url=tx_url)],
            ])

            await reply(
                f"📋 <b>Ready to send {amount} SUI</b>\n\n"
                f"<b>To:</b> <code>{recipient[:10]}...{recipient[-6:]}</code>\n\n"
                "Click below to sign:",
                reply_markup=keyboard,
            )

        elif func_name == "list_contacts":
            contacts = await get_contacts(user_id)
            if not contacts:
                await reply("📭 No contacts yet. Add one with /contacts add name address")
            else:
                text = "👥 <b>Contacts:</b>\n"
                for c in contacts:
                    text += f"• {c['alias']}: <code>{c['address'][:10]}...</code>\n"
                await reply(text)

        elif func_name == "add_contact":
            name = args.get("name", "")
            address = args.get("address", "")

            if not is_valid_sui_address(address):
                await reply("❌ Invalid address format.")
                return

            success = await add_contact(user_id, name, address)
            if success:
                await reply(f'✅ Added contact "{name}"')
            else:
                await reply("❌ Failed to add contact.")

        elif func_name == "get_history":
            if not wallet_address:
                await reply("❌ No wallet linked. Use /start to connect your wallet first.")
                return

            limit = args.get("limit", 5)
            history = await sui_service.get_transaction_history(wallet_address, limit=limit)

            if not history['items']:
                await reply("📭 No transactions found.")
                return

            text = "🧾 <b>Recent Transactions:</b>\n\n"
            for tx in history['items'][:5]:
                icon = "📤" if tx['kind'] == 'sent' else "📥"
                await reply(text + f"{icon} <a href=\"{tx['explorerUrl']}\">{tx['digest'][:12]}...</a>\n", disable_web_page_preview=True)

        else:
            await reply(f"I understood you want to {func_name}, but I can't do that yet.")

    except Exception as e:
        logger.error(f"Function call {func_name} failed: {e}")
        await reply(f"❌ Error executing {func_name}. Please try again.")
