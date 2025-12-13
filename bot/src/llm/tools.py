import inspect
from typing import Any, Dict, List

from langchain_core.tools import tool

from src.database.postgres import (
  add_contact,
  clear_conversation_history,
  get_contacts,
  get_user_wallet,
  remove_contact,
  resolve_contact,
)
from src.llm.domains import Domain
from src.services.sui import sui_service


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
    for token in balance['tokens'][:5]:
      result += f"\n• {token['symbol']}: {token['totalBalance']}"
  return result


# ============================================================================
# PAYMENTS DOMAIN
# ============================================================================

@tool
async def send_sui(
  recipient: str,
  amount: float,
  wallet_address: str,
  user_id: str,
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
  if amount is None or amount <= 0:
    return {"error": "Amount must be greater than zero."}

  if not recipient:
    return {"error": "Recipient is required."}

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
    "message": f"📋 Ready to send {amount} SUI to {recipient[:10]}...{recipient[-6:]}",
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
  for contact in contacts:
    text += f"\n• {contact['alias']}: {contact['address'][:10]}...{contact['address'][-6:]}"
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
  except Exception as exc:
    return f"❌ Failed to fetch NFTs: {exc}"


# ============================================================================
# HELP DOMAIN
# ============================================================================

@tool
def get_help() -> str:
  """
  Show help information about available commands.
  Call when user asks: 'help', 'what can you do', 'commands', 'how do I'.
  """
  return """💡 Here's what I can do:

💰 Balance: "what's my balance?" or "check wallet"
✉️ Send: "send 1 SUI to alice" or "transfer 0.5 to 0x..."
👥 Contacts: "show contacts" or "add alice as 0x..."
🧾 History: "show my transactions"
🖼️ NFTs: "show my NFTs"
🔄 Reset: "reset" or "clear history" to start fresh

Just chat naturally - I understand normal language!
Or use commands like /balance, /send, /contacts, /history"""


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

ALL_TOOLS = [
  get_balance,
  send_sui,
  list_contacts,
  add_new_contact,
  delete_contact,
  get_transaction_history,
  get_nfts,
  get_help,
  reset_conversation,
]

DOMAIN_TOOLS: Dict[Domain, List] = {
  Domain.balance: [get_balance],
  Domain.payments: [send_sui],
  Domain.contacts: [list_contacts, add_new_contact, delete_contact],
  Domain.history: [get_transaction_history],
  Domain.nfts: [get_nfts],
  Domain.help: [get_help, reset_conversation],  # Reset is part of help/utility
  Domain.conversation: [],  # No tools - pure chat
}

TOOL_REGISTRY = {tool.name: tool for tool in ALL_TOOLS}
