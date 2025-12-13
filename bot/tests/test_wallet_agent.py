import asyncio
import sys
import unittest
from pathlib import Path
from typing import Any, Dict

repo_root = Path(__file__).resolve().parents[2]
sys.path.append(str(repo_root / "bot"))
sys.path.append(str(repo_root / "bot" / "src"))

from src.llm.domains import Domain, DomainDecision
from src.llm.wallet_agent import WalletAgent


class _FakeToolMsg:
    def __init__(self, name: str, args: Dict[str, Any]):
        self.tool_calls = [{"name": name, "args": args}]


class _FakeLLM:
    """
    Minimal fake LLM to drive WalletAgent without network calls.
    - First ainvoke returns DomainDecision
    - Second ainvoke (after bind_tools) returns a tool call with given args
    """

    def __init__(self, domain: Domain, tool_name: str, tool_args: Dict[str, Any]):
        self.domain = domain
        self.tool_name = tool_name
        self.tool_args = tool_args
        self.bound = False

    def with_structured_output(self, schema):
        self.schema = schema
        return self

    def bind_tools(self, tools):
        self.bound = True
        self.bound_tools = tools
        return self

    async def ainvoke(self, messages):
        if self.bound:
            return _FakeToolMsg(self.tool_name, self.tool_args)
        return DomainDecision(
            domain=self.domain,
            confidence=0.9,
            reason="test",
            requires_wallet=self.domain
            not in {Domain.help, Domain.conversation},
        )


class WalletAgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_send_sui_returns_signing_payload(self):
        fake_llm = _FakeLLM(
            domain=Domain.payments,
            tool_name="send_sui",
            tool_args={"recipient": "0xabc", "amount": 1.0},
        )

        async def fake_send_sui(recipient: str, amount: float, wallet_address: str, user_id: str):
            return {
                "action": "send_sui",
                "recipient": recipient,
                "amount": amount,
                "sender": wallet_address,
                "needs_signing": True,
                "message": "ready",
            }

        agent = WalletAgent(
            llm=fake_llm,
            domain_tools={Domain.payments: [fake_send_sui]},
            tool_registry={"send_sui": fake_send_sui},
        )

        result = await agent.run("send 1 sui", user_id="u1", wallet_address="0xsender")
        self.assertTrue(result["needs_signing"])
        self.assertEqual(result["action"], "send_sui")
        self.assertEqual(result["text"], "ready")
        self.assertIsNotNone(result["tx_data"])

    async def test_help_returns_text(self):
        fake_llm = _FakeLLM(
            domain=Domain.help,
            tool_name="get_help",
            tool_args={},
        )

        async def fake_help():
            return "help text"

        agent = WalletAgent(
            llm=fake_llm,
            domain_tools={Domain.help: [fake_help]},
            tool_registry={"get_help": fake_help},
        )

        result = await agent.run("help", user_id="u1", wallet_address=None)
        self.assertFalse(result["needs_signing"])
        self.assertIn("help text", result["text"])

    async def test_fallback_without_wallet(self):
        fake_llm = _FakeLLM(
            domain=Domain.payments,
            tool_name="send_sui",
            tool_args={"recipient": "0xabc", "amount": 1.0},
        )

        agent = WalletAgent(
            llm=fake_llm,
            domain_tools={Domain.payments: []},
            tool_registry={},
        )

        result = await agent.run("send 1 sui", user_id="u1", wallet_address=None)
        self.assertIn("No wallet linked", result["text"])
        self.assertFalse(result["needs_signing"])


if __name__ == "__main__":
    asyncio.run(unittest.main())
