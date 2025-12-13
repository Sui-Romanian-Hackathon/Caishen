import { getSuiClient } from './client';

export interface NftItem {
  id: string;
  name?: string;
  collection?: string;
  imageUrl?: string | null;
  acquiredAt?: string;
}

export interface RecentNftsResult {
  owner: string;
  nfts: NftItem[];
  windowStart?: string;
}

export async function listRecentNfts(params: {
  owner: string;
  since?: string;
  collection?: string;
  limit?: number;
}): Promise<RecentNftsResult> {
  const client = getSuiClient();
  const limit = params.limit ?? 20;
  const result = await client.getOwnedObjects({
    owner: params.owner,
    filter: params.collection ? { StructType: params.collection } : undefined,
    options: { showDisplay: true },
    limit
  });

  const nfts: NftItem[] = result.data
    .map((obj) => {
      const display = obj.data?.display?.data ?? {};
      return {
        id: obj.data?.objectId ?? 'unknown',
        name: display.name,
        collection: display.collection,
        imageUrl: display.image_url ?? display.imageUrl ?? null
      };
    })
    .filter((item) => !params.collection || item.collection === params.collection);

  return {
    owner: params.owner,
    nfts,
    windowStart: params.since
  };
}
