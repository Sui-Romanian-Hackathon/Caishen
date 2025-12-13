import logger from '../../utils/logger';
import { getSuiClient } from './client';

export interface CoinMetadata {
  decimals: number;
  name: string;
  symbol: string;
  description?: string;
  iconUrl?: string | null;
}

const metadataCache = new Map<string, CoinMetadata | null>();

export async function getCoinMetadataCached(coinType: string): Promise<CoinMetadata | null> {
  if (metadataCache.has(coinType)) {
    return metadataCache.get(coinType) ?? null;
  }

  const client = getSuiClient();

  try {
    const meta = await client.getCoinMetadata({ coinType });
    if (meta) {
      const result: CoinMetadata = {
        decimals: meta.decimals,
        name: meta.name,
        symbol: meta.symbol,
        description: meta.description,
        iconUrl: meta.iconUrl
      };
      metadataCache.set(coinType, result);
      return result;
    }
  } catch (err) {
    logger.debug({ err, coinType }, 'Coin metadata lookup failed');
  }

  metadataCache.set(coinType, null);
  return null;
}

export function amountToBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be a positive number');
  }

  const [wholeStr, fractionStr = ''] = amount.toString().split('.');
  const fractionPadded = (fractionStr + '0'.repeat(decimals)).slice(0, decimals);
  const valueStr = `${wholeStr}${fractionPadded}`.replace(/^0+/, '') || '0';
  return BigInt(valueStr);
}
