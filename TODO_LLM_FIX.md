# TODO — Fix LLM Tool Calling

Current state:
- `bot/src/llm/wallet_agent.py` (LangGraph demo) uses stub tools and its own Domain enum (`payments/nft/contacts/wallet/fallback`), so it never calls the real Sui/contact/history helpers.
- `bot/src/llm/tools.py` defines the production tools (balance/send/history/contacts/NFT/help/reset) but is not wired into the agent.
- Router expects `{text, action, needs_signing, tx_data}` and canned requests, but gets stub text only; signing links and real data aren’t surfaced.

Plan to restore/enable real tool calling:
1) Align Domains:
   - Use `bot/src/llm/domains.py` Domain values (`payments, balance, nfts, contacts, history, help, conversation`) in the agent.
2) Swap to real tools:
   - Replace the demo tools in `wallet_agent.py` with imports from `bot/src/llm/tools.py`.
   - Domain → tools mapping should use `DOMAIN_TOOLS` from tools.py.
3) Tool execution wiring:
   - Keep router-friendly return shape `{text, action, needs_signing, tx_data}`.
   - If tool result is dict with `needs_signing`, forward it so router can build signing link (current router logic already handles this).
4) Async/sync handling:
   - Continue using `asyncio.to_thread` for structured/classifier calls if needed, but ensure `bind_tools` uses the imported tool set.
5) Help/HTML safety:
   - Keep help text escaped (already fixed) and ensure `get_help` tool returns safe text.
6) Testing checklist:
   - `/help` shows commands.
   - “show my balance” → real balance via `get_balance`.
   - “send 1 SUI to alice” → returns signing link (needs contact or address).
   - “show my contacts” → lists contacts from DB.
   - “history” → returns transaction history.
   - “show my nfts” → returns NFT list (or handled error).
   - “reset” → clears conversation history.
