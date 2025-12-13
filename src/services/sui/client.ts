import { SuiClient } from '@mysten/sui/client';
import { config } from '../../config/env';

const client = new SuiClient({
  url: config.SUI_RPC_URL
});

export function getSuiClient() {
  return client;
}
