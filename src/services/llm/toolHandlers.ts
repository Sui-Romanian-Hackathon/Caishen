import logger from '../../utils/logger';
import {
  buildNftTransferTx,
  buildSendSuiTx,
  buildSendTokenTx,
  estimateGasBudget
} from '../sui/txBuilder';
import { listRecentNfts } from '../sui/nftService';
import { getBalanceSummary } from '../sui/suiService';
import { fetchTransactionHistory } from '../sui/historyService';
import { resolveContact } from '../clients/contactService';
import type { ToolName, ToolParamMap } from './tools';

export interface ToolContext {
  userId: string;
  walletAddress?: string;
}

type Handler<K extends ToolName> = (args: ToolParamMap[K], ctx: ToolContext) => Promise<unknown>;

const handlers: { [K in ToolName]: Handler<K> } = {
  build_send_sui_tx: async (args, ctx) => {
    // SECURITY: Always use the authenticated user's wallet, ignore LLM-provided sender
    // This prevents prompt injection attacks where LLM is tricked into using wrong sender
    if (!ctx.walletAddress) {
      throw new Error('No wallet linked. Use /connect to link your wallet first.');
    }
    logger.info({
      providedSender: args.sender,
      actualSender: ctx.walletAddress,
      recipient: args.recipient,
      amount: args.amount
    }, 'Building send tx (sender enforced from session)');

    return buildSendSuiTx({
      recipient: args.recipient,
      amount: args.amount,
      sender: ctx.walletAddress,  // ← ENFORCED from session, not LLM input
      gasBudget: args.gas_budget
    });
  },
  build_send_token_tx: async (args, ctx) => {
    // SECURITY: Always use the authenticated user's wallet
    if (!ctx.walletAddress) {
      throw new Error('No wallet linked. Use /connect to link your wallet first.');
    }
    logger.info({
      providedSender: args.sender,
      actualSender: ctx.walletAddress,
      recipient: args.recipient,
      amount: args.amount,
      tokenType: args.token_type
    }, 'Building token send tx (sender enforced from session)');

    return buildSendTokenTx({
      recipient: args.recipient,
      amount: args.amount,
      tokenType: args.token_type,
      sender: ctx.walletAddress,  // ← ENFORCED from session
      gasBudget: args.gas_budget
    });
  },
  list_recent_nfts: async (args, _ctx) => {
    return listRecentNfts({
      owner: args.owner,
      since: args.since,
      collection: args.collection,
      limit: args.limit ?? 20
    });
  },
  get_balance: async (args, _ctx) => {
    return getBalanceSummary(args.address);
  },
  get_transaction_history: async (args, _ctx) => {
    return fetchTransactionHistory({
      address: args.address,
      limit: args.limit ?? 10,
      filter: args.filter ?? 'all'
    });
  },
  resolve_contact: async (args, ctx) => {
    const resolved = await resolveContact(ctx.userId, args.query);
    return resolved
      ? { address: resolved, resolved: true }
      : { address: null, resolved: false, reason: 'No matching contact or address found' };
  },
  build_nft_transfer_tx: async (args, ctx) => {
    // SECURITY: Always use the authenticated user's wallet
    if (!ctx.walletAddress) {
      throw new Error('No wallet linked. Use /connect to link your wallet first.');
    }
    logger.info({
      nftId: args.nft_id,
      recipient: args.recipient,
      actualSender: ctx.walletAddress
    }, 'Building NFT transfer tx (sender enforced from session)');

    return buildNftTransferTx({
      nftId: args.nft_id,
      recipient: args.recipient,
      sender: ctx.walletAddress  // ← ENFORCED from session
    });
  },
  estimate_gas: async (args, _ctx) => {
    return estimateGasBudget({
      type: args.token_type ? 'token' : 'sui',
      sender: args.sender
    });
  }
};

export async function invokeTool<K extends ToolName>(
  name: K,
  args: ToolParamMap[K],
  ctx: ToolContext
) {
  const handler = handlers[name] as Handler<K>;

  if (!handler) {
    throw new Error(`No handler registered for tool ${name}`);
  }

  try {
    return await handler(args as never, ctx);
  } catch (err) {
    logger.error({ err, name, args }, 'Tool handler failed');
    throw err;
  }
}
