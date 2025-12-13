"""Sui blockchain service for balance, transactions, and history"""

import logging
from typing import Optional, Dict, Any, List
from decimal import Decimal

import httpx

from src.core import settings

logger = logging.getLogger(__name__)

# Constants
MIST_PER_SUI = 1_000_000_000
SUI_COIN_TYPE = "0x2::sui::SUI"


class SuiService:
    """Handles all Sui blockchain RPC interactions"""

    def __init__(self):
        self.rpc_url = settings.SUI_RPC_URL
        self.network = settings.SUI_NETWORK

    async def _rpc_call(self, method: str, params: List[Any]) -> Any:
        """Make a JSON-RPC call to the Sui node"""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self.rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": method,
                    "params": params,
                },
            )
            response.raise_for_status()
            data = response.json()

            if "error" in data:
                raise Exception(f"RPC error: {data['error']}")

            return data.get("result")

    async def get_balance(self, address: str) -> Dict[str, Any]:
        """Get SUI balance for an address"""
        try:
            result = await self._rpc_call("suix_getBalance", [address, SUI_COIN_TYPE])

            total_balance = int(result.get("totalBalance", 0))
            sui_balance = Decimal(total_balance) / Decimal(MIST_PER_SUI)

            return {
                "address": address,
                "sui": {
                    "total": total_balance,
                    "formatted": f"{sui_balance:.4f} SUI",
                },
                "coin_count": result.get("coinObjectCount", 0),
            }
        except Exception as e:
            logger.error(f"Failed to get balance for {address}: {e}")
            raise

    async def get_all_balances(self, address: str) -> Dict[str, Any]:
        """Get all token balances for an address"""
        try:
            result = await self._rpc_call("suix_getAllBalances", [address])

            tokens = []
            sui_balance = None

            for balance in result:
                coin_type = balance.get("coinType", "")
                total = int(balance.get("totalBalance", 0))

                if coin_type == SUI_COIN_TYPE:
                    sui_formatted = Decimal(total) / Decimal(MIST_PER_SUI)
                    sui_balance = {
                        "total": total,
                        "formatted": f"{sui_formatted:.4f} SUI",
                    }
                else:
                    # Extract token symbol from coin type
                    symbol = coin_type.split("::")[-1] if "::" in coin_type else coin_type
                    tokens.append({
                        "coinType": coin_type,
                        "symbol": symbol,
                        "totalBalance": total,
                    })

            return {
                "address": address,
                "sui": sui_balance or {"total": 0, "formatted": "0.0000 SUI"},
                "tokens": tokens,
            }
        except Exception as e:
            logger.error(f"Failed to get all balances for {address}: {e}")
            raise

    async def get_coins(self, address: str, coin_type: str = SUI_COIN_TYPE, limit: int = 50) -> List[Dict]:
        """Get coin objects for an address"""
        try:
            result = await self._rpc_call("suix_getCoins", [address, coin_type, None, limit])
            return result.get("data", [])
        except Exception as e:
            logger.error(f"Failed to get coins for {address}: {e}")
            raise

    async def get_transaction_history(
        self,
        address: str,
        limit: int = 10,
        cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get transaction history for an address"""
        try:
            # Query transactions from address
            from_result = await self._rpc_call(
                "suix_queryTransactionBlocks",
                [{
                    "filter": {"FromAddress": address},
                    "options": {
                        "showInput": True,
                        "showEffects": True,
                        "showEvents": False,
                    },
                }, cursor, limit, True]
            )

            # Query transactions to address
            to_result = await self._rpc_call(
                "suix_queryTransactionBlocks",
                [{
                    "filter": {"ToAddress": address},
                    "options": {
                        "showInput": True,
                        "showEffects": True,
                        "showEvents": False,
                    },
                }, cursor, limit, True]
            )

            # Combine and deduplicate
            all_txs = {}
            for tx in from_result.get("data", []):
                digest = tx.get("digest")
                all_txs[digest] = {**tx, "kind": "sent"}

            for tx in to_result.get("data", []):
                digest = tx.get("digest")
                if digest not in all_txs:
                    all_txs[digest] = {**tx, "kind": "received"}

            # Sort by timestamp (descending)
            sorted_txs = sorted(
                all_txs.values(),
                key=lambda x: x.get("timestampMs", 0),
                reverse=True
            )[:limit]

            # Format transactions
            items = []
            for tx in sorted_txs:
                items.append(self._format_transaction(tx, address))

            return {
                "items": items,
                "hasNextPage": from_result.get("hasNextPage", False) or to_result.get("hasNextPage", False),
                "nextCursor": from_result.get("nextCursor"),
            }
        except Exception as e:
            logger.error(f"Failed to get transaction history for {address}: {e}")
            raise

    def _format_transaction(self, tx: Dict, user_address: str) -> Dict[str, Any]:
        """Format a transaction for display"""
        digest = tx.get("digest", "")
        timestamp_ms = tx.get("timestampMs")
        kind = tx.get("kind", "other")

        # Get status from effects
        effects = tx.get("effects", {})
        status = effects.get("status", {}).get("status", "unknown")

        # Try to extract transfer amount
        summary = "Transaction"
        if kind == "sent":
            summary = "Sent SUI"
        elif kind == "received":
            summary = "Received SUI"

        return {
            "digest": digest,
            "timestampMs": int(timestamp_ms) if timestamp_ms else None,
            "kind": kind,
            "status": status,
            "summary": summary,
            "explorerUrl": f"https://suiscan.xyz/{self.network}/tx/{digest}",
        }

    async def build_transfer_tx(
        self,
        sender: str,
        recipient: str,
        amount_sui: float,
        gas_budget: int = 10_000_000,
    ) -> Dict[str, Any]:
        """Build an unsigned transfer transaction"""
        try:
            amount_mist = int(amount_sui * MIST_PER_SUI)

            # Get coins for sender
            coins = await self.get_coins(sender)
            if not coins:
                raise Exception("No SUI coins found in wallet")

            # Use Pay transaction
            coin_ids = [c["coinObjectId"] for c in coins[:10]]

            tx_bytes = await self._rpc_call(
                "unsafe_pay",
                [
                    sender,
                    coin_ids,
                    [recipient],
                    [str(amount_mist)],
                    None,  # gas object (auto-select)
                    str(gas_budget),
                ]
            )

            return {
                "txBytes": tx_bytes,
                "sender": sender,
                "recipient": recipient,
                "amount": amount_sui,
                "amountMist": amount_mist,
                "summary": f"Send {amount_sui} SUI to {recipient[:10]}...{recipient[-6:]}",
            }
        except Exception as e:
            logger.error(f"Failed to build transfer tx: {e}")
            raise

    async def get_object(self, object_id: str) -> Optional[Dict]:
        """Get an object by ID"""
        try:
            result = await self._rpc_call(
                "sui_getObject",
                [object_id, {"showContent": True, "showType": True}]
            )
            return result.get("data")
        except Exception as e:
            logger.error(f"Failed to get object {object_id}: {e}")
            return None

    async def get_owned_objects(
        self,
        address: str,
        limit: int = 50,
        cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get all objects owned by an address"""
        try:
            result = await self._rpc_call(
                "suix_getOwnedObjects",
                [
                    address,
                    {"filter": None, "options": {"showType": True, "showContent": True}},
                    cursor,
                    limit,
                ]
            )
            return {
                "data": result.get("data", []),
                "hasNextPage": result.get("hasNextPage", False),
                "nextCursor": result.get("nextCursor"),
            }
        except Exception as e:
            logger.error(f"Failed to get owned objects for {address}: {e}")
            raise


# Singleton instance
sui_service = SuiService()
