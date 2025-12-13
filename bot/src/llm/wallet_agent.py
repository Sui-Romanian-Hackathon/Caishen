"""
Wallet Agent - LangGraph-based NL router with tool calling.

Flow:
  START → classify → route → [select_tool → run_tool] OR [chat] → END
"""

import asyncio
import inspect
import logging
import re
from typing import Any, Dict, List, Optional, TypedDict, Literal

from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import END, START, StateGraph

from src.core import settings
from src.llm.domains import Domain, DomainDecision
from src.llm.tools import DOMAIN_TOOLS, TOOL_REGISTRY

logger = logging.getLogger(__name__)


# ============================================================================
# Keyword-based fallback classification
# ============================================================================

KEYWORD_TO_DOMAIN = {
    Domain.balance: ["balance", "how much sui", "how much do i have", "check wallet", "my funds", "wallet balance", "show balance"],
    Domain.payments: ["send", "transfer", "pay", "give sui"],
    Domain.contacts: ["contacts", "contact", "address book", "add contact", "delete contact", "remove contact", "save address", "show contacts", "my contacts"],
    Domain.history: ["history", "transactions", "recent", "activity", "what did i send", "what did i receive", "show history", "transaction history"],
    Domain.nfts: ["nft", "nfts", "collectibles", "digital art", "show nft", "my nft"],
    Domain.help: ["help", "commands", "what can you do", "how do i", "reset", "clear history", "start over", "start", "connect", "link wallet"],
}


def keyword_classify(user_input: str) -> Optional[Domain]:
    """Fallback keyword-based classification"""
    text_lower = user_input.lower()
    for domain, keywords in KEYWORD_TO_DOMAIN.items():
        for keyword in keywords:
            if keyword in text_lower:
                return domain
    return None


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
        llm: Optional[Any] = None,
        chat_llm: Optional[Any] = None,
        domain_tools: Optional[Dict[Domain, List[Any]]] = None,
        tool_registry: Optional[Dict[str, Any]] = None,
    ) -> None:
        api_key = google_api_key or settings.GOOGLE_AI_API_KEY or getattr(settings, "GOOGLE_API_KEY", None)
        model = model_name or getattr(settings, "GEMINI_MODEL", None) or "gemini-2.0-flash"

        # Allow injection for tests
        self.llm = llm or ChatGoogleGenerativeAI(
            model=model,
            google_api_key=api_key,
            temperature=0.3,
        )
        self.chat_llm = chat_llm or ChatGoogleGenerativeAI(
            model=model,
            google_api_key=api_key,
            temperature=0.7,  # Higher for more natural conversation
        )
        # Structured output classifier
        if hasattr(self.llm, "with_structured_output"):
            self.domain_classifier = self.llm.with_structured_output(DomainDecision)
        else:
            self.domain_classifier = self.llm

        self.domain_tools = domain_tools or DOMAIN_TOOLS
        self.tool_registry = tool_registry or TOOL_REGISTRY

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

        prompt = f"""Classify this user message into exactly ONE domain. PREFER ACTION DOMAINS over conversation.

Domains (in order of priority):
1. balance: ANY mention of balance, funds, how much SUI, check wallet, my wallet (keywords: balance, how much, funds, wallet, check)
2. payments: ANY mention of sending/transferring (keywords: send, transfer, pay, give, move)
3. contacts: ANY mention of contacts or address book (keywords: contact, contacts, address book, save address, add, delete, remove)
4. history: ANY mention of transactions or history (keywords: history, transactions, recent, activity, sent, received)
5. nfts: ANY mention of NFTs (keywords: NFT, NFTs, collectibles, digital art)
6. help: User wants help, commands, or reset (keywords: help, commands, what can you do, how, reset, clear, start over)
7. conversation: ONLY for pure greetings or off-topic chat (hello, hi, thanks, good morning, how are you, what is blockchain)

User has linked wallet: {has_wallet}

CRITICAL RULES:
- If message contains "balance", "history", "contacts", "send", "transfer", "NFT" → USE THAT DOMAIN, not conversation
- "show my balance" → balance (NOT conversation)
- "show my history" → history (NOT conversation)
- "show my contacts" → contacts (NOT conversation)
- "send 1 SUI to alice" → payments (NOT conversation)
- "what can you do" → help (NOT conversation)
- ONLY use "conversation" for pure greetings like "hello" or "hi" or completely unrelated topics
- Set requires_wallet=True for: balance, payments, history, nfts
- Set requires_wallet=False for: contacts, help, conversation
"""
        # First, try keyword-based classification as a fast check
        keyword_domain = keyword_classify(user_input)

        try:
            # Run synchronously inside a thread to avoid event-loop init errors from the SDK
            decision = await asyncio.to_thread(
                self.domain_classifier.invoke,
                [("system", prompt), ("human", user_input)],
            )

            # If LLM says conversation but keywords say otherwise, trust keywords
            if decision.domain == Domain.conversation and keyword_domain is not None:
                logger.info(f"LLM said conversation, but keywords detected {keyword_domain} - using keywords")
                state["domain"] = keyword_domain
                state["domain_confidence"] = 0.8
                state["domain_reason"] = f"Keyword match for {keyword_domain.value}"
                state["requires_wallet"] = keyword_domain in [Domain.balance, Domain.payments, Domain.history, Domain.nfts]
            else:
                state["domain"] = decision.domain
                state["domain_confidence"] = decision.confidence
                state["domain_reason"] = decision.reason
                state["requires_wallet"] = decision.requires_wallet

            logger.info(f"Classified: {state['domain']} (conf={state['domain_confidence']:.2f}): {state['domain_reason']}")

        except Exception as e:
            logger.error(f"Domain classification failed: {e}")
            # Use keyword fallback on error
            if keyword_domain:
                state["domain"] = keyword_domain
                state["domain_confidence"] = 0.7
                state["domain_reason"] = f"Keyword fallback: {keyword_domain.value}"
                state["requires_wallet"] = keyword_domain in [Domain.balance, Domain.payments, Domain.history, Domain.nfts]
            else:
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
            action_name = {
                Domain.balance: "check your balance",
                Domain.payments: "send SUI",
                Domain.history: "view transaction history",
                Domain.nfts: "view your NFTs",
            }.get(domain, "do that")
            state["result"] = f"❌ No wallet linked. Use /start to connect your Sui wallet first to {action_name}."

        return state

    def _route_after_wallet_check(self, state: AgentState) -> Literal["no_wallet_error", "needs_tool", "needs_chat"]:
        """Conditional edge: Route based on wallet check and domain"""
        if state.get("error") == "no_wallet":
            return "no_wallet_error"

        domain = state.get("domain", Domain.conversation)
        domain_tools = self.domain_tools.get(domain, [])

        if domain_tools:
            return "needs_tool"
        else:
            return "needs_chat"

    async def _select_tool(self, state: AgentState) -> AgentState:
        """Node: Select a tool from the domain"""
        domain = state.get("domain", Domain.conversation)
        user_input = state["user_input"]

        domain_tools = self.domain_tools.get(domain, [])

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
            # Run synchronously inside a thread to avoid event-loop init errors from the SDK
            ai_msg = await asyncio.to_thread(
                llm_with_tools.invoke,
                [("system", system_msg), ("human", f"User request: {user_input}")],
            )

            if getattr(ai_msg, "tool_calls", None):
                call = ai_msg.tool_calls[0]
                state["tool_name"] = call["name"]
                state["tool_args"] = call.get("args", {})
                logger.info(f"Selected tool: {call['name']} with args: {call.get('args', {})}")

        except Exception as e:
            logger.error(f"Tool selection failed: {e}")

        # Fallback: deterministic selection if LLM did not pick a tool
        if not state.get("tool_name"):
            fallback_tool, fallback_args, fallback_msg = self._fallback_tool_selection(domain, user_input)
            if fallback_tool:
                state["tool_name"] = fallback_tool
                state["tool_args"] = fallback_args
                logger.info(f"Fallback-selected tool: {fallback_tool} with args: {fallback_args}")
            else:
                state["tool_name"] = None
                state["tool_args"] = {}
                state["result"] = fallback_msg or f"I understood you want help with {domain.value}, but I couldn't determine the specific action. Please try again."

        return state

    def _fallback_tool_selection(self, domain: Domain, user_input: str) -> tuple[Optional[str], Dict[str, Any], Optional[str]]:
        """
        Deterministic tool selection when LLM tool-calling fails.
        Returns (tool_name, tool_args, error_msg)
        """
        text = user_input.lower()
        args: Dict[str, Any] = {}

        def first_number(s: str) -> Optional[float]:
            match = re.search(r"([0-9]+(?:\.[0-9]+)?)", s)
            return float(match.group(1)) if match else None

        def find_address(s: str) -> Optional[str]:
            m = re.search(r"(0x[a-fA-F0-9]{40,64})", s)
            return m.group(1) if m else None

        if domain == Domain.balance:
            return "get_balance", args, None

        if domain == Domain.history:
            limit = first_number(text)
            if limit:
                args["limit"] = int(limit)
            return "get_transaction_history", args, None

        if domain == Domain.nfts:
            limit = first_number(text)
            if limit:
                args["limit"] = int(limit)
            return "get_nfts", args, None

        if domain == Domain.help:
            if "reset" in text or "clear" in text:
                return "reset_conversation", args, None
            return "get_help", args, None

        if domain == Domain.contacts:
            if "delete" in text or "remove" in text:
                name_match = re.search(r"(?:delete|remove)\s+([a-zA-Z0-9_\-]+)", user_input, re.IGNORECASE)
                if name_match:
                    args["name"] = name_match.group(1)
                    return "delete_contact", args, None
                return None, {}, "Please tell me which contact to remove."
            if "add" in text or "save" in text:
                address = find_address(user_input)
                name_match = re.search(r"(?:add|save)\s+([a-zA-Z0-9_\-]+)", user_input, re.IGNORECASE)
                if address and name_match:
                    args["name"] = name_match.group(1)
                    args["address"] = address
                    return "add_new_contact", args, None
                return None, {}, "To add a contact, say: add alice 0x123..."
            return "list_contacts", args, None

        if domain == Domain.payments:
            amount = first_number(user_input)
            recipient = find_address(user_input)
            if not recipient:
                # try word after 'to'
                to_match = re.search(r"to\s+([a-zA-Z0-9_\-]+)", user_input, re.IGNORECASE)
                if to_match:
                    recipient = to_match.group(1)
            if amount is None or amount <= 0:
                return None, {}, "Please provide an amount to send, e.g., 'send 1 SUI to alice'."
            if not recipient:
                return None, {}, "Please provide a recipient (0x address or contact name)."
            args["amount"] = amount
            args["recipient"] = recipient
            return "send_sui", args, None

        # conversation or unknown
        return None, {}, None

    async def _run_tool(self, state: AgentState) -> AgentState:
        """Node: Execute the selected tool"""
        tool_name = state.get("tool_name")
        tool_args = state.get("tool_args", {})

        if not tool_name:
            if not state.get("result"):
                state["result"] = "No action could be determined."
            return state

        tool = self.tool_registry.get(tool_name)
        if not tool:
            state["result"] = f"❌ Unknown action: {tool_name}"
            return state

        # Auto-inject context (user_id, wallet_address) if needed
        # ALWAYS override these with correct values - LLM may hallucinate addresses
        context = {
            "user_id": state.get("user_id"),
            "wallet_address": state.get("wallet_address"),
        }

        try:
            func = tool.func if hasattr(tool, 'func') else tool
            sig = inspect.signature(func)
            for param in sig.parameters:
                if param in context and context[param] is not None:
                    # ALWAYS use context value for user_id and wallet_address
                    # LLM may hallucinate or pass malformed values
                    if param in tool_args and tool_args[param] != context[param]:
                        logger.debug(f"Overriding LLM-provided {param}={tool_args[param]} with context value")
                    tool_args[param] = context[param]
        except Exception as e:
            logger.warning(f"Could not inspect tool signature: {e}")

        logger.debug(f"Final tool_args for {tool_name}: {tool_args}")

        # Check if wallet_address is required but still missing
        if "wallet_address" in tool_args or tool_name in ["get_balance", "send_sui", "get_transaction_history", "get_nfts"]:
            if not tool_args.get("wallet_address"):
                state["result"] = "❌ No wallet linked yet. Use /start to connect your wallet first."
                state["error"] = "no_wallet"
                return state

        # Execute tool
        try:
            func = tool.func if hasattr(tool, 'func') else tool
            if hasattr(tool, "ainvoke"):
                result = await tool.ainvoke(tool_args)
            elif asyncio.iscoroutinefunction(func):
                result = await func(**tool_args)
            elif hasattr(tool, "invoke"):
                result = await asyncio.to_thread(tool.invoke, tool_args)
            else:
                result = await asyncio.to_thread(func, **tool_args)

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
                "tx_data": dict | None, # Transaction data for signing
                "domain": str | None,  # Classified domain
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
            tool_name = final_state.get("tool_name")

            return {
                "text": result,
                "action": tool_name or (domain.value if domain != Domain.conversation else None),
                "needs_signing": needs_signing,
                "tx_data": tx_data,
                "domain": domain.value if domain else None,
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
