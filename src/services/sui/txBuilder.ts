import { Transaction } from '@mysten/sui/transactions';
import { getSuiClient } from './client';
import { amountToBaseUnits, getCoinMetadataCached } from './utils';

export interface UnsignedTransaction {
  serialized: string; // base64 encoded transaction block
  digest?: string; // digest may be added post-signing
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface SendTxParams {
  recipient: string;
  amount: number;
  sender: string;
  gasBudget?: number;
}

export interface SendTokenTxParams extends SendTxParams {
  tokenType: string;
}

export interface NftTransferParams {
  nftId: string;
  recipient: string;
  sender: string;
  gasBudget?: number;
}

const SUI_DECIMALS = 9;
const DEFAULT_SUI_TRANSFER_GAS = 15000000;
const DEFAULT_TOKEN_TRANSFER_GAS = 20000000;

export async function buildSendSuiTx(params: SendTxParams): Promise<UnsignedTransaction> {
  const client = getSuiClient();
  const amountMist = amountToBaseUnits(params.amount, SUI_DECIMALS);

  const tx = new Transaction();
  tx.setSender(params.sender);
  const coin = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
  tx.transferObjects([coin], tx.pure.address(params.recipient));

  if (params.gasBudget) {
    tx.setGasBudget(params.gasBudget);
  }

  const serialized = await buildTransactionB64(tx, client);

  return {
    serialized,
    summary: `Send ${params.amount} SUI to ${params.recipient}`,
    metadata: {
      type: 'send_sui',
      amount_sui: params.amount,
      recipient: params.recipient,
      sender: params.sender
    }
  };
}

export async function buildSendTokenTx(params: SendTokenTxParams): Promise<UnsignedTransaction> {
  const client = getSuiClient();
  const meta = await getCoinMetadataCached(params.tokenType);
  const decimals = meta?.decimals ?? 0;
  const amountBase = amountToBaseUnits(params.amount, decimals);

  const coins = await selectCoins(params.sender, params.tokenType, amountBase);
  if (!coins.primary) {
    throw new Error('No coins available for the requested token');
  }

  const tx = new Transaction();
  tx.setSender(params.sender);

  if (coins.rest.length > 0) {
    tx.mergeCoins(
      tx.object(coins.primary.coinObjectId),
      coins.rest.map((c) => tx.object(c.coinObjectId))
    );
  }

  const paymentCoin = tx.splitCoins(tx.object(coins.primary.coinObjectId), [
    tx.pure.u64(amountBase)
  ]);
  tx.transferObjects([paymentCoin], tx.pure.address(params.recipient));

  if (params.gasBudget) {
    tx.setGasBudget(params.gasBudget);
  }

  const serialized = await buildTransactionB64(tx, client);

  return {
    serialized,
    summary: `Send ${params.amount} ${meta?.symbol ?? params.tokenType} to ${params.recipient}`,
    metadata: {
      type: 'send_token',
      amount: params.amount,
      tokenType: params.tokenType,
      recipient: params.recipient,
      sender: params.sender
    }
  };
}

export async function buildNftTransferTx(params: NftTransferParams): Promise<UnsignedTransaction> {
  const client = getSuiClient();

  const tx = new Transaction();
  tx.setSender(params.sender);
  tx.transferObjects([tx.object(params.nftId)], tx.pure.address(params.recipient));

  if (params.gasBudget) {
    tx.setGasBudget(params.gasBudget);
  }

  const serialized = await buildTransactionB64(tx, client);

  return {
    serialized,
    summary: `Transfer NFT ${params.nftId} to ${params.recipient}`,
    metadata: {
      type: 'transfer_nft',
      nftId: params.nftId,
      recipient: params.recipient,
      sender: params.sender
    }
  };
}

async function buildTransactionB64(tx: Transaction, client: ReturnType<typeof getSuiClient>) {
  const bytes = await tx.build({ client });
  return Buffer.from(bytes).toString('base64');
}

export async function estimateGasBudget(params: {
  type: 'sui' | 'token' | 'nft';
  sender: string;
}) {
  const client = getSuiClient();
  const referenceGasPrice = await client.getReferenceGasPrice();
  const base =
    params.type === 'sui'
      ? DEFAULT_SUI_TRANSFER_GAS
      : params.type === 'token'
      ? DEFAULT_TOKEN_TRANSFER_GAS
      : DEFAULT_SUI_TRANSFER_GAS;

  return {
    suggestedGasBudget: base,
    referenceGasPrice
  };
}

async function selectCoins(owner: string, coinType: string, required: bigint) {
  const client = getSuiClient();
  let cursor: string | null | undefined;
  let total = 0n;
  const coins: { coinObjectId: string; balance: string }[] = [];

  while (total < required) {
    const page = await client.getCoins({
      owner,
      coinType,
      cursor: cursor ?? undefined,
      limit: 50
    });

    coins.push(...page.data);
    total += page.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);

    if (!page.hasNextPage) {
      break;
    }

    cursor = page.nextCursor;
  }

  if (total < required) {
    throw new Error('Insufficient balance for this token');
  }

  return {
    primary: coins[0],
    rest: coins.slice(1)
  };
}
