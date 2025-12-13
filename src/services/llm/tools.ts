import { z } from 'zod';

export type ToolName =
  | 'build_send_sui_tx'
  | 'build_send_token_tx'
  | 'list_recent_nfts'
  | 'get_balance'
  | 'get_transaction_history'
  | 'resolve_contact'
  | 'build_nft_transfer_tx'
  | 'estimate_gas';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: z.ZodTypeAny;
  schema: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export const toolSchemas = {
  build_send_sui_tx: z.object({
    recipient: z.string().min(1),
    amount: z.number().positive(),
    sender: z.string().min(1),
    gas_budget: z.number().positive().optional()
  }),
  build_send_token_tx: z.object({
    recipient: z.string().min(1),
    amount: z.number().positive(),
    token_type: z.string().min(1),
    sender: z.string().min(1),
    gas_budget: z.number().positive().optional()
  }),
  list_recent_nfts: z.object({
    owner: z.string().min(1),
    since: z.string().datetime().optional(),
    collection: z.string().optional(),
    limit: z.number().int().positive().max(100).default(20).optional()
  }),
  get_balance: z.object({
    address: z.string().min(1),
    include_tokens: z.boolean().optional().default(true),
    include_staked: z.boolean().optional().default(true)
  }),
  get_transaction_history: z.object({
    address: z.string().min(1),
    limit: z.number().int().positive().max(50).default(10).optional(),
    filter: z.enum(['sent', 'received', 'all']).default('all').optional()
  }),
  resolve_contact: z.object({
    query: z.string().min(1),
    user_id: z.string().min(1)
  }),
  build_nft_transfer_tx: z.object({
    nft_id: z.string().min(1),
    recipient: z.string().min(1),
    sender: z.string().min(1)
  }),
  estimate_gas: z.object({
    sender: z.string().min(1),
    recipient: z.string().min(1).optional(),
    amount: z.number().positive().optional(),
    token_type: z.string().optional()
  })
};

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'build_send_sui_tx',
    description: 'Construct an unsigned transaction for sending SUI tokens to a recipient.',
    parameters: toolSchemas.build_send_sui_tx,
    schema: {
      name: 'build_send_sui_tx',
      description: 'Construct an unsigned transaction for sending SUI tokens to a recipient.',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string', description: 'Recipient Sui address' },
          amount: { type: 'number', description: 'Amount in SUI' },
          sender: { type: 'string', description: 'Sender Sui address' },
          gas_budget: { type: 'number', description: 'Gas budget (optional)' }
        },
        required: ['recipient', 'amount', 'sender']
      }
    }
  },
  {
    name: 'build_send_token_tx',
    description: 'Construct an unsigned transaction for sending a non-SUI fungible token.',
    parameters: toolSchemas.build_send_token_tx,
    schema: {
      name: 'build_send_token_tx',
      description: 'Construct an unsigned transaction for sending a non-SUI fungible token.',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string', description: 'Recipient Sui address' },
          amount: { type: 'number', description: 'Amount of tokens' },
          token_type: { type: 'string', description: 'Token type identifier' },
          sender: { type: 'string', description: 'Sender Sui address' },
          gas_budget: { type: 'number', description: 'Gas budget (optional)' }
        },
        required: ['recipient', 'amount', 'token_type', 'sender']
      }
    }
  },
  {
    name: 'list_recent_nfts',
    description:
      'List NFTs acquired by the owner since a given timestamp or over the last 24h by default.',
    parameters: toolSchemas.list_recent_nfts,
    schema: {
      name: 'list_recent_nfts',
      description: 'List NFTs acquired by the owner since a given timestamp.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Owner Sui address' },
          since: { type: 'string', description: 'ISO datetime (optional)' },
          collection: { type: 'string', description: 'Collection filter (optional)' },
          limit: { type: 'number', description: 'Max results (default 20)' }
        },
        required: ['owner']
      }
    }
  },
  {
    name: 'get_balance',
    description: 'Fetch SUI and token balances for an address.',
    parameters: toolSchemas.get_balance,
    schema: {
      name: 'get_balance',
      description: 'Fetch SUI and token balances for an address.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Sui address to query' },
          include_tokens: { type: 'boolean', description: 'Include token balances' },
          include_staked: { type: 'boolean', description: 'Include staked SUI' }
        },
        required: ['address']
      }
    }
  },
  {
    name: 'get_transaction_history',
    description: 'Fetch recent transactions for an address, optionally filtered by direction.',
    parameters: toolSchemas.get_transaction_history,
    schema: {
      name: 'get_transaction_history',
      description: 'Fetch recent transactions for an address.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Sui address to query' },
          limit: { type: 'number', description: 'Max results (default 10)' },
          filter: { type: 'string', enum: ['sent', 'received', 'all'], description: 'Filter type' }
        },
        required: ['address']
      }
    }
  },
  {
    name: 'resolve_contact',
    description: 'Resolve a contact name or partial address to a full Sui address for a user.',
    parameters: toolSchemas.resolve_contact,
    schema: {
      name: 'resolve_contact',
      description: 'Resolve a contact name to a Sui address.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Contact name or partial address' },
          user_id: { type: 'string', description: 'User identifier' }
        },
        required: ['query', 'user_id']
      }
    }
  },
  {
    name: 'build_nft_transfer_tx',
    description: 'Construct an unsigned transaction for transferring an NFT.',
    parameters: toolSchemas.build_nft_transfer_tx,
    schema: {
      name: 'build_nft_transfer_tx',
      description: 'Construct an unsigned transaction for transferring an NFT.',
      parameters: {
        type: 'object',
        properties: {
          nft_id: { type: 'string', description: 'NFT object ID' },
          recipient: { type: 'string', description: 'Recipient Sui address' },
          sender: { type: 'string', description: 'Sender Sui address' }
        },
        required: ['nft_id', 'recipient', 'sender']
      }
    }
  },
  {
    name: 'estimate_gas',
    description: 'Estimate gas for a simple transfer (SUI/token) using current network defaults.',
    parameters: toolSchemas.estimate_gas,
    schema: {
      name: 'estimate_gas',
      description: 'Estimate gas for a simple transfer (SUI/token).',
      parameters: {
        type: 'object',
        properties: {
          sender: { type: 'string', description: 'Sender Sui address' },
          recipient: { type: 'string', description: 'Recipient address (optional)' },
          amount: { type: 'number', description: 'Amount (optional)' },
          token_type: { type: 'string', description: 'Token type for token transfers (optional)' }
        },
        required: ['sender']
      }
    }
  }
];

export type ToolParamMap = {
  [K in ToolName]: z.infer<(typeof toolSchemas)[K]>;
};
