# LLM Function Calling Enhancement Plan (v2)

> **Goal:** Make the AI proactively call tools when users speak naturally, combining the best patterns from the current implementation and `bot-from-the-future`.

---

## Architecture Comparison

| Feature | Current (`gemini.py`) | Future (`wallet_agent.py`) | **Best Choice** |
|---------|----------------------|---------------------------|-----------------|
| Tool definitions | Native Gemini `types.FunctionDeclaration` | LangChain `@tool` decorator | **LangChain** - cleaner, typed |
| Classification | Single LLM call | 2-step: domain → tool | **2-step** - more reliable |
| Structured output | None | Pydantic `BaseModel` | **Pydantic** - type-safe |
| State management | None | LangGraph StateGraph | Skip - overkill for this |
| Tool binding | All tools at once | Domain-specific tools only | **Domain-specific** - less noise |
| User ID injection | Manual in each handler | Auto via `inspect.signature` | **Auto-inject** - DRY |
| Button handling | Each callback handler | Canned request mapping | **Canned requests** - cleaner |

---

## Implementation Status (implemented)

### Phase 1: Domain Classification System ✅

**Implemented:** `bot/src/llm/domains.py`

```python
from enum import Enum
from pydantic import BaseModel, Field

class Domain(str, Enum):
    """Wallet action domains"""
    payments = "payments"      # Send/transfer SUI or tokens
    balance = "balance"        # Check wallet balance
    nfts = "nfts"              # NFT operations
    contacts = "contacts"      # Address book management
    history = "history"        # Transaction history
    help = "help"              # Help/commands
    conversation = "conversation"  # General chat (no tool needed)

class DomainDecision(BaseModel):
    """Structured output for domain classification"""
    domain: Domain = Field(..., description="The wallet domain this request belongs to")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score 0-1")
    reason: str = Field(..., description="Brief explanation of classification")
    requires_wallet: bool = Field(default=True, description="Whether this action requires a linked wallet")
```

### Phase 2: Tool Definitions with LangChain ✅

**Implemented:** `bot/src/llm/tools.py`

```python
import inspect
from typing import Any, Dict, List, Optional
from langchain_core.tools import tool
from src.services.sui import sui_service
from src.database.postgres import (
    get_contacts, add_contact, remove_contact, resolve_contact,
    clear_conversation_history
)

# ============================================================================
# BALANCE DOMAIN
# ============================================================================

@tool
async def get_balance(wallet_address: str) -> str:
    """
    Get the SUI and token balances for a wallet.
    Call when user asks: 'balance', 'how much SUI', 'check wallet', 'my funds'.
    """
    balance = await sui_service.get_all_balances(wallet_address)
    result = f"💰 Balance: {balance['sui']['formatted']}"
    if balance['tokens']:
        result += "\n\nOther tokens:"
        for t in balance['tokens'][:5]:
            result += f"\n• {t['symbol']}: {t['totalBalance']}"
    return result

# ============================================================================
# PAYMENTS DOMAIN
# ============================================================================

@tool
async def send_sui(
    recipient: str,
    amount: float,
    wallet_address: str,
    user_id: str
) -> Dict[str, Any]:
    """
    Prepare a SUI transfer transaction.
    Call when user says: 'send', 'transfer', 'pay', 'give SUI to'.

    Args:
        recipient: Sui address (0x...) OR contact name (alice, bob)
        amount: Amount of SUI to send (e.g., 0.5, 1, 10)
        wallet_address: Sender's wallet address
        user_id: Telegram user ID for contact resolution
    """
    # Resolve contact name to address if needed
    if not recipient.startswith("0x"):
        resolved = await resolve_contact(user_id, recipient)
        if resolved:
            recipient = resolved
        else:
            return {
                "error": f'Contact "{recipient}" not found. Add with: /contacts add {recipient} 0x...'
            }

    return {
        "action": "send_sui",
        "recipient": recipient,
        "amount": amount,
        "sender": wallet_address,
        "needs_signing": True,
        "message": f"📋 Ready to send {amount} SUI to {recipient[:10]}...{recipient[-6:]}"
    }

# ============================================================================
# CONTACTS DOMAIN
# ============================================================================

@tool
async def list_contacts(user_id: str) -> str:
    """
    List all saved contacts in the address book.
    Call when user asks: 'contacts', 'show contacts', 'address book', 'who do I have saved'.
    """
    contacts = await get_contacts(user_id)
    if not contacts:
        return "📭 No contacts saved yet.\n\nAdd one: /contacts add alice 0x..."

    text = "👥 Your Contacts:\n"
    for c in contacts:
        text += f"\n• {c['alias']}: {c['address'][:10]}...{c['address'][-6:]}"
    return text

@tool
async def add_new_contact(user_id: str, name: str, address: str) -> str:
    """
    Save a new contact with name and wallet address.
    Call when user says: 'add contact', 'save address', 'remember this address'.

    Args:
        name: Friendly name/alias (alice, mom, work)
        address: Sui wallet address starting with 0x
    """
    if not address.startswith("0x") or len(address) < 42:
        return "❌ Invalid address. Must start with 0x and be 42-66 characters."

    success = await add_contact(user_id, name, address)
    if success:
        return f'✅ Added contact "{name}" → {address[:10]}...'
    return "❌ Failed to add contact. Please try again."

@tool
async def delete_contact(user_id: str, name: str) -> str:
    """
    Remove a contact from the address book.
    Call when user says: 'remove contact', 'delete contact', 'forget'.
    """
    success = await remove_contact(user_id, name)
    if success:
        return f'✅ Removed contact "{name}"'
    return f'❌ Contact "{name}" not found.'

# ============================================================================
# HISTORY DOMAIN
# ============================================================================

@tool
async def get_transaction_history(wallet_address: str, limit: int = 5) -> str:
    """
    Get recent transaction history.
    Call when user asks: 'history', 'transactions', 'recent activity', 'what did I send'.

    Args:
        limit: Number of transactions (default 5, max 20)
    """
    limit = min(max(1, limit), 20)
    history = await sui_service.get_transaction_history(wallet_address, limit=limit)

    if not history['items']:
        return "📭 No transactions found yet."

    text = "🧾 Recent Transactions:\n"
    for tx in history['items']:
        icon = "📤" if tx.get('kind') == 'sent' else "📥"
        status = "✅" if tx.get('status') == 'success' else "❌"
        digest = tx.get('digest', '')[:8]
        text += f"\n{icon} {status} {digest}..."
    return text

# ============================================================================
# NFT DOMAIN
# ============================================================================

@tool
async def get_nfts(wallet_address: str, limit: int = 10) -> str:
    """
    List NFTs owned by the wallet.
    Call when user asks: 'NFTs', 'my NFTs', 'collectibles', 'digital art'.
    """
    try:
        nfts = await sui_service.get_owned_objects(wallet_address, limit=limit)
        if not nfts:
            return "📭 No NFTs found in your wallet."

        text = "🖼️ Your NFTs:\n"
        for nft in nfts[:limit]:
            name = nft.get('name', 'Unnamed')
            text += f"\n• {name}"
        return text
    except Exception as e:
        return f"❌ Failed to fetch NFTs: {e}"

# ============================================================================
# HELP DOMAIN
# ============================================================================

@tool
def get_help() -> str:
    """
    Show help information.
    Call when user asks: 'help', 'what can you do', 'commands', 'how do I'.
    """
    return """💡 Here's what I can do:

💰 Balance: "what's my balance?" or "check wallet"
✉️ Send: "send 1 SUI to alice" or "transfer 0.5 to 0x..."
👥 Contacts: "show contacts" or "add alice as 0x..."
🧾 History: "show my transactions"
🖼️ NFTs: "show my NFTs"
🔄 Reset: "reset" or "clear history"

Just chat naturally - I'll understand!"""

# ============================================================================
# UTILITY
# ============================================================================

@tool
async def reset_conversation(user_id: str) -> str:
    """
    Clear conversation history and start fresh.
    Call when user says: 'reset', 'start over', 'clear history', 'forget everything'.
    """
    await clear_conversation_history(user_id)
    return "🔄 Conversation reset! How can I help you?"

# ============================================================================
# TOOL REGISTRY
# ============================================================================

from src.llm.domains import Domain

ALL_TOOLS = [
    get_balance, send_sui, list_contacts, add_new_contact,
    delete_contact, get_transaction_history, get_nfts, get_help, reset_conversation
]

DOMAIN_TOOLS: Dict[Domain, List] = {
    Domain.balance: [get_balance],
    Domain.payments: [send_sui],
    Domain.contacts: [list_contacts, add_new_contact, delete_contact],
    Domain.history: [get_transaction_history],
    Domain.nfts: [get_nfts],
    Domain.help: [get_help],
    Domain.conversation: [],  # No tools for general chat
}

TOOL_REGISTRY = {tool.name: tool for tool in ALL_TOOLS}
```

### Phase 3: Wallet Agent with Domain Routing ✅

**Implemented:** `bot/src/llm/wallet_agent.py`

```python
import inspect
import logging
from typing import Any, Dict, List, Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel

from src.core import settings
from src.llm.domains import Domain, DomainDecision
from src.llm.tools import DOMAIN_TOOLS, TOOL_REGISTRY

logger = logging.getLogger(__name__)


class WalletAgent:
    """
    Two-phase NL router:
      1) Classify domain (payments, balance, contacts, etc.)
      2) Bind domain-specific tools and let LLM select one
      3) Execute the tool and return result
    """

    def __init__(self, model_name: str = "gemini-2.0-flash-exp"):
        self.llm = ChatGoogleGenerativeAI(
            model=model_name,
            api_key=settings.GOOGLE_AI_API_KEY,
            temperature=0.3,  # Lower for consistent tool calling
        )
        self.domain_classifier = self.llm.with_structured_output(DomainDecision)

    async def classify_domain(self, user_input: str, has_wallet: bool) -> DomainDecision:
        """Step 1: Classify user's intent into a domain"""
        prompt = f"""Classify this wallet request into exactly ONE domain.

Domains:
- payments: User wants to SEND/TRANSFER/PAY coins (look for: send, transfer, pay, give)
- balance: User wants to CHECK BALANCE (look for: balance, how much, funds, wallet)
- contacts: User wants to MANAGE ADDRESS BOOK (look for: contacts, add contact, save address)
- history: User wants to SEE TRANSACTIONS (look for: history, transactions, recent, activity)
- nfts: User wants to SEE NFTs (look for: NFT, collectibles, digital art)
- help: User wants HELP (look for: help, commands, what can you do)
- conversation: General chat, NOT wallet-related

User has wallet: {has_wallet}
If user asks for balance/send/history but has NO wallet, still classify correctly but note requires_wallet=True.
"""
        return await self.domain_classifier.ainvoke([
            ("system", prompt),
            ("human", user_input),
        ])

    async def select_and_run_tool(
        self,
        user_input: str,
        domain: Domain,
        context: Dict[str, Any]
    ) -> str | Dict[str, Any]:
        """Step 2: Select a tool from the domain and execute it"""

        domain_tools = DOMAIN_TOOLS.get(domain, [])

        if not domain_tools:
            # Conversation domain - generate response without tools
            response = await self.llm.ainvoke([
                ("system", "You are a helpful wallet assistant. Respond briefly."),
                ("human", user_input),
            ])
            return response.content

        # Bind only the relevant domain tools
        llm_with_tools = self.llm.bind_tools(domain_tools)

        system_msg = """You are a wallet assistant. Select ONE tool and extract arguments from the user's text.
For send_sui: extract amount (number) and recipient (0x address or contact name like 'alice').
For contacts: extract name and address if adding.
Always call a tool - don't just respond with text."""

        ai_msg = await llm_with_tools.ainvoke([
            ("system", system_msg),
            ("human", f"Context: {context}\n\nUser request: {user_input}"),
        ])

        if not ai_msg.tool_calls:
            return "I understood your request but couldn't determine the exact action. Please be more specific."

        # Execute the first tool call
        call = ai_msg.tool_calls[0]
        tool_name = call["name"]
        tool_args = call.get("args", {})

        return await self._execute_tool(tool_name, tool_args, context)

    async def _execute_tool(
        self,
        tool_name: str,
        tool_args: Dict[str, Any],
        context: Dict[str, Any]
    ) -> str:
        """Execute a tool with automatic context injection"""

        tool = TOOL_REGISTRY.get(tool_name)
        if not tool:
            return f"Unknown action: {tool_name}"

        # Auto-inject context variables (user_id, wallet_address) if needed
        sig = inspect.signature(tool.func if hasattr(tool, 'func') else tool)
        for param in sig.parameters:
            if param in context and param not in tool_args:
                tool_args[param] = context[param]

        try:
            # Handle async tools
            if inspect.iscoroutinefunction(tool.func if hasattr(tool, 'func') else tool):
                result = await tool.ainvoke(tool_args)
            else:
                result = tool.invoke(tool_args)

            # Handle dict results (like send_sui which needs signing)
            if isinstance(result, dict):
                if result.get("error"):
                    return f"❌ {result['error']}"
                if result.get("needs_signing"):
                    return result  # Return dict for special handling
                return result.get("message", str(result))

            return str(result)

        except Exception as e:
            logger.exception(f"Tool {tool_name} failed")
            return f"❌ Error: {e}"

    async def run(
        self,
        user_input: str,
        user_id: str,
        wallet_address: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Main entry point.

        Returns:
            {
                "text": str,           # Response to show user
                "action": str | None,  # If an action was taken
                "needs_signing": bool, # If send_sui needs signing link
                "tx_data": dict | None # Transaction data for signing
            }
        """
        context = {
            "user_id": user_id,
            "wallet_address": wallet_address,
        }

        # Step 1: Classify domain
        decision = await self.classify_domain(user_input, has_wallet=bool(wallet_address))

        logger.info(f"Domain: {decision.domain} (conf={decision.confidence:.2f}): {decision.reason}")

        # Check if wallet is required but missing
        if decision.requires_wallet and not wallet_address:
            if decision.domain in [Domain.balance, Domain.payments, Domain.history, Domain.nfts]:
                return {
                    "text": "❌ No wallet linked yet. Use /start to connect your wallet first.",
                    "action": None,
                    "needs_signing": False,
                }

        # Step 2: Select and run tool
        result = await self.select_and_run_tool(user_input, decision.domain, context)

        # Handle send_sui special case (needs signing)
        if isinstance(result, dict) and result.get("needs_signing"):
            return {
                "text": result.get("message", "Transaction ready"),
                "action": "send_sui",
                "needs_signing": True,
                "tx_data": result,
            }

        return {
            "text": result,
            "action": decision.domain.value,
            "needs_signing": False,
        }


# Singleton
wallet_agent = WalletAgent()
```

### Phase 4: Updated Router with Canned Requests ✅

**Implemented:** `bot/src/bot/handlers/router.py`

```python
from src.llm.wallet_agent import wallet_agent

# ============================================================================
# CANNED REQUESTS FOR MENU BUTTONS
# ============================================================================

BUTTON_TO_REQUEST = {
    "action_balance": "Show my balance",
    "action_contacts": "Show my contacts",
    "action_history": "Show my transaction history",
    "action_help": "Help me understand what you can do",
}

# ============================================================================
# CALLBACK HANDLERS (Simplified with Canned Requests)
# ============================================================================

@router.callback_query(F.data.startswith("action_"))
async def handle_action_callback(callback: CallbackQuery) -> None:
    """Universal handler for action buttons using canned requests"""
    await callback.answer()

    action = callback.data
    user_id = str(callback.from_user.id)

    # Get canned request for this button
    canned_request = BUTTON_TO_REQUEST.get(action)

    if not canned_request:
        # Special cases that don't use the agent
        if action == "action_send_prompt":
            await callback.message.answer(
                "✉️ <b>Send SUI</b>\n\n"
                "Just tell me naturally:\n"
                "• 'send 1 SUI to alice'\n"
                "• 'transfer 0.5 to 0x...'\n"
                "• 'pay bob 2 sui'"
            )
            return
        elif action == "action_zklogin_info":
            await callback.message.answer(
                "🔐 <b>zkLogin</b>\n\n"
                "Create a Sui wallet with your Google account - no seed phrases!"
            )
            return
        return

    # Process canned request through the agent
    wallet_address = await get_user_wallet(user_id)

    status_msg = await callback.message.answer("Processing...")

    try:
        result = await wallet_agent.run(
            user_input=canned_request,
            user_id=user_id,
            wallet_address=wallet_address,
        )
        await status_msg.edit_text(result["text"], reply_markup=get_main_menu())
    except Exception as e:
        logger.error(f"Action {action} failed: {e}")
        await status_msg.edit_text(f"❌ Error: {e}", reply_markup=get_main_menu())


# ============================================================================
# TEXT/VOICE MESSAGE HANDLERS
# ============================================================================

@router.message(F.voice)
async def voice_message_handler(message: Message) -> None:
    """Handle voice messages - transcribe with Gemini then route to agent."""
    status_msg = await message.answer("🎤 Processing your voice message...")

    try:
        audio_file_id = message.voice.file_id
        ogg_path = await download_file_from_telegram(message.bot, audio_file_id)
        wav_path = convert_ogg_to_wav(ogg_path)
        transcription = await gemini_service.transcribe_audio(wav_path)

        if not transcription:
            await safe_edit(status_msg, "❌ Could not transcribe audio. Please try again or type your message.")
            return

        await safe_edit(status_msg, f'🎤 I heard: "<i>{transcription}</i>"\n\nProcessing...')
        await process_with_agent(message, transcription, status_msg)

    except Exception as exc:
        logger.error(f"Voice processing failed: {exc}")
        await safe_edit(status_msg, "❌ Error processing voice message. Please try again or type your message.")


@router.message(F.text)
async def text_message_handler(message: Message) -> None:
    """Handle text messages"""
    await process_with_agent(message, message.text)


async def process_with_agent(
    message: Message,
    text: str,
    status_msg: Optional[Message] = None
) -> None:
    """Process message through the wallet agent"""
    user_id = str(message.from_user.id)
    await ensure_user(user_id, message.from_user.username, message.from_user.first_name)

    wallet_address = await get_user_wallet(user_id)

    try:
        await add_to_conversation(user_id, "user", text)

        result = await wallet_agent.run(
            user_input=text,
            user_id=user_id,
            wallet_address=wallet_address,
        )

        if result.get("needs_signing") and result.get("tx_data"):
            tx = result["tx_data"]
            webapp_url = settings.WEBAPP_URL
            tx_url = f"{webapp_url}?mode=wallet&recipient={tx['recipient']}&amount={tx['amount']}&sender={tx['sender']}"

            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="✍️ Sign & Send", url=tx_url)],
            ])

            reply_text = result["text"] + "\n\nClick below to sign:"
            await add_to_conversation(user_id, "assistant", f"[Prepared send: {tx['amount']} SUI]")

            if status_msg:
                await safe_edit(status_msg, reply_text, reply_markup=keyboard)
            else:
                await safe_answer(message, reply_text, reply_markup=keyboard)
            return

        reply_text = result.get("text", "I'm not sure how to help with that.")
        await add_to_conversation(user_id, "assistant", reply_text)

        if status_msg:
            await safe_edit(status_msg, reply_text, reply_markup=get_main_menu())
        else:
            await safe_answer(message, reply_text, reply_markup=get_main_menu())

    except Exception as exc:
        logger.error(f"Agent processing failed: {exc}")
        error_text = "❌ Sorry, something went wrong. Try /help"
        if status_msg:
            await safe_edit(status_msg, error_text)
        else:
            await safe_answer(message, error_text)
```

---

## Key Improvements Over Original Plans (implemented)

### From `bot-from-the-future`:
1. **Two-phase routing** - Domain classification THEN tool selection (more accurate)
2. **Pydantic structured output** - Type-safe domain decisions with confidence
3. **LangChain `@tool` decorator** - Cleaner tool definitions with docstrings
4. **Domain-specific tool binding** - Only expose relevant tools per domain
5. **Auto context injection** - Inspect signatures and inject `user_id`/`wallet_address`
6. **Canned request pattern** - Button callbacks use natural language through agent

### From original `LLM_FUNCTION_CALLING_PLAN.md`:
1. **Trigger phrases in docstrings** - Each tool lists when to call it
2. **Lower temperature (0.3)** - More consistent tool calling
3. **Complete tool set** - balance, send, contacts (add/remove/list), history, NFTs, help, reset
4. **Contact name resolution** - `send_sui` resolves "alice" → `0x...`
5. **Error handling** - Graceful fallbacks and wallet-not-linked checks

### New in this version:
1. **Unified callback handler** - All action buttons go through one handler with canned requests
2. **Structured result format** - `{text, action, needs_signing, tx_data}` for consistent handling
3. **Signing flow integration** - `send_sui` returns data for signing link generation
4. **Conversation history** - Still persisted for multi-turn context

---

## File Structure

```
bot/src/
├── llm/
│   ├── __init__.py
│   ├── domains.py      # Domain enum + DomainDecision model
│   ├── tools.py        # @tool definitions + registry
│   └── wallet_agent.py # Two-phase agent
├── bot/handlers/
│   └── router.py       # Updated with agent integration
└── services/
    └── gemini.py       # Keep for audio transcription only
```

---

## Test Matrix

| Input | Expected Domain | Expected Tool | Expected Behavior |
|-------|-----------------|---------------|-------------------|
| "what's my balance" | balance | get_balance | Show SUI balance |
| "send 1 sui to alice" | payments | send_sui | Return signing link |
| "transfer 0.5 to 0xabc" | payments | send_sui | Return signing link |
| "show contacts" | contacts | list_contacts | List address book |
| "add bob as 0x123..." | contacts | add_new_contact | Save contact |
| "delete alice" | contacts | delete_contact | Remove contact |
| "history" | history | get_transaction_history | Show txs |
| "my nfts" | nfts | get_nfts | List NFTs |
| "help" | help | get_help | Show help text |
| "reset" | conversation | reset_conversation | Clear history |
| "hello" | conversation | (none) | Chat response |
| "how are you" | conversation | (none) | Chat response |

---

## Dependencies (added to `bot/requirements.txt`)

```txt
# requirements.txt additions
langchain-core>=0.1.0
langchain-google-genai>=1.0.0
# pydantic>=2.0.0 (already present in repo)
```

---

## Implementation Notes / Next Steps

- Confirm `langchain-*` dependencies are installed in the runtime.
- Conversation history is persisted for chat continuity; classification currently does not re-inject history into the LLM (can be added later if desired).
- Send flows return signing links via the existing web dapp (`mode=wallet` links) after tool calls.
- Button callbacks now use canned natural-language prompts through the agent; non-wallet actions fall back to informational responses.
