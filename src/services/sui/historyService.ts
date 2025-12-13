import { getSuiClient } from './client';
import type { SuiTransactionBlockResponse } from '@mysten/sui/client';

export interface TransactionHistoryItem {
  digest: string;
  timestampMs: number | null;
  kind: 'sent' | 'received' | 'other';
  summary: string;
  counterparty?: string;
  amount?: string;
}

export interface TransactionHistoryResult {
  address: string;
  items: TransactionHistoryItem[];
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40,64}$/;

export async function fetchTransactionHistory(params: {
  address: string;
  limit: number;
  filter: 'sent' | 'received' | 'all';
}): Promise<TransactionHistoryResult> {
  if (!ADDRESS_REGEX.test(params.address)) {
    throw new Error('Invalid Sui address');
  }

  const limit = Number.isFinite(params.limit) && params.limit > 0 ? params.limit : 50;
  const client = getSuiClient();
  const result = await client.queryTransactionBlocks({
    filter: {
      ToAddress: params.address
    },
    options: {
      showBalanceChanges: true,
      showInput: true
    },
    limit
  });

  const items: TransactionHistoryItem[] = result.data
    .map((tx) => {
      const timestamp = tx.timestampMs ? Number(tx.timestampMs) : null;
      const kind = classifyKind(tx, params.address);
      const counterparty = deriveCounterparty(tx, params.address, kind);
      const amount = deriveNetAmount(tx, params.address, kind);
      return {
        digest: tx.digest,
        timestampMs: timestamp,
        kind,
        summary: summarizeTx(tx, kind, amount, counterparty),
        counterparty
      };
    })
    .filter((item) => {
      if (params.filter === 'all') return true;
      return item.kind === params.filter;
    });

  return {
    address: params.address,
    items
  };
}

function classifyKind(
  tx: SuiTransactionBlockResponse,
  address: string
): 'sent' | 'received' | 'other' {
  const sender = tx.transaction?.data?.sender;
  if (sender && sender.toLowerCase() === address.toLowerCase()) {
    return 'sent';
  }

  const received = tx.balanceChanges?.some((change) => {
    const owner = (change.owner as { AddressOwner?: string }).AddressOwner;
    return owner && owner.toLowerCase() === address.toLowerCase() && Number(change.amount) > 0;
  });

  if (received) {
    return 'received';
  }

  return 'other';
}

function deriveCounterparty(tx: SuiTransactionBlockResponse, address: string, kind: TransactionHistoryItem['kind']) {
  const sender = tx.transaction?.data?.sender;
  if (kind === 'sent') {
    const firstRecipient = tx.balanceChanges?.find((change) => {
      const owner = (change.owner as { AddressOwner?: string }).AddressOwner;
      return owner && owner.toLowerCase() !== address.toLowerCase() && Number(change.amount) > 0;
    });
    return firstRecipient ? (firstRecipient.owner as { AddressOwner?: string }).AddressOwner : undefined;
  }
  if (kind === 'received') {
    return sender ?? undefined;
  }
  return undefined;
}

function deriveNetAmount(
  tx: SuiTransactionBlockResponse,
  address: string,
  kind: TransactionHistoryItem['kind']
) {
  const relevant = tx.balanceChanges?.filter((change) => {
    const owner = (change.owner as { AddressOwner?: string }).AddressOwner;
    return owner && owner.toLowerCase() === address.toLowerCase();
  });

  if (!relevant || relevant.length === 0) return undefined;

  const total = relevant.reduce((sum, change) => sum + BigInt(change.amount), 0n);
  if (kind === 'sent' && total >= 0n) return undefined;
  if (kind === 'received' && total <= 0n) return undefined;
  return total.toString();
}

function summarizeTx(
  tx: SuiTransactionBlockResponse,
  kind: TransactionHistoryItem['kind'],
  amount: string | undefined,
  counterparty: string | undefined
) {
  const short = `${tx.digest.slice(0, 6)}…${tx.digest.slice(-6)}`;
  const cp = counterparty ? ` with ${counterparty}` : '';
  const amt = amount ? ` amount ${amount}` : '';
  if (kind === 'sent') return `Sent tx ${short}${cp}${amt}`;
  if (kind === 'received') return `Received tx ${short}${cp}${amt}`;
  return `Tx ${short}${cp}${amt}`;
}
