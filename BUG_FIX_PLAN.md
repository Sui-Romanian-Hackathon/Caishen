# Bug Fix Plan - AI Copilot Wallet

> **Created:** December 13, 2025
> **Status:** Planning Phase
> **Spec Reference:** [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md), [AI_Copilot_Wallet_Product_Specification_with_zklogin_microservices.md](./AI_Copilot_Wallet_Product_Specification_with_zklogin_microservices.md)

---

## Overview

This document outlines the implementation plan for 7 bugs/features affecting the web-dapp and bot components.

---

## Bug 1: Autocomplete Form Fields from Telegram Link Parameters

### Problem
When users click a link from Telegram like:
```
https://caishen.iseethereaper.com/?mode=wallet&sender=0xf826...&recipient=0x...&amount=1.5
```
The form fields (recipient, amount, sender) are not being pre-populated from the URL parameters.

### Current Behavior
- `App.tsx:257-272` cleans URL parameters immediately on load, removing `recipient`, `amount`, `memo` before they can be used
- The form only populates from the `/api/pending-tx/:id` endpoint (secure flow), not from URL params

### Root Cause
The URL cleaning effect runs before the form can read the parameters for the direct link flow (mode=wallet with params).

### Affected Files
- `services/web-dapp/src/App.tsx` (lines 257-272, 72-73)

### Implementation Plan

1. **Read URL params before cleaning:**
   ```tsx
   // In Page component, add initial state from URL
   const [form, setForm] = useState(() => {
     const url = new URL(window.location.href);
     return {
       recipient: url.searchParams.get('recipient') || '',
       amount: url.searchParams.get('amount') || '',
       memo: url.searchParams.get('memo') || ''
     };
   });

   // Also read sender for display/validation
   const [sender] = useState(() => {
     const url = new URL(window.location.href);
     return url.searchParams.get('sender') || '';
   });

   // Read mode from URL
   const [mode, setMode] = useState<'wallet' | 'zklogin'>(() => {
     const url = new URL(window.location.href);
     return url.searchParams.get('mode') === 'zklogin' ? 'zklogin' : 'wallet';
   });
   ```

2. **Modify URL cleaning effect to preserve initial read:**
   - Move URL param reading to state initialization (lazy initial state)
   - Keep URL cleaning for security but after initial read

3. **Display sender address in UI:**
   - Show "Sending from: 0x..." when sender param is present
   - Validate that connected wallet matches sender if using wallet mode

### Acceptance Criteria
- [ ] Clicking link with `?recipient=0x...&amount=1.5&sender=0x...` pre-fills form
- [ ] Mode param (`?mode=wallet` or `?mode=zklogin`) sets correct tab
- [ ] Sender address is displayed in the UI
- [ ] URL is cleaned after initial read (no sensitive data in history)

### Testing
```bash
# Test URL
https://caishen.iseethereaper.com/?mode=wallet&recipient=0xabc123&amount=0.5&sender=0xdef456
```

---

## Bug 2: zkLogin Flow Not Triggering Google OAuth

### Problem
The zkLogin flow currently only uses the user's Slush/Sui wallet. When clicking "Continue with Google" for zkLogin, it should redirect to Google OAuth but this flow may not be working correctly.

### Current Behavior
- `LinkPage.tsx:174-217` has `startZkLogin()` function
- Function checks for `GOOGLE_CLIENT_ID` and redirects to Google OAuth
- Issue: After OAuth callback, zkLogin wallet is created but linking may not complete properly

### Root Cause Analysis
1. `GOOGLE_CLIENT_ID` may not be set in environment variables
2. OAuth redirect URI mismatch (currently uses `/link?token=...`)
3. After OAuth callback, the flow continues but may fail silently

### Affected Files
- `services/web-dapp/src/LinkPage.tsx` (lines 174-257)
- `services/web-dapp/src/App.tsx` (lines 195-237) - duplicate OAuth implementation
- `services/web-dapp/.env` or environment configuration

### Implementation Plan

1. **Verify environment configuration:**
   ```bash
   # Required in .env or build-time
   VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
   ```

2. **Fix OAuth redirect URI in LinkPage:**
   ```tsx
   // Current (line 203)
   const redirectUri = `${window.location.origin}/link?token=${token}`;

   // Should preserve the full path including handle
   const redirectUri = `${window.location.origin}${window.location.pathname}?token=${token}`;
   ```

3. **Add better error handling for OAuth callback:**
   ```tsx
   useEffect(() => {
     const hash = window.location.hash;
     if (hash.includes('id_token=')) {
       const match = hash.match(/id_token=([^&]+)/);
       if (match) {
         const jwt = decodeURIComponent(match[1]);
         handleZkLoginCallback(jwt);
         window.history.replaceState({}, '', window.location.pathname + window.location.search);
       }
     } else if (hash.includes('error=')) {
       // Handle OAuth errors
       const errorMatch = hash.match(/error=([^&]+)/);
       const descMatch = hash.match(/error_description=([^&]+)/);
       setError(`OAuth error: ${errorMatch?.[1]} - ${decodeURIComponent(descMatch?.[1] || '')}`);
       setStep('error');
     }
   }, []);
   ```

4. **Add loading state during OAuth flow:**
   - Show "Redirecting to Google..." before redirect
   - Show "Processing authentication..." after callback

5. **Verify Google Cloud Console settings:**
   - Authorized JavaScript origins: `https://caishen.iseethereaper.com`
   - Authorized redirect URIs: `https://caishen.iseethereaper.com/link`

### Acceptance Criteria
- [ ] "Continue with Google" button redirects to Google OAuth
- [ ] After Google sign-in, user is redirected back with JWT
- [ ] zkLogin address is derived from JWT + salt
- [ ] zkLogin wallet is linked to Telegram account
- [ ] Clear error messages for OAuth failures

### Testing
1. Click "Continue with Google" from LinkPage
2. Sign in with Google
3. Verify redirect back to app
4. Verify zkLogin address is displayed
5. Continue to Telegram verification

---

## Bug 3: Auto-Update Page After Telegram Verification & Connect Bot

### Problem
After verifying Telegram identity via Login Widget, the page doesn't:
1. Automatically update to show "completed" state
2. Send the necessary command to the bot to finalize the wallet link

### Current Behavior
- `LinkPage.tsx:289-316` `verifyTelegram()` updates local state
- API call to `/api/link/:token/telegram-verify` is made
- Page transitions to "completed" step
- But bot is not notified of the completion

### Root Cause
The bot's API endpoint `/api/link/:token/telegram-verify` should:
1. Verify the Telegram auth hash
2. Complete the linking session in database
3. Link wallet to Telegram user
4. Optionally notify the user in Telegram

### Affected Files
- `services/web-dapp/src/LinkPage.tsx` (lines 289-316)
- `bot/src/bot/handlers/router.py` - needs API routes
- `bot/src/bot/bot.py` - API server setup
- `bot/src/database/postgres.py` (lines 306-324) - `complete_linking_session()`

### Implementation Plan

1. **Add aiohttp API routes to bot for linking flow:**

   Create `bot/src/api/routes.py`:
   ```python
   from aiohttp import web
   from src.database.postgres import (
       get_linking_session,
       set_linking_wallet,
       complete_linking_session,
       link_wallet
   )
   import hmac
   import hashlib

   async def get_link_session(request: web.Request) -> web.Response:
       """GET /api/link/:token - Get linking session"""
       token = request.match_info['token']
       session = await get_linking_session(token)
       if not session:
           return web.json_response({'error': 'Session not found or expired'}, status=404)

       return web.json_response({
           'token': session['token'],
           'telegramUsername': session.get('telegram_username'),
           'telegramFirstName': session.get('telegram_first_name'),
           'status': session['status'],
           'expiresAt': int(session['expires_at'].timestamp() * 1000),
           'walletAddress': session.get('wallet_address'),
           'walletType': session.get('wallet_type')
       })

   async def post_link_wallet(request: web.Request) -> web.Response:
       """POST /api/link/:token/wallet - Attach wallet to session"""
       token = request.match_info['token']
       data = await request.json()

       success = await set_linking_wallet(
           token,
           data['walletAddress'],
           data['walletType'],
           data.get('zkLoginSalt'),
           data.get('zkLoginSub')
       )

       if not success:
           return web.json_response({'error': 'Failed to update session'}, status=400)

       return web.json_response({'status': 'ok'})

   async def post_telegram_verify(request: web.Request) -> web.Response:
       """POST /api/link/:token/telegram-verify - Verify Telegram and complete"""
       token = request.match_info['token']
       data = await request.json()

       # Verify Telegram auth hash
       if not verify_telegram_auth(data):
           return web.json_response({'error': 'Invalid Telegram auth'}, status=401)

       # Get session and verify Telegram ID matches
       session = await get_linking_session(token)
       if not session:
           return web.json_response({'error': 'Session not found'}, status=404)

       # Complete the linking
       completed = await complete_linking_session(token)
       if not completed:
           return web.json_response({'error': 'Failed to complete linking'}, status=400)

       # TODO: Send message to user in Telegram
       # await notify_user_linked(session['telegram_id'], session['wallet_address'])

       return web.json_response({'status': 'completed'})

   def verify_telegram_auth(auth_data: dict) -> bool:
       """Verify Telegram Login Widget HMAC hash"""
       bot_token = settings.BOT_TOKEN
       check_hash = auth_data.pop('hash', None)
       if not check_hash:
           return False

       # Sort and concatenate
       data_check_string = '\n'.join(f'{k}={v}' for k, v in sorted(auth_data.items()))

       # HMAC-SHA256
       secret_key = hashlib.sha256(bot_token.encode()).digest()
       computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

       return hmac.compare_digest(computed_hash, check_hash)
   ```

2. **Register routes in bot:**
   ```python
   # In bot.py setup_app()
   app.router.add_get('/api/link/{token}', get_link_session)
   app.router.add_post('/api/link/{token}/wallet', post_link_wallet)
   app.router.add_post('/api/link/{token}/telegram-verify', post_telegram_verify)
   ```

3. **Add notification to user after linking:**
   ```python
   async def notify_user_linked(bot: Bot, telegram_id: str, wallet_address: str):
       """Send confirmation message to user in Telegram"""
       try:
           await bot.send_message(
               telegram_id,
               f"Your wallet has been linked!\n\n"
               f"Wallet: `{wallet_address}`\n\n"
               f"You can now use /balance, /send, /history commands.",
               parse_mode="Markdown"
           )
       except Exception as e:
           logger.warning(f"Failed to notify user {telegram_id}: {e}")
   ```

4. **Update web-dapp to poll or show real-time status:**
   ```tsx
   // After verifyTelegram succeeds, could add deeplink back to Telegram
   {step === 'completed' && (
     <a href={`tg://resolve?domain=${TELEGRAM_BOT_USERNAME}&start=linked`}>
       Open in Telegram
     </a>
   )}
   ```

### Acceptance Criteria
- [ ] POST /api/link/:token/telegram-verify validates HMAC hash
- [ ] Telegram ID in auth data matches session's telegram_id
- [ ] Wallet is linked in database after verification
- [ ] User receives confirmation message in Telegram
- [ ] Page shows "completed" state immediately after verification
- [ ] Deep link to return to Telegram bot works

### Testing
1. Start /start flow in Telegram
2. Click connect link
3. Connect wallet (zkLogin or Slush)
4. Click Telegram Login Widget
5. Verify page shows "completed"
6. Verify bot sends confirmation message
7. Verify /balance works in bot

---

## Bug 4: Buttons Not Calling Backend Functions

### Problem
The inline keyboard buttons in Telegram (Help, Balance, Contacts, History, Send SUI) are not properly calling the backend functions.

### Current Behavior
Looking at `router.py:346-413`:
- `action_help` - Sends text, doesn't use handler
- `action_balance` - Calls `command_balance_handler(callback.message)` but message is from bot, not user
- `action_contacts` - Only sends instructions text
- `action_history` - Only sends instructions text
- `action_send_prompt` - Only sends instructions text

### Root Cause
Callback queries pass `callback.message` which is the bot's message (the one with buttons), not a user message. This causes issues with:
1. `message.from_user` points to bot, not user
2. User ID extraction fails

### Affected Files
- `bot/src/bot/handlers/router.py` (lines 346-413)

### Implementation Plan

1. **Fix callback handlers to use correct user ID:**
   ```python
   @router.callback_query(F.data == "action_balance")
   async def callback_balance(callback: CallbackQuery) -> None:
       await callback.answer()
       user_id = str(callback.from_user.id)  # Use callback.from_user, not message.from_user

       wallet_address = await get_user_wallet(user_id)
       if not wallet_address:
           await callback.message.answer("No wallet linked. Use /start first.")
           return

       status_msg = await callback.message.answer("Fetching balance...")
       try:
           balance = await sui_service.get_all_balances(wallet_address)
           await status_msg.edit_text(
               f"Balance: {balance['sui']['formatted']} SUI\n"
               f"Address: {wallet_address}",
               reply_markup=get_main_menu()
           )
       except Exception as e:
           await status_msg.edit_text(f"Error: {e}")
   ```

2. **Fix all callback handlers similarly:**
   - `action_help` - OK as is (doesn't need user ID)
   - `action_balance` - Fix to use `callback.from_user.id`
   - `action_contacts` - Should actually list contacts, not just instructions
   - `action_history` - Should actually fetch history, not just instructions
   - `action_send_prompt` - OK as is (just shows instructions)

3. **Implement actual functionality for contacts callback:**
   ```python
   @router.callback_query(F.data == "action_contacts")
   async def callback_contacts(callback: CallbackQuery) -> None:
       await callback.answer()
       user_id = str(callback.from_user.id)

       contacts = await get_contacts(user_id)
       if not contacts:
           await callback.message.answer(
               "No contacts saved.\n\nAdd: `/contacts add name 0x...`",
               parse_mode="Markdown"
           )
           return

       text = "*Your Contacts:*\n\n"
       for c in contacts:
           text += f"• {c['alias']}: `{c['address'][:10]}...`\n"

       await callback.message.answer(text, parse_mode="Markdown")
   ```

4. **Implement actual functionality for history callback:**
   ```python
   @router.callback_query(F.data == "action_history")
   async def callback_history(callback: CallbackQuery) -> None:
       await callback.answer()
       user_id = str(callback.from_user.id)

       wallet_address = await get_user_wallet(user_id)
       if not wallet_address:
           await callback.message.answer("No wallet linked. Use /start first.")
           return

       status_msg = await callback.message.answer("Fetching history...")
       try:
           history = await sui_service.get_transaction_history(wallet_address, limit=5)
           if not history['items']:
               await status_msg.edit_text("No transactions found.")
               return

           text = "*Recent Transactions:*\n\n"
           for tx in history['items']:
               icon = "sent" if tx['kind'] == 'sent' else "received"
               text += f"• [{tx['digest'][:8]}...]({tx['explorerUrl']}) ({icon})\n"

           await status_msg.edit_text(text, parse_mode="Markdown", disable_web_page_preview=True)
       except Exception as e:
           await status_msg.edit_text(f"Error: {e}")
   ```

### Acceptance Criteria
- [ ] Balance button fetches and shows actual balance
- [ ] Contacts button shows actual contact list
- [ ] History button shows actual transaction history
- [ ] All buttons work for the correct user (callback.from_user)
- [ ] Proper error handling for no wallet linked

### Testing
1. Start bot, link wallet
2. Click each button (Help, Balance, Contacts, History, Send SUI)
3. Verify actual data is displayed, not just instructions

---

## Bug 5: LLM Conversation Memory

### Problem
The AI (Gemini) doesn't remember previous messages in the conversation. Each message is processed independently without context.

### Current Behavior
- `gemini.py:160-244` `chat()` method accepts `history` parameter but it's never passed
- `router.py:459-500` `process_text_message()` calls `gemini_service.chat()` without history

### Root Cause
Conversation history is not being stored or passed to the Gemini service.

### Affected Files
- `bot/src/services/gemini.py` (already supports history at lines 186-194)
- `bot/src/bot/handlers/router.py` (lines 459-500)
- `bot/src/database/postgres.py` (needs conversation history table)

### Implementation Plan

1. **Add conversation history table to database:**
   ```python
   # In postgres.py _create_tables()
   await conn.execute("""
       CREATE TABLE IF NOT EXISTS conversation_history (
           id SERIAL PRIMARY KEY,
           telegram_id VARCHAR(64) NOT NULL,
           role VARCHAR(16) NOT NULL,  -- 'user' or 'assistant'
           content TEXT NOT NULL,
           created_at TIMESTAMP DEFAULT NOW()
       )
   """)

   await conn.execute("""
       CREATE INDEX IF NOT EXISTS idx_convhist_telegram
       ON conversation_history(telegram_id, created_at DESC)
   """)
   ```

2. **Add functions to manage history:**
   ```python
   async def get_conversation_history(telegram_id: str, limit: int = 20) -> List[Dict[str, str]]:
       """Get recent conversation history"""
       pool = await get_pool()
       async with pool.acquire() as conn:
           rows = await conn.fetch("""
               SELECT role, content as text FROM conversation_history
               WHERE telegram_id = $1
               ORDER BY created_at DESC
               LIMIT $2
           """, telegram_id, limit)
           # Reverse to get chronological order
           return [dict(row) for row in reversed(rows)]

   async def add_to_conversation(telegram_id: str, role: str, content: str):
       """Add message to conversation history"""
       pool = await get_pool()
       async with pool.acquire() as conn:
           await conn.execute("""
               INSERT INTO conversation_history (telegram_id, role, content)
               VALUES ($1, $2, $3)
           """, telegram_id, role, content)

   async def clear_conversation_history(telegram_id: str):
       """Clear all conversation history for user"""
       pool = await get_pool()
       async with pool.acquire() as conn:
           await conn.execute(
               "DELETE FROM conversation_history WHERE telegram_id = $1",
               telegram_id
           )
   ```

3. **Update process_text_message to use history:**
   ```python
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

       # Get conversation history
       history = await get_conversation_history(user_id, limit=20)

       try:
           # Save user message to history
           await add_to_conversation(user_id, "user", text)

           # Get AI response with history
           response = await gemini_service.chat(
               message=text,
               wallet_address=wallet_address,
               history=history
           )

           # Handle function calls
           if response.get("function_call"):
               fc = response["function_call"]
               result = await handle_function_call(message, fc, wallet_address, status_msg)
               # Save function call result to history
               await add_to_conversation(user_id, "assistant", f"[Called {fc['name']}]")
               return

           # Send text response
           reply_text = response.get("text", "I'm not sure how to help with that.")

           # Save assistant response to history
           await add_to_conversation(user_id, "assistant", reply_text)

           if status_msg:
               await safe_edit(status_msg, reply_text)
           else:
               await safe_answer(message, reply_text)

       except Exception as e:
           logger.error(f"AI processing failed: {e}")
           # ... error handling
   ```

4. **Optional: Add TTL cleanup for old history:**
   ```python
   async def cleanup_old_history(days: int = 7):
       """Delete conversation history older than X days"""
       pool = await get_pool()
       async with pool.acquire() as conn:
           await conn.execute("""
               DELETE FROM conversation_history
               WHERE created_at < NOW() - INTERVAL '%s days'
           """, days)
   ```

### Acceptance Criteria
- [ ] User messages are stored in database
- [ ] Assistant responses are stored in database
- [ ] Last 20 messages are passed to Gemini
- [ ] Gemini uses context from previous messages
- [ ] History can be cleared with /reset command

### Testing
```
User: My name is Alice
Bot: Nice to meet you, Alice!
User: What's my name?
Bot: Your name is Alice.  <- Should remember
```

---

## Bug 6: Implement /reset Command

### Problem
There's no `/reset` command to clear the LLM conversation context.

### Current Behavior
No /reset handler exists in `router.py`.

### Affected Files
- `bot/src/bot/handlers/router.py`
- `bot/src/database/postgres.py` (needs clear_conversation_history)

### Implementation Plan

1. **Add /reset command handler:**
   ```python
   @router.message(Command("reset"))
   async def command_reset_handler(message: Message) -> None:
       """Handle /reset command - clear conversation history"""
       user_id = str(message.from_user.id)

       await clear_conversation_history(user_id)

       await safe_answer(message,
           "Conversation history cleared.\n\n"
           "I've forgotten our previous conversation. How can I help you?",
           reply_markup=get_main_menu()
       )
   ```

2. **Update /help to mention /reset:**
   ```python
   @router.message(Command("help"))
   async def command_help_handler(message: Message) -> None:
       await safe_answer(message,
           "<b>Commands:</b>\n"
           "/start - Connect your wallet\n"
           "/connect &lt;address&gt; - Manually link a wallet\n"
           "/help - This help menu\n"
           "/balance - Check your SUI balance\n"
           "/send &lt;amount&gt; &lt;address&gt; - Send SUI\n"
           "/contacts - List saved contacts\n"
           "/contacts add &lt;name&gt; &lt;address&gt; - Add a contact\n"
           "/history - Recent transactions\n"
           "/reset - Clear conversation history\n\n"  # <-- Add this
           "<b>Or just chat naturally:</b>\n"
           '"What\'s my balance?"\n'
           '"Send 1 SUI to alice"\n'
           '"Show my transaction history"',
           reply_markup=get_main_menu(),
       )
   ```

### Acceptance Criteria
- [ ] /reset command clears conversation history
- [ ] User receives confirmation message
- [ ] /help shows /reset command
- [ ] Next messages don't have old context

### Testing
1. Have a conversation with the bot
2. Type /reset
3. Verify confirmation message
4. Ask "what did I just say?" - bot should not know

---

## Bug 7: Reset Button in UI (Web dApp)

### Problem
There's no reset button in the web-dapp to refresh the LLM context.

### Note
This appears to be for the web-dapp transaction signing interface, but that interface doesn't have an LLM chat feature - it's just for signing transactions.

If this means adding a reset button for the **Telegram bot** that can be triggered from the web interface, we need to clarify requirements.

### Possible Interpretations

**Option A: Reset linking session (Start Over)**
Add a button to start the linking flow over if something goes wrong.

**Option B: Reset linked wallet**
Add a button to unlink the current wallet and connect a different one.

**Option C: Web chat interface with reset**
This would require building a web chat UI with the LLM, which doesn't currently exist.

### Implementation Plan (Option A - Reset Linking Session)

1. **Add "Start Over" button to error/completed states:**
   ```tsx
   // In LinkPage.tsx error state
   {step === 'error' && (
     <div className="step-card error-card">
       <h2>Error</h2>
       <p>{error}</p>
       <button onClick={() => {
         setError(null);
         setStep('choose_wallet');
         setSession(prev => prev ? {...prev, status: 'pending_wallet'} : null);
       }}>
         Try Again
       </button>
       <a href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=reset`}>
         Get New Link from Telegram
       </a>
     </div>
   )}
   ```

2. **Add reset option after completion:**
   ```tsx
   {step === 'completed' && (
     <div className="step-card success-card">
       {/* ... existing content ... */}
       <div className="secondary-actions">
         <button onClick={async () => {
           // Call API to unlink
           await fetch(`${API_BASE_URL}/api/wallet/unlink`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ token })
           });
           // Return to start
           window.location.href = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=reset`;
         }}>
           Connect Different Wallet
         </button>
       </div>
     </div>
   )}
   ```

### Acceptance Criteria
- [ ] Error state has "Try Again" button
- [ ] Completed state has "Connect Different Wallet" option
- [ ] Reset clears local state
- [ ] User can start linking flow again

---

## Implementation Priority

| Priority | Bug # | Description | Complexity | Dependencies |
|----------|-------|-------------|------------|--------------|
| 1 | Bug 1 | URL params autocomplete | Low | None |
| 2 | Bug 4 | Fix callback buttons | Low | None |
| 3 | Bug 3 | Telegram verify + bot notify | Medium | Bug 4 |
| 4 | Bug 5 | LLM conversation memory | Medium | Database |
| 5 | Bug 6 | /reset command | Low | Bug 5 |
| 6 | Bug 2 | zkLogin OAuth flow | Medium | Environment |
| 7 | Bug 7 | Reset button UI | Low | Clarify requirements |

---

## Testing Checklist

After implementing all bugs:

- [ ] **Full flow test:** /start -> link -> wallet -> telegram verify -> bot notified
- [ ] **Direct link test:** Click URL with params -> form pre-filled -> sign works
- [ ] **zkLogin test:** Google OAuth -> zkLogin wallet created -> linked
- [ ] **Buttons test:** All inline buttons work correctly
- [ ] **Memory test:** Multi-turn conversation works
- [ ] **Reset test:** /reset clears context
- [ ] **Web UI test:** Reset/retry options work

---

## Notes

- All web-dapp changes require rebuild: `npm run build`
- All bot changes require restart: `docker-compose restart telegram-bot`
- Test on staging before production
- Keep IMPLEMENTATION_STATUS.md updated after each fix
