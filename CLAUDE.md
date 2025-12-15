# CLAUDE OPS MANUAL (AI Copilot Wallet)

Use this as both a PRD builder and the working prompt for coding. Stay spec-driven, test-driven, and iterative. Keep git history clean and rerun tests after each significant change.

## Product Context (high level)
- Telegram-first wallet assistant for Sui. Bot (Python/aiogram/aiohttp + Postgres) issues linking tokens and persists wallet links (zkLogin or Slush/Wallet Standard).
- Web dApp (React/Vite) at `/link/:handle?token=...` handles zkLogin (Google OAuth + Mysten salt/prover) or existing wallet, then Telegram Login Widget verification.
- Smart contracts (Move): batch_transfer (fresh object-derived batch_id), contact_registry (TableWithLength), spending_guardian guardrails.
- AI layer (Gemini) drives intents for balance/send/history/contacts.

## Workflow (spec- & test-driven, recursive loop)
1) Clarify scope & success criteria before coding:
   - Define acceptance tests (unit/integration/e2e) up front.
   - Identify impacted surfaces: bot API (/api/link/*), web-dapp flows, Move modules, DB schema, nginx, docker-compose.
2) Write/adjust tests first:
   - Python: unit/integration for linking, wallet linking, Telegram verify, error paths.
   - Web: component/integration for LinkPage (token fetch fallback, wallet connect, Telegram verify), API client stubs.
   - Move: `sui move test` for contracts (batch ids unique, TableWithLength behavior).
3) Implement in small slices; after each slice:
   - Run targeted tests, then broader suites.
   - If schema changes, add migrations or init SQL updates and rerun integration.
   - Commit with clear message once a meaningful unit of value is done.
4) Regressions & reruns:
   - After new features, rerun prior relevant tests (recursive loop).
   - Re-verify webhook/link flows if touching bot/web APIs.
5) Keep playground notes below (for yourself) while working.

## Success Criteria (tailor per task)
- Linking: `/api/link/{token}`, `/wallet`, `/telegram-verify`, `/complete` return 2xx, persist wallet + zkLogin salt/sub, and bind Telegram ID. Tokens reject after expiry.
- Web dApp: LinkPage handles valid token, 404 fallback, wallet connect, Telegram Login Widget domain ok, completes flow and shows “linked”.
- Bot: `/start` issues valid link; `/balance`, `/send`, `/history`, `/contacts`, `/connect <addr>` work when wallet is linked; safe handling of blocked chats (no crashes).
- Move: batch_transfer uses fresh object-derived batch_id (no collisions), contact_registry uses TableWithLength; tests pass.
- Docs: README and IMPLEMENTATION_STATUS updated when features change.

## Testing Checklist (run as applicable)
- Python: `pytest` (add/maintain tests for linking/session persistence/telegram-verify), lint if configured.
- Web: `npm run test` (or vitest), `npm run build`.
- Move: `sui move test`.
- Integration: exercise `/start` → link page → wallet connect → Telegram verify; `/balance` and `/history` on linked wallet.
- Deployment sanity (if touched): build web-dapp, rsync to nginx root; `docker-compose up -d` relevant services; webhook set with secret.

## Git Hygiene
- Small commits per feature/fix; meaningful messages.
- Never revert user changes unintentionally.
- If schema changes, include migration/init SQL update in same commit.
- Re-run tests before commit; note what was run in the message body if helpful.

## PRD Builder (fill before coding each feature)
- Feature name:
- Problem:
- Users:
- Acceptance criteria / tests:
  1)
  2)
  3)
- Risks / edge cases:
- Rollback plan:

## Scratchpad (use during work; keep/trim before commit)
- Notes:
- Decisions:
- Follow-ups:

## Recursive Testing Loop (mini-playbook)
1) Restate goal + tests to satisfy.
2) Write/adjust tests.
3) Implement minimal code to pass.
4) Run tests; fix; rerun.
5) Check regressions (prior suites).
6) Update docs/status if needed.
7) Commit.