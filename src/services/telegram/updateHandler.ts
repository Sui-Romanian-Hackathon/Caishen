import { Update } from '@grammyjs/types';
import logger from '../../utils/logger';
import { sendMessage } from './telegramClient';
import { sessionStore, SessionStore } from '../session/sessionStore';
import { draftAssistantResponse } from '../llm/llmService';
import { getBalanceSummary } from '../sui/suiService';
import { buildSendSuiTx } from '../sui/txBuilder';
import { fetchTransactionHistory } from '../sui/historyService';
import { logTransaction } from '../clients/transactionService';
import { getOrCreateSalt } from '../clients/zkloginService';
import { addContact, listContacts, resolveContact } from '../clients/contactService';
import { createPendingTransaction } from '../pending/pendingTxStore';
import { createLinkingSession, getLinkingSessionByTelegramId } from '../linking/linkingStore';

const mainMenu = {
  inline_keyboard: [
    [
      { text: '📋 Help', callback_data: 'action_help' },
      { text: '💰 Balance', callback_data: 'action_balance' }
    ],
    [
      { text: '👥 Contacts', callback_data: 'action_contacts' },
      { text: '🧾 History', callback_data: 'action_history' }
    ],
    [{ text: '✉️ Send SUI', callback_data: 'action_send_prompt' }]
  ]
};

export async function handleTelegramUpdate(update: Update) {
  logger.debug({ update }, 'Received Telegram update');

  if (update.message?.text) {
    const chatId = update.message.chat.id;
    const userId = String(update.message.from?.id ?? chatId);
    const text = update.message.text.trim();
    const session = sessionStore.getOrCreate(userId);

    // /start command - initiate wallet linking flow
    if (text.startsWith('/start')) {
      const username = update.message.from?.username || null;
      const firstName = update.message.from?.first_name || null;

      // Check if user already has a wallet linked
      if (session.walletAddress) {
        await sendMessage({
          chatId,
          text: `👋 Welcome back! Your wallet is already linked:\n\n` +
                `📱 Telegram: @${username || userId}\n` +
                `💳 Wallet: ${session.walletAddress.slice(0, 10)}...${session.walletAddress.slice(-8)}\n\n` +
                `Use the menu below to manage your wallet.`,
          keyboard: mainMenu
        });
        return;
      }

      // Create a new linking session
      const linkingSession = createLinkingSession(userId, username, firstName);
      const webAppUrl = process.env.WEBAPP_URL || 'https://caishen.iseethereaper.com';

      // Generate linking URL with readable path
      const linkPath = username ? `@${username}` : userId;
      const linkingUrl = `${webAppUrl}/link/${linkPath}?token=${linkingSession.token}`;

      await sendMessage({
        chatId,
        text: `👋 Welcome to AI Copilot Wallet!\n\n` +
              `To get started, connect your wallet:\n\n` +
              `🔐 **Step 1:** Click the button below\n` +
              `🔑 **Step 2:** Choose "Create zkLogin wallet" (with Google) or connect your existing Slush wallet\n` +
              `✅ **Step 3:** Verify your Telegram account\n\n` +
              `⏱️ This link expires in 15 minutes.`,
        keyboard: {
          inline_keyboard: [
            [{ text: '🔗 Connect Wallet', url: linkingUrl }],
            [{ text: '❓ What is zkLogin?', callback_data: 'action_zklogin_info' }]
          ]
        }
      });
      return;
    }

    // /help command
    if (text.startsWith('/help')) {
      await sendMessage({
        chatId,
        text: `Commands:
/start - welcome message
/help - this help menu
/connect <address> - link your Sui wallet
/balance - fetch on-chain balance (Sui RPC)
/contacts - list saved contacts
/contacts add <name> <address> - add a contact
/history - recent transaction logs (formatted)
/send <amount> <address> - build a send transaction (zkLogin-ready)

Or just chat naturally:
"What's my balance?"
"Send 1 SUI to alice"`,
        keyboard: mainMenu
      });
      return;
    }

    // /connect command
    if (text.startsWith('/connect')) {
      const parts = text.split(/\s+/);
      const address = parts[1];

      if (!address) {
        await sendMessage({
          chatId,
          text: 'Please provide a Sui address. Example: /connect 0xabc123...'
        });
        return;
      }

      if (!isLikelySuiAddress(address)) {
        await sendMessage({
          chatId,
          text: 'That does not look like a valid Sui address. Addresses start with 0x and are 40-64 hex characters long.'
        });
        return;
      }

      sessionStore.setWallet(userId, address);
      await sendMessage({
        chatId,
        text: `Linked wallet ${address}. You can now ask for balance or send commands like "Send 1 SUI to Alex".`
      });
      return;
    }

    // /contacts command
    if (text.startsWith('/contacts')) {
      const parts = text.split(/\s+/);

      // /contacts add <name> <address>
      if (parts[1] === 'add') {
        const name = parts[2];
        const address = parts[3];

        if (!name || !address) {
          await sendMessage({
            chatId,
            text: 'Usage: /contacts add <name> <address>\nExample: /contacts add alice 0xabc123...'
          });
          return;
        }

        if (!isLikelySuiAddress(address)) {
          await sendMessage({
            chatId,
            text: 'That does not look like a valid Sui address. Addresses start with 0x and are 40-64 hex characters long.'
          });
          return;
        }

        const ok = await addContact({
          userId,
          alias: name,
          address,
          username: update.message.from?.username
        });
        await sendMessage({
          chatId,
          text: ok ? `✅ Added contact \"${name}\" → ${address}` : 'Could not save contact right now.'
        });
        return;
      }

      // /contacts (list)
      const contacts = await listContacts(userId);
      const formatted =
        contacts.length === 0
          ? 'No contacts saved yet.\n\nAdd one with: /contacts add <name> <address>'
          : contacts.map((c) => `- ${c.alias}: ${c.address}`).join('\n');
      await sendMessage({ chatId, text: `Contacts:\n${formatted}` });
      return;
    }

    // /history command
    if (text.startsWith('/history')) {
      if (!session.walletAddress || !isLikelySuiAddress(session.walletAddress)) {
        await sendMessage({
          chatId,
          text: 'Link a valid Sui wallet first with /connect <address> to see history.'
        });
        return;
      }

      const wantRaw = text.includes('raw');
      try {
        const history = await fetchTransactionHistory({
          address: session.walletAddress,
          limit: 10,
          filter: 'all'
        });

        if (history.items.length === 0) {
          await sendMessage({ chatId, text: 'No transactions found yet.' });
          return;
        }

        if (wantRaw) {
          await sendMessage({
            chatId,
            text:
              'Recent transactions (JSON snippet):\n' +
              JSON.stringify(history.items, null, 2).slice(0, 3800)
          });
          return;
        }

        const formatted = formatHistory(history.items);
        await sendMessage({ chatId, text: formatted });
      } catch (err) {
        logger.error({ err }, 'Failed to fetch history');
        await sendMessage({
          chatId,
          text:
            'Unable to fetch history right now. Ensure your linked address is valid and try again.'
        });
      }
      return;
    }

    // /balance command
    if (text.startsWith('/balance')) {
      await respondWithBalance(chatId, session);
      return;
    }

    // /send command
    if (text.startsWith('/send')) {
      const parts = text.split(/\s+/);
      const amountStr = parts[1];
        let recipient = parts[2];

      if (!session.walletAddress) {
        await sendMessage({ chatId, text: 'Link a wallet first with /connect <address>.' });
        return;
      }

      if (!amountStr || !recipient) {
        await sendMessage({
          chatId,
          text: 'Usage: /send <amount> <recipient>\nExample: /send 0.5 0xabc123...'
        });
        return;
      }

      if (!isLikelySuiAddress(recipient)) {
        const resolved = await resolveContact(userId, recipient);
        if (!resolved) {
          await sendMessage({
            chatId,
            text: 'Recipient is not a valid Sui address or known contact. Addresses start with 0x and are 40-64 hex characters.'
          });
          return;
        }
        recipient = resolved;
      }

      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        await sendMessage({ chatId, text: 'Amount must be a positive number.' });
        return;
      }

      try {
        const unsigned = await buildSendSuiTx({
          recipient,
          amount,
          sender: session.walletAddress
        });

        // Fetch zkLogin salt (if configured) to prep the proof flow
        const saltInfo = await getOrCreateSalt({
          provider: 'google',
          telegramId: userId
        }).catch(() => null);

        // Log transaction intent in tx-service (best-effort)
        void logTransaction({
          telegramId: userId,
          txBytes: unsigned.serialized,
          status: 'pending'
        });

        const mode = saltInfo?.salt ? 'zklogin' : 'wallet';
        const saltLine = saltInfo?.salt
          ? `zkLogin salt ready (provider=google).`
          : 'zkLogin salt not set; proceed to web signing.';

        // Create pending transaction with secure ID (not exposing details in URL)
        const pendingTx = createPendingTransaction({
          userId,
          recipient,
          amount,
          sender: session.walletAddress,
          mode,
          salt: saltInfo?.salt
        });

        // Generate deep link with only the transaction ID
        const webAppUrl = process.env.WEBAPP_URL || 'https://caishen.iseethereaper.com';
        const signingUrl = `${webAppUrl}?tx=${pendingTx.id}`;

        await sendMessage({
          chatId,
          text: `Built unsigned tx:\n- ${unsigned.summary}\n- Bytes: ${unsigned.serialized.slice(
            0,
            40
          )}…\n${saltLine}\n\n⏱️ Link expires in 15 minutes.`,
          keyboard: {
            inline_keyboard: [
              [{ text: '✍️ Sign & Send', url: signingUrl }]
            ]
          }
        });
      } catch (err) {
        logger.error({ err }, 'Failed to build send transaction');
        await sendMessage({
          chatId,
          text: 'Failed to build the transaction. Check balance and try again.'
        });
      }
      return;
    }

    // Natural language processing via Gemini with fallback
    try {
      // Try fallback pattern matching first for common commands
      const fallbackResult = tryFallbackPatternMatching(text, session, userId);
      if (fallbackResult) {
        await fallbackResult(chatId);
        return;
      }

      // If no pattern match, try Gemini AI
      const llmResponse = await draftAssistantResponse(text, session);
      sessionStore.appendHistory(userId, 'user', text);

      if (llmResponse.intent === 'balance') {
        await respondWithBalance(chatId, session);
        sessionStore.appendHistory(userId, 'assistant', 'Fetching your balance.');
        return;
      }

      if (llmResponse.intent === 'send') {
        await handleSendCommand(chatId, session, userId, llmResponse.reply);
        sessionStore.appendHistory(userId, 'assistant', llmResponse.reply);
        return;
      }

      await sendMessage({ chatId, text: llmResponse.reply });
      sessionStore.appendHistory(userId, 'assistant', llmResponse.reply);
    } catch (err) {
      logger.error({ err }, 'LLM processing failed');
      await sendMessage({
        chatId,
        text: 'Error processing request: ' + (err instanceof Error ? err.message : 'Unknown error')
      });
    }
      return;
    }

  if (update.callback_query) {
    logger.info({ data: update.callback_query.data }, 'Received callback query');
    if (update.callback_query.message) {
      await handleMenuAction(update.callback_query.data, update.callback_query.message.chat.id);
    }
    return;
  }

  logger.info('Skipping unsupported update type');
}

function isLikelySuiAddress(address: string) {
  return /^0x[a-fA-F0-9]{40,64}$/.test(address);
}

function formatHistory(items: Awaited<ReturnType<typeof fetchTransactionHistory>>['items']) {
  const lines = items.map((item) => {
    const ts = item.timestampMs ? new Date(item.timestampMs).toLocaleString() : 'unknown time';
    const digestShort = `${item.digest.slice(0, 6)}…${item.digest.slice(-6)}`;
    const label = item.kind === 'sent' ? 'Sent' : item.kind === 'received' ? 'Received' : 'Other';
    return `• ${label} @ ${ts}\n  Digest: ${digestShort}\n  ${item.summary}`;
  });

  return `Recent transactions (showing ${items.length}):\n${lines.join('\n')}\n\nNeed raw JSON? Type "/history raw".`;
}

async function handleMenuAction(action: string | undefined, chatId: number) {
  switch (action) {
    case 'action_help':
      await sendMessage({
        chatId,
        text: 'Menu:\n- Balance\n- Contacts\n- History\n- Send\nUse the buttons to navigate.',
        keyboard: mainMenu
      });
      break;
    case 'action_balance':
      await sendMessage({ chatId, text: 'Type /balance to fetch your linked wallet balance.' });
      break;
    case 'action_contacts':
      await sendMessage({
        chatId,
        text: 'Type /contacts to list or /contacts add <name> <address> to add.',
        keyboard: mainMenu
      });
      break;
    case 'action_history':
      await sendMessage({
        chatId,
        text: 'Type /history for recent transactions, or /history raw for JSON.',
        keyboard: mainMenu
      });
      break;
    case 'action_send_prompt':
      await sendMessage({
        chatId,
        text: 'Type /send <amount> <address-or-contact>. Example: /send 0.5 alice',
        keyboard: mainMenu
      });
      break;
    case 'action_zklogin_info':
      await sendMessage({
        chatId,
        text: `🔐 **What is zkLogin?**\n\n` +
              `zkLogin lets you create a Sui wallet using your Google account - no seed phrases needed!\n\n` +
              `**How it works:**\n` +
              `1. You sign in with Google\n` +
              `2. A unique wallet address is generated from your Google identity\n` +
              `3. Zero-knowledge proofs keep your Google account private\n\n` +
              `**Security:**\n` +
              `✅ No one can access your wallet without your Google account\n` +
              `✅ Your Google email is never stored on the blockchain\n` +
              `✅ Built by Mysten Labs for the Sui blockchain\n\n` +
              `Already have a Slush wallet? You can connect that instead!`
      });
      break;
    default:
      await sendMessage({ chatId, text: 'Select an option from the menu.', keyboard: mainMenu });
  }
}

async function respondWithBalance(
  chatId: number,
  session: ReturnType<SessionStore['getOrCreate']>
) {
  if (!session.walletAddress || !isLikelySuiAddress(session.walletAddress)) {
    await sendMessage({
      chatId,
      text: 'No valid wallet is linked yet. Use /connect <address> to link one.'
    });
    return;
  }

  try {
    const summary = await getBalanceSummary(session.walletAddress);
    const formatted = formatBalanceSummary(summary);

    await sendMessage({ chatId, text: formatted });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch balance');
    await sendMessage({
      chatId,
      text: 'Unable to fetch balance from the Sui RPC right now. Please try again shortly.'
    });
  }
}

function formatBalanceSummary(summary: Awaited<ReturnType<typeof getBalanceSummary>>) {
  const tokenLines =
    summary.tokens.length === 0
      ? '- No additional tokens found.'
      : summary.tokens
          .map((token) => {
            const label = token.symbol ?? token.coinType;
            const amount = token.formatted ?? token.totalBalance;
            return `- ${label}: ${amount}`;
          })
          .join('\n');

  return `Wallet: ${summary.address}\nSUI: ${summary.sui.formatted} (raw: ${summary.sui.total} MIST)\nTokens:\n${tokenLines}`;
}

// Pattern matching for common commands (fallback when AI fails)
function tryFallbackPatternMatching(
  text: string,
  session: ReturnType<SessionStore['getOrCreate']>,
  userId: string
): ((chatId: number) => Promise<void>) | null {
  const lower = text.toLowerCase();

  // Balance queries
  if (
    lower.includes('balance') ||
    lower.includes('how much') ||
    lower.includes('what do i have') ||
    lower.match(/what'?s my/)
  ) {
    return async (chatId: number) => {
      await respondWithBalance(chatId, session);
    };
  }

  // Send SUI pattern: "send X sui to Y"
  const sendMatch = text.match(/send\s+([\d.]+)\s+sui\s+to\s+(\w+)/i);
  if (sendMatch) {
    const [, amount, recipient] = sendMatch;
    return async (chatId: number) => {
      await handleSendSui(chatId, session, userId, amount, recipient);
    };
  }

  return null;
}

// Handle send SUI command
async function handleSendCommand(
  chatId: number,
  session: ReturnType<SessionStore['getOrCreate']>,
  userId: string,
  aiReply: string
) {
  // Try to extract send info from AI reply or show the AI response
  await sendMessage({ chatId, text: aiReply });
}

// Handle sending SUI to a contact or address
async function handleSendSui(
  chatId: number,
  session: ReturnType<SessionStore['getOrCreate']>,
  userId: string,
  amount: string,
  recipientQuery: string
) {
  if (!session.walletAddress) {
    await sendMessage({
      chatId,
      text: 'No wallet is linked yet. Use /connect <address> to link one.'
    });
    return;
  }

  // Resolve recipient (contact name or address)
  const recipientAddress = await resolveContact(userId, recipientQuery);

  if (!recipientAddress) {
    await sendMessage({
      chatId,
      text: `Could not find contact "${recipientQuery}". Please add them with /contacts add ${recipientQuery} <address> or provide a full Sui address.`
    });
    return;
  }

  try {
    // Build the transaction
    await buildSendSuiTx({
      sender: session.walletAddress,
      recipient: recipientAddress,
      amount: parseFloat(amount),
      gasBudget: 10000000 // 0.01 SUI
    });

    // Create pending transaction with secure ID (not exposing details in URL)
    const pendingTx = createPendingTransaction({
      userId,
      recipient: recipientAddress,
      amount: parseFloat(amount),
      sender: session.walletAddress,
      mode: 'wallet'
    });

    // Generate deep link with only the transaction ID
    const webAppUrl = process.env.WEBAPP_URL || 'https://caishen.iseethereaper.com';
    const signingUrl = `${webAppUrl}?tx=${pendingTx.id}`;

    await sendMessage({
      chatId,
      text: `📋 Transaction prepared to send ${amount} SUI to ${recipientQuery} (${recipientAddress})\n\n⏱️ Link expires in 15 minutes.\n\nClick below to sign with your wallet:`,
      keyboard: {
        inline_keyboard: [
          [{ text: '✍️ Sign & Send', url: signingUrl }]
        ]
      }
    });
  } catch (err) {
    logger.error({ err }, 'Failed to build send transaction');
    await sendMessage({
      chatId,
      text: `Error building transaction: ${err instanceof Error ? err.message : 'Unknown error'}`
    });
  }
}
