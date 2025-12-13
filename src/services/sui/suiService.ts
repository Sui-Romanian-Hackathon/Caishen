import { getSuiClient } from './client';
import { getCoinMetadataCached } from './utils';

const SUI_COIN_TYPE = '0x2::sui::SUI';

export interface TokenBalance {
  coinType: string;
  totalBalance: string;
  symbol?: string;
  decimals?: number;
  formatted?: string;
}

export interface BalanceSummary {
  address: string;
  sui: {
    total: string;
    formatted: string;
  };
  tokens: TokenBalance[];
}

export async function getBalanceSummary(address: string): Promise<BalanceSummary> {
  if (!/^0x[a-fA-F0-9]{40,64}$/.test(address)) {
    throw new Error('Invalid Sui address');
  }
  const client = getSuiClient();
  const balances = await client.getAllBalances({ owner: address });

  let suiTotal = '0';
  const otherBalances: typeof balances = [];

  for (const bal of balances) {
    if (bal.coinType === SUI_COIN_TYPE) {
      suiTotal = bal.totalBalance;
    } else {
      otherBalances.push(bal);
    }
  }

  const tokens = await Promise.all(
    otherBalances.map(async (bal) => {
      const meta = await getCoinMetadataCached(bal.coinType);
      const formatted = meta ? formatUnits(bal.totalBalance, meta.decimals) : undefined;

      return {
        coinType: bal.coinType,
        totalBalance: bal.totalBalance,
        symbol: meta?.symbol,
        decimals: meta?.decimals,
        formatted
      };
    })
  );

  return {
    address,
    sui: {
      total: suiTotal,
      formatted: formatUnits(suiTotal, 9)
    },
    tokens
  };
}

function formatUnits(raw: string, decimals: number) {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionStr}`;
}
