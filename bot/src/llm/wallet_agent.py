import inspect
import logging
from typing import Any, Dict, Optional

from langchain_google_genai import ChatGoogleGenerativeAI

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
    api_key = settings.GOOGLE_AI_API_KEY or getattr(settings, "GOOGLE_API_KEY", None)
    self.llm = ChatGoogleGenerativeAI(
      model=model_name,
      google_api_key=api_key,
      temperature=0.3,
    )
    self.domain_classifier = self.llm.with_structured_output(DomainDecision)

  async def classify_domain(self, user_input: str, has_wallet: bool) -> DomainDecision:
    """Step 1: Classify user's intent into a domain."""
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
If user asks for balance/send/history but has NO wallet, still classify correctly but set requires_wallet=True.
"""
    return await self.domain_classifier.ainvoke([
      ("system", prompt),
      ("human", user_input),
    ])

  async def select_and_run_tool(
    self,
    user_input: str,
    domain: Domain,
    context: Dict[str, Any],
  ) -> str | Dict[str, Any]:
    """Step 2: Select a tool from the domain and execute it."""
    domain_tools = DOMAIN_TOOLS.get(domain, [])

    if not domain_tools:
      # Conversation domain - generate response without tools
      response = await self.llm.ainvoke([
        ("system", "You are a helpful wallet assistant. Respond briefly."),
        ("human", user_input),
      ])
      return getattr(response, "content", str(response))

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

    if not getattr(ai_msg, "tool_calls", None):
      return "I understood your request but couldn't determine the exact action. Please be more specific."

    call = ai_msg.tool_calls[0]
    tool_name = call.get("name")
    tool_args = call.get("args", {}) or {}

    return await self._execute_tool(tool_name, tool_args, context)

  async def _execute_tool(
    self,
    tool_name: str,
    tool_args: Dict[str, Any],
    context: Dict[str, Any],
  ) -> str | Dict[str, Any]:
    """Execute a tool with automatic context injection."""
    tool = TOOL_REGISTRY.get(tool_name)
    if not tool:
      return f"Unknown action: {tool_name}"

    sig = inspect.signature(tool.func if hasattr(tool, "func") else tool)
    for param in sig.parameters:
      if param in context and param not in tool_args:
        tool_args[param] = context[param]

    try:
      # Handle async tools
      if inspect.iscoroutinefunction(tool.func if hasattr(tool, "func") else tool):
        result = await tool.ainvoke(tool_args)
      else:
        result = tool.invoke(tool_args)

      if isinstance(result, dict):
        if result.get("error"):
          return f"❌ {result['error']}"
        if result.get("needs_signing"):
          return result
        return result.get("message", str(result))

      return str(result)

    except Exception as exc:
      logger.exception("Tool %s failed", tool_name)
      return f"❌ Error: {exc}"

  async def run(
    self,
    user_input: str,
    user_id: str,
    wallet_address: Optional[str] = None,
  ) -> Dict[str, Any]:
    """
    Main entry point.

    Returns:
        {
            "text": str,
            "action": str | None,
            "needs_signing": bool,
            "tx_data": dict | None
        }
    """
    context = {
      "user_id": user_id,
      "wallet_address": wallet_address,
    }

    decision = await self.classify_domain(user_input, has_wallet=bool(wallet_address))

    logger.info(
      "Domain: %s (conf=%.2f): %s",
      decision.domain,
      decision.confidence,
      decision.reason,
    )

    if decision.requires_wallet and not wallet_address:
      if decision.domain in [Domain.balance, Domain.payments, Domain.history, Domain.nfts]:
        return {
          "text": "❌ No wallet linked yet. Use /start to connect your wallet first.",
          "action": None,
          "needs_signing": False,
        }

    result = await self.select_and_run_tool(user_input, decision.domain, context)

    if isinstance(result, dict) and result.get("needs_signing"):
      return {
        "text": result.get("message", "Transaction ready"),
        "action": "send_sui",
        "needs_signing": True,
        "tx_data": result,
      }

    return {
      "text": result if isinstance(result, str) else str(result),
      "action": decision.domain.value,
      "needs_signing": False,
    }


wallet_agent = WalletAgent()
