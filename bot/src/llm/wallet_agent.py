import inspect
import logging
from enum import Enum
from typing import Any, Dict, List, Optional, TypedDict

import asyncio
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from src.core import settings

logger = logging.getLogger(__name__)


class Domain(str, Enum):
  payments = "payments"
  nft = "nft"
  contacts = "contacts"
  wallet = "wallet"
  fallback = "fallback"


# --- Tool implementations (demo) ---------------------------------------------
@tool
def send_sui_coins(recipient: str, amount: float, token: str = "SUI") -> str:
  """Send coins to a saved contact or raw address."""
  return f"Prepared transfer of {amount} {token} to {recipient}."


@tool
def get_nfts(user_id: str) -> str:
  """List NFTs owned by the user."""
  return f"NFTs for {user_id}: capybara-nft-1, capybara-nft-2."


@tool
def get_contacts(user_id: str) -> str:
  """Show wallet contacts saved for this user."""
  return f"Contacts for {user_id}: Tania -> 0xabc...42, Raul -> 0xdef...99."


@tool
def get_balance(user_id: str) -> str:
  """Return current wallet balance summary."""
  return f"Balance for {user_id}: 42.5 SUI and 120.0 USDC."


ALL_TOOLS = [send_sui_coins, get_nfts, get_contacts, get_balance]
DOMAIN_TOOLS: Dict[Domain, List[Any]] = {
  Domain.payments: [send_sui_coins],
  Domain.nft: [get_nfts],
  Domain.contacts: [get_contacts],
  Domain.wallet: [get_balance],
}
TOOL_REGISTRY = {tool.name: tool for tool in ALL_TOOLS}


class DomainDecision(BaseModel):
  domain: Domain = Field(..., description="Which wallet domain the user asked about.")
  confidence: float = Field(..., description="0-1 confidence for the chosen domain.")
  reason: str = Field(..., description="Why this domain fits.")


class ToolPlan(BaseModel):
  domain: Domain
  tool: str = Field(..., description="Name of the tool to run.")
  args: Dict[str, Any] = Field(default_factory=dict, description="Arguments for the tool.")
  reason: str = Field(..., description="Why this tool and args make sense.")


class State(TypedDict, total=False):
  user_input: str
  user_id: str
  domain: Domain
  domain_reason: str
  tool_name: str
  tool_args: Dict[str, Any]
  tool_result: str


class WalletGraphAgent:
  """
  LangGraph-based wallet agent:
    1) classify domain (structured output)
    2) select a tool via LLM tool-calling
    3) execute the tool locally
  """

  def __init__(
    self,
    model_name: Optional[str] = None,
    google_api_key: Optional[str] = None,
    model_base_url: Optional[str] = None,
  ) -> None:
    api_key = google_api_key or settings.GOOGLE_AI_API_KEY or getattr(settings, "GOOGLE_API_KEY", None)
    model = model_name or getattr(settings, "GEMINI_MODEL", None) or "gemini-2.0-flash"

    extra_kwargs = {"model": model, "google_api_key": api_key}
    if model_base_url:
      extra_kwargs["base_url"] = model_base_url

    self.llm = ChatGoogleGenerativeAI(**extra_kwargs)
    self.domain_classifier = self.llm.with_structured_output(DomainDecision)

    graph = StateGraph(State)
    graph.add_node("classify", self._classify_domain)
    graph.add_node("select_tool", self._select_tool)
    graph.add_node("run_tool", self._run_tool)

    graph.add_edge(START, "classify")
    graph.add_edge("classify", "select_tool")
    graph.add_edge("select_tool", "run_tool")
    graph.add_edge("run_tool", END)

    self.app = graph.compile()

  async def _classify_domain(self, state: State) -> State:
    prompt = (
      "Classify the user's request into a wallet domain. "
      "Use one of: payments (sending coins), nft (NFT portfolio actions), "
      "contacts (contact list management), wallet (balances or general wallet info), "
      "fallback (not wallet related)."
    )
    decision = await asyncio.to_thread(
      self.domain_classifier.invoke,
      [
        ("system", prompt),
        ("human", state["user_input"]),
      ],
    )
    state["domain"] = decision.domain
    state["domain_reason"] = decision.reason
    return state

  async def _select_tool(self, state: State) -> State:
    domain = state.get("domain", Domain.fallback)
    domain_tools = DOMAIN_TOOLS.get(domain, [])

    if domain == Domain.fallback or not domain_tools:
      state["tool_name"] = "fallback"
      state["tool_args"] = {}
      return state

    llm_with_tools = self.llm.bind_tools(domain_tools)
    system_msg = (
      "You are a wallet routing assistant. Choose exactly one tool and provide "
      "arguments extracted from the user's text. Prefer addresses or contact names as recipients."
    )
    ai_msg = await asyncio.to_thread(
      llm_with_tools.invoke,
      [
        ("system", system_msg),
        ("human", f"User ID: {state.get('user_id','unknown')}. Request: {state['user_input']}"),
      ],
    )

    if not getattr(ai_msg, "tool_calls", None):
      state["tool_name"] = "fallback"
      state["tool_args"] = {}
      return state

    call = ai_msg.tool_calls[0]
    state["tool_name"] = call["name"]
    state["tool_args"] = call.get("args", {})
    return state

  async def _run_tool(self, state: State) -> State:
    tool_name = state.get("tool_name", "fallback")
    if tool_name == "fallback":
      state["tool_result"] = "I could not match your request to a wallet action."
      return state

    tool = TOOL_REGISTRY.get(tool_name)
    if not tool:
      state["tool_result"] = f"Unknown tool: {tool_name}"
      return state

    signature = inspect.signature(tool.func)
    if "user_id" in signature.parameters:
      state.setdefault("tool_args", {})
      state["tool_args"].setdefault("user_id", state.get("user_id", "unknown"))

    try:
      result = tool.invoke(state["tool_args"])
      state["tool_result"] = str(result)
    except Exception as exc:  # pragma: no cover - defensive
      logger.exception("Tool execution failed", exc_info=exc)
      state["tool_result"] = f"Tool {tool_name} failed: {exc}"
    return state

  async def run(self, user_input: str, user_id: str, wallet_address: Optional[str] = None) -> Dict[str, Any]:
    """Execute the graph and return a router-friendly payload."""
    try:
      initial_state: State = {"user_input": user_input, "user_id": user_id}
      final_state = await self.app.ainvoke(initial_state)

      domain = final_state.get("domain", Domain.fallback)
      tool_name = final_state.get("tool_name", "fallback")
      tool_result = final_state.get("tool_result", "")

      text_response = (
        "Your request does not look wallet-related. Please try again."
        if domain == Domain.fallback
        else f"Domain: {domain}\nAction: {tool_name}\nResult: {tool_result}"
      )

      return {
        "text": text_response,
        "action": tool_name if tool_name != "fallback" else None,
        "needs_signing": False,
        "tx_data": None,
      }
    except Exception as exc:
      logger.error("Agent run failed: %s", exc)
      return {
        "text": "❌ Sorry, something went wrong. Try /help",
        "action": None,
        "needs_signing": False,
        "tx_data": None,
      }


# Singleton instance used by handlers/tests
wallet_agent = WalletGraphAgent()
