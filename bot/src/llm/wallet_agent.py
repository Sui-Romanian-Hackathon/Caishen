"""
Wallet Agent - LangGraph-based NL router with tool calling.

Flow:
  START → classify → route → [select_tool → run_tool] OR [chat] → END
"""

import asyncio
import inspect
import logging
from typing import Any, Dict, List, Optional, TypedDict, Literal

from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import END, START, StateGraph

from src.core import settings
from src.llm.domains import Domain, DomainDecision
from src.llm.tools import DOMAIN_TOOLS, TOOL_REGISTRY

logger = logging.getLogger(__name__)


# ============================================================================
# State Definition
# ============================================================================

class AgentState(TypedDict, total=False):
    """State that flows through the graph"""
    # Input
    user_input: str
    user_id: str
    wallet_address: Optional[str]

    # Domain classification
    domain: Domain
    domain_confidence: float
    domain_reason: str
    requires_wallet: bool

    # Tool selection
    tool_name: Optional[str]
    tool_args: Dict[str, Any]

    # Output
    result: str
    needs_signing: bool
    tx_data: Optional[Dict[str, Any]]
    error: Optional[str]


# ============================================================================
# LangGraph Wallet Agent
# ============================================================================

class WalletGraphAgent:
    """
    LangGraph-based wallet agent:
      1) Classify domain (structured output)
      2) Route: if conversation → chat node, else → tool nodes
      3) Select tool via LLM tool-calling
      4) Execute tool locally
      5) Return result
    """

    def __init__(
        self,
        model_name: Optional[str] = None,
        google_api_key: Optional[str] = None,
    ) -> None:
        api_key = google_api_key or settings.GOOGLE_AI_API_KEY or getattr(settings, "GOOGLE_API_KEY", None)
        model = model_name or getattr(settings, "GEMINI_MODEL", None) or "gemini-2.0-flash"

        self.llm = ChatGoogleGenerativeAI(
            model=model,
            google_api_key=api_key,
            temperature=0.3,
        )
        self.chat_llm = ChatGoogleGenerativeAI(
            model=model,
            google_api_key=api_key,
            temperature=0.7,  # Higher for more natural conversation
        )
        self.domain_classifier = self.llm.with_structured_output(DomainDecision)

        # Build the graph
        self.app = self._build_graph()

    def _build_graph(self) -> StateGraph:
        """Build the LangGraph state machine"""
        graph = StateGraph(AgentState)

        # Add nodes
        graph.add_node("classify", self._classify_domain)
        graph.add_node("check_wallet", self._check_wallet_required)
        graph.add_node("select_tool", self._select_tool)
        graph.add_node("run_tool", self._run_tool)
        graph.add_node("chat", self._generate_chat)

        # Add edges
        graph.add_edge(START, "classify")
        graph.add_edge("classify", "check_wallet")

        # Conditional routing after wallet check
        graph.add_conditional_edges(
            "check_wallet",
            self._route_after_wallet_check,
            {
                "no_wallet_error": END,
                "needs_tool": "select_tool",
                "needs_chat": "chat",
            }
        )

        graph.add_edge("select_tool", "run_tool")
        graph.add_edge("run_tool", END)
        graph.add_edge("chat", END)

        return graph.compile()

    # ========================================================================
    # Graph Nodes
    # ========================================================================

    async def _classify_domain(self, state: AgentState) -> AgentState:
        """Node: Classify user intent into a domain"""
        user_input = state["user_input"]
        has_wallet = bool(state.get("wallet_address"))

        prompt = f"""Classify this user message into exactly ONE domain.

Domains:
- payments: User wants to SEND/TRANSFER/PAY coins (keywords: send, transfer, pay, give)
- balance: User wants to CHECK BALANCE (keywords: balance, how much, funds, wallet balance)
- contacts: User wants to MANAGE ADDRESS BOOK (keywords: contacts, add contact, save address, delete contact, remove contact)
- history: User wants to SEE TRANSACTIONS (keywords: history, transactions, recent, activity)
- nfts: User wants to SEE NFTs (keywords: NFT, collectibles, digital art)
- help: User wants HELP, INFO, or RESET (keywords: help, commands, what can you do, how do I, reset, clear history, start over, forget)
- conversation: General chat, greetings, questions NOT about wallet actions (hello, hi, thanks, how are you, what is sui, explain blockchain, good morning)

User has linked wallet: {has_wallet}

IMPORTANT:
- If the message is a greeting, thank you, or general question → "conversation"
- If asking about crypto/blockchain concepts (not actions) → "conversation"
- Only use action domains for actual wallet ACTIONS
- For "conversation" domain, set requires_wallet=False
"""
        try:
            decision = await asyncio.to_thread(
                self.domain_classifier.invoke,
                [("system", prompt), ("human", user_input)],
            )
            state["domain"] = decision.domain
            state["domain_confidence"] = decision.confidence
            state["domain_reason"] = decision.reason
            state["requires_wallet"] = decision.requires_wallet

            logger.info(f"Classified: {decision.domain} (conf={decision.confidence:.2f}): {decision.reason}")

        except Exception as e:
            logger.error(f"Domain classification failed: {e}")
            state["domain"] = Domain.conversation
            state["domain_confidence"] = 0.5
            state["domain_reason"] = "Classification error, defaulting to conversation"
            state["requires_wallet"] = False

        return state

    async def _check_wallet_required(self, state: AgentState) -> AgentState:
        """Node: Check if wallet is required but missing"""
        domain = state.get("domain", Domain.conversation)
        requires_wallet = state.get("requires_wallet", False)
        wallet_address = state.get("wallet_address")

        wallet_required_domains = [Domain.balance, Domain.payments, Domain.history, Domain.nfts]

        if requires_wallet and not wallet_address and domain in wallet_required_domains:
            state["error"] = "no_wallet"
            state["result"] = "❌ No wallet linked yet. Use /start to connect your wallet first."

        return state

    def _route_after_wallet_check(self, state: AgentState) -> Literal["no_wallet_error", "needs_tool", "needs_chat"]:
        """Conditional edge: Route based on wallet check and domain"""
        if state.get("error") == "no_wallet":
            return "no_wallet_error"

        domain = state.get("domain", Domain.conversation)
        domain_tools = DOMAIN_TOOLS.get(domain, [])

        if domain_tools:
            return "needs_tool"
        else:
            return "needs_chat"

    async def _select_tool(self, state: AgentState) -> AgentState:
        """Node: Select a tool from the domain"""
        domain = state.get("domain", Domain.conversation)
        user_input = state["user_input"]

        domain_tools = DOMAIN_TOOLS.get(domain, [])

        if not domain_tools:
            state["tool_name"] = None
            state["tool_args"] = {}
            return state

        llm_with_tools = self.llm.bind_tools(domain_tools)

        system_msg = """You are a Sui wallet assistant. Select exactly ONE tool and extract arguments from the user's text.

For send_sui: extract amount (number) and recipient (0x address or contact name like 'alice').
For add_new_contact: extract name and address.
For delete_contact: extract the contact name.
For history: optionally extract limit (number of transactions).

ALWAYS call a tool - don't respond with just text."""

        try:
            ai_msg = await asyncio.to_thread(
                llm_with_tools.invoke,
                [("system", system_msg), ("human", f"User request: {user_input}")],
            )

            if getattr(ai_msg, "tool_calls", None):
                call = ai_msg.tool_calls[0]
                state["tool_name"] = call["name"]
                state["tool_args"] = call.get("args", {})
                logger.info(f"Selected tool: {call['name']} with args: {call.get('args', {})}")
            else:
                state["tool_name"] = None
                state["tool_args"] = {}
                state["result"] = f"I understood you want help with {domain.value}, but I couldn't determine the specific action. Please try again."

        except Exception as e:
            logger.error(f"Tool selection failed: {e}")
            state["tool_name"] = None
            state["tool_args"] = {}
            state["error"] = str(e)
            state["result"] = f"❌ Error selecting action: {e}"

        return state

    async def _run_tool(self, state: AgentState) -> AgentState:
        """Node: Execute the selected tool"""
        tool_name = state.get("tool_name")
        tool_args = state.get("tool_args", {})

        if not tool_name:
            if not state.get("result"):
                state["result"] = "No action could be determined."
            return state

        tool = TOOL_REGISTRY.get(tool_name)
        if not tool:
            state["result"] = f"❌ Unknown action: {tool_name}"
            return state

        # Auto-inject context (user_id, wallet_address) if needed
        # Also replace empty/falsy values that LLM may have passed
        context = {
            "user_id": state.get("user_id"),
            "wallet_address": state.get("wallet_address"),
        }

        try:
            func = tool.func if hasattr(tool, 'func') else tool
            sig = inspect.signature(func)
            for param in sig.parameters:
                if param in context and context[param] is not None:
                    # Inject if missing OR if LLM passed empty/falsy value
                    if param not in tool_args or not tool_args.get(param):
                        tool_args[param] = context[param]
        except Exception as e:
            logger.warning(f"Could not inspect tool signature: {e}")

        # Check if wallet_address is required but still missing
        if "wallet_address" in tool_args or tool_name in ["get_balance", "send_sui", "get_transaction_history", "get_nfts"]:
            if not tool_args.get("wallet_address"):
                state["result"] = "❌ No wallet linked yet. Use /start to connect your wallet first."
                state["error"] = "no_wallet"
                return state

        # Execute tool
        try:
            func = tool.func if hasattr(tool, 'func') else tool
            if asyncio.iscoroutinefunction(func):
                result = await tool.ainvoke(tool_args)
            else:
                result = await asyncio.to_thread(tool.invoke, tool_args)

            # Handle dict results (send_sui returns signing data)
            if isinstance(result, dict):
                if result.get("error"):
                    state["result"] = f"❌ {result['error']}"
                elif result.get("needs_signing"):
                    state["result"] = result.get("message", "Transaction ready")
                    state["needs_signing"] = True
                    state["tx_data"] = result
                else:
                    state["result"] = result.get("message", str(result))
            else:
                state["result"] = str(result)

            logger.info(f"Tool {tool_name} executed successfully")

        except Exception as e:
            logger.exception(f"Tool {tool_name} failed")
            state["result"] = f"❌ Error executing {tool_name}: {e}"
            state["error"] = str(e)

        return state

    async def _generate_chat(self, state: AgentState) -> AgentState:
        """Node: Generate natural conversation response"""
        user_input = state["user_input"]
        wallet_address = state.get("wallet_address")
        wallet_status = "linked" if wallet_address else "not linked yet"

        system_msg = f"""You are a friendly AI assistant for a Sui blockchain wallet on Telegram.

User's wallet status: {wallet_status}

You help users with:
- Checking their SUI balance
- Sending SUI to addresses or contacts
- Managing contacts (add, list, remove)
- Viewing transaction history
- Understanding the Sui blockchain and crypto concepts

Be friendly, helpful, and concise. If the user needs to take a wallet action, guide them.
Examples: "Just say 'check my balance' or 'send 1 SUI to alice'"

If they haven't linked a wallet yet, mention they can use /start to connect one.

Keep responses short - this is a chat interface, not a document."""

        try:
            response = await asyncio.to_thread(
                self.chat_llm.invoke,
                [("system", system_msg), ("human", user_input)],
            )
            state["result"] = response.content
        except Exception as e:
            logger.error(f"Chat generation failed: {e}")
            state["result"] = "I'm here to help with your Sui wallet! Try asking about your balance, sending SUI, or managing contacts."
            state["error"] = str(e)

        return state

    # ========================================================================
    # Public Interface
    # ========================================================================

    async def run(
        self,
        user_input: str,
        user_id: str,
        wallet_address: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Main entry point - runs the LangGraph agent.

        Returns:
            {
                "text": str,           # Response to show user
                "action": str | None,  # Domain/action taken
                "needs_signing": bool, # If send_sui needs signing link
                "tx_data": dict | None # Transaction data for signing
            }
        """
        initial_state: AgentState = {
            "user_input": user_input,
            "user_id": user_id,
            "wallet_address": wallet_address,
            "tool_args": {},
            "needs_signing": False,
            "tx_data": None,
        }

        try:
            final_state = await self.app.ainvoke(initial_state)

            domain = final_state.get("domain", Domain.conversation)
            result = final_state.get("result", "I'm not sure how to help with that.")
            needs_signing = final_state.get("needs_signing", False)
            tx_data = final_state.get("tx_data")

            return {
                "text": result,
                "action": domain.value if domain != Domain.conversation else None,
                "needs_signing": needs_signing,
                "tx_data": tx_data,
            }

        except Exception as e:
            logger.exception("Agent run failed")
            return {
                "text": "❌ Sorry, something went wrong. Try /help",
                "action": None,
                "needs_signing": False,
                "tx_data": None,
            }


# Singleton instance
wallet_agent = WalletGraphAgent()
