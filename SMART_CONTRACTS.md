# Smart Contracts — AI Copilot Wallet

> **Version:** 0.1.0 | **Language:** Move (Sui) | **Edition:** 2024.beta

This document describes the on-chain smart contracts for the AI Copilot Wallet, enabling advanced blockchain operations beyond basic SDK calls.

---

## Overview

The AI Copilot Wallet smart contracts provide three core capabilities:

| Contract | Purpose | Key Benefits |
|----------|---------|--------------|
| **BatchTransfer** | Multi-recipient payments | Atomic execution, reduced gas |
| **ContactRegistry** | On-chain address book | Portable, shared contacts |
| **SpendingGuardian** | Rate-limited transfers | Anti-theft, spending controls |

### Why Smart Contracts?

Before smart contracts, all operations were SDK-level calls:
- One-to-one transfers only
- No spending limits or protections
- Contacts stored locally (not portable)

Smart contracts enable:
- **Batch payments**: "Pay 10 employees" in one tx
- **Spending limits**: "Max 100 SUI per day"
- **Shared contacts**: "@alice" resolves on-chain
- **Atomic operations**: All-or-nothing guarantees

---

## Contract Directory

```
move/
├── Move.toml                         # Package manifest
└── sources/
    ├── batch_transfer.move           # Multi-recipient payments
    ├── contact_registry.move         # On-chain address book
    └── spending_guardian.move        # Rate-limited transfers
```

---

## 1. BatchTransfer

**File:** `move/sources/batch_transfer.move`
**Module:** `ai_copilot::batch_transfer`

### Purpose

Execute atomic multi-recipient transfers in a single transaction. Reduces gas costs and ensures all-or-nothing execution for batch payments.

### Use Cases

- **Payroll**: "Pay 10 employees from one command"
- **Airdrops**: "Distribute tokens to holders"
- **Bill splitting**: "Split this among 3 friends"

### Entry Functions

#### `batch_send_sui`
Send SUI to multiple recipients with specified amounts.

```move
public entry fun batch_send_sui(
    coin: Coin<SUI>,
    recipients: vector<address>,
    amounts: vector<u64>,    // In MIST (1 SUI = 1,000,000,000 MIST)
    ctx: &mut TxContext
)
```

**Example CLI:**
```bash
sui client call \
  --package 0x<PACKAGE_ID> \
  --module batch_transfer \
  --function batch_send_sui \
  --args <COIN_ID> '["0xaddr1","0xaddr2","0xaddr3"]' '[1000000000,2000000000,500000000]' \
  --gas-budget 30000000
```

#### `batch_send_coin<T>`
Generic version for any coin type (USDC, custom tokens, etc.).

```move
public entry fun batch_send_coin<T>(
    coin: Coin<T>,
    recipients: vector<address>,
    amounts: vector<u64>,
    ctx: &mut TxContext
)
```

#### `split_equal_sui`
Split SUI equally among recipients (remainder returned to sender).

```move
public entry fun split_equal_sui(
    coin: Coin<SUI>,
    recipients: vector<address>,
    ctx: &mut TxContext
)
```

### Events

```move
// Emitted per batch
public struct BatchTransferEvent has copy, drop {
    sender: address,
    recipient_count: u64,
    total_amount: u64,
    coin_type: vector<u8>,
}

// Emitted per individual transfer
public struct TransferRecord has copy, drop {
    sender: address,
    recipient: address,
    amount: u64,
    batch_id: u64,
}
```

### Limits & Safety

| Parameter | Value | Reason |
|-----------|-------|--------|
| Max recipients | 100 | Gas limit protection |
| Min recipients | 1 | Prevent empty batches |
| Array matching | Required | Recipients must match amounts |

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | `ELengthMismatch` | Recipients/amounts arrays different lengths |
| 1 | `EEmptyRecipients` | Empty recipients list |
| 2 | `EInsufficientBalance` | Coin balance too low |
| 3 | `ERecipientLimitExceeded` | More than 100 recipients |

---

## 2. ContactRegistry

**File:** `move/sources/contact_registry.move`
**Module:** `ai_copilot::contact_registry`

### Purpose

On-chain contact registry for human-readable name-to-address mappings. Enables users to send to "@alice" instead of "0x..." addresses.

### Use Cases

- **Personal contacts**: "Send to alice" resolves from your book
- **Public names**: Register "alice.sui" for your address
- **Team directories**: Shared contact lists
- **Cross-wallet portability**: Contacts follow your address

### Objects

#### ContactBook (Owned)
Personal contact book owned by each user.

```move
public struct ContactBook has key, store {
    id: UID,
    owner: address,
    contacts: Table<String, ContactEntry>,
    reverse_lookup: Table<address, String>,
    contact_count: u64,
}

public struct ContactEntry has store, copy, drop {
    address: address,
    name: String,
    notes: String,
    created_at: u64,           // Epoch timestamp
    transfer_count: u64,       // Successful transfers to this contact
    is_verified: bool,
}
```

#### GlobalRegistry (Shared)
Public name registry (first-come-first-served).

```move
public struct GlobalRegistry has key {
    id: UID,
    names: Table<String, address>,
    reverse: Table<address, String>,
    total_registrations: u64,
}
```

### Entry Functions

#### Personal Contact Book

```move
// Create your contact book
public entry fun create_contact_book(ctx: &mut TxContext)

// Add a contact
public entry fun add_contact(
    book: &mut ContactBook,
    name: vector<u8>,           // e.g., b"alice"
    contact_address: address,
    notes: vector<u8>,          // Optional description
    ctx: &mut TxContext
)

// Remove a contact
public entry fun remove_contact(
    book: &mut ContactBook,
    name: vector<u8>,
    ctx: &mut TxContext
)

// Update contact address
public entry fun update_contact(
    book: &mut ContactBook,
    name: vector<u8>,
    new_address: address,
    ctx: &mut TxContext
)
```

#### Global Registry

```move
// Register a public name (first-come-first-served)
public entry fun register_public_name(
    registry: &mut GlobalRegistry,
    name: vector<u8>,
    ctx: &mut TxContext
)
```

### View Functions

```move
// Resolve name to address
public fun resolve_contact(book: &ContactBook, name: &String): address

// Check if contact exists
public fun contact_exists(book: &ContactBook, name: &String): bool

// Reverse lookup (address to name)
public fun get_name_by_address(book: &ContactBook, addr: &address): String

// Check public name availability
public fun is_name_available(registry: &GlobalRegistry, name: &String): bool
```

### Events

```move
public struct ContactAdded has copy, drop {
    owner: address,
    name: vector<u8>,
    contact_address: address,
}

public struct ContactRemoved has copy, drop {
    owner: address,
    name: vector<u8>,
    contact_address: address,
}

public struct PublicNameRegistered has copy, drop {
    name: vector<u8>,
    address: address,
}
```

### Limits

| Parameter | Value |
|-----------|-------|
| Max name length | 32 characters |
| Min name length | 1 character |

---

## 3. SpendingGuardian

**File:** `move/sources/spending_guardian.move`
**Module:** `ai_copilot::spending_guardian`

### Purpose

Rate-limited transfer protection for anti-theft and spending controls. Enforces configurable limits over time windows.

### Use Cases

- **Anti-theft**: "Max 100 SUI per day even if compromised"
- **Budget control**: "Don't let me spend more than X"
- **Parental controls**: "Kids can only spend 10 SUI/day"
- **Cooldowns**: "Wait 1 hour between large transfers"
- **Emergency freeze**: Instantly stop all outgoing transfers

### Objects

```move
public struct SpendingGuard has key, store {
    id: UID,
    owner: address,
    per_tx_limit: u64,         // Max per transaction (0 = unlimited)
    daily_limit: u64,          // Max per day (0 = unlimited)
    cooldown_period: u64,      // Cooldown in milliseconds
    cooldown_threshold: u64,   // Amount that triggers cooldown
    spent_today: u64,          // Amount spent in current day
    day_start: u64,            // Day start timestamp (ms)
    last_transfer_time: u64,   // Last transfer timestamp
    last_transfer_amount: u64, // Last transfer amount
    is_frozen: bool,           // Emergency freeze flag
    whitelist: Table<address, bool>, // Unlimited transfer addresses
}

// Capability to modify guard settings
public struct GuardianCap has key, store {
    id: UID,
    guard_id: ID,
}
```

### Entry Functions

#### Setup

```move
// Create spending guard with limits
public entry fun create_guard(
    per_tx_limit: u64,         // Max per transaction (in MIST)
    daily_limit: u64,          // Max per day (in MIST)
    clock: &Clock,
    ctx: &mut TxContext
)
```

**Example:** Create guard with 10 SUI/tx limit and 100 SUI/day limit:
```bash
sui client call \
  --package 0x<PACKAGE_ID> \
  --module spending_guardian \
  --function create_guard \
  --args 10000000000 100000000000 0x6 \  # 0x6 is the Clock object
  --gas-budget 20000000
```

#### Guarded Transfers

```move
// Execute a guarded SUI transfer
public entry fun guarded_send_sui(
    guard: &mut SpendingGuard,
    coin: Coin<SUI>,
    recipient: address,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext
)
```

#### Admin Functions

```move
// Update spending limits
public entry fun update_limits(
    guard: &mut SpendingGuard,
    cap: &GuardianCap,
    per_tx_limit: u64,
    daily_limit: u64,
    ctx: &mut TxContext
)

// Configure cooldown
public entry fun set_cooldown(
    guard: &mut SpendingGuard,
    cap: &GuardianCap,
    cooldown_period: u64,      // In milliseconds
    cooldown_threshold: u64,   // Amount that triggers cooldown
    ctx: &mut TxContext
)

// Emergency freeze
public entry fun freeze_account(
    guard: &mut SpendingGuard,
    cap: &GuardianCap,
    ctx: &mut TxContext
)

// Unfreeze
public entry fun unfreeze_account(
    guard: &mut SpendingGuard,
    cap: &GuardianCap,
    ctx: &mut TxContext
)

// Whitelist management
public entry fun add_to_whitelist(
    guard: &mut SpendingGuard,
    cap: &GuardianCap,
    addr: address,
    ctx: &mut TxContext
)

public entry fun remove_from_whitelist(
    guard: &mut SpendingGuard,
    cap: &GuardianCap,
    addr: address,
    ctx: &mut TxContext
)
```

### View Functions

```move
public fun get_daily_spent(guard: &SpendingGuard): u64
public fun get_daily_limit(guard: &SpendingGuard): u64
public fun get_daily_remaining(guard: &SpendingGuard): u64
public fun is_frozen(guard: &SpendingGuard): bool
public fun is_whitelisted(guard: &SpendingGuard, addr: &address): bool
public fun get_per_tx_limit(guard: &SpendingGuard): u64
```

### Events

```move
public struct GuardCreated has copy, drop {
    owner: address,
    guard_id: ID,
    per_tx_limit: u64,
    daily_limit: u64,
}

public struct GuardedTransfer has copy, drop {
    owner: address,
    recipient: address,
    amount: u64,
    daily_spent: u64,
    daily_remaining: u64,
}

public struct LimitExceeded has copy, drop {
    owner: address,
    requested_amount: u64,
    limit_type: vector<u8>,    // "per_tx", "daily", "cooldown"
    limit_value: u64,
}

public struct AccountFreezeChanged has copy, drop {
    owner: address,
    is_frozen: bool,
}
```

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | `EDailyLimitExceeded` | Daily spending limit reached |
| 1 | `ETransactionLimitExceeded` | Per-transaction limit reached |
| 2 | `ECooldownActive` | Cooldown period not elapsed |
| 3 | `EAccountFrozen` | Account is frozen |
| 4 | `ENotAuthorized` | Caller not owner |
| 5 | `EInvalidLimit` | Invalid limit configuration |

---

## Deployment

### Prerequisites

1. Install Sui CLI: https://docs.sui.io/guides/developer/getting-started/sui-install
2. Configure wallet: `sui client active-address`
3. Get testnet SUI: `sui client faucet`

### Build & Test

```bash
cd move

# Build
sui move build

# Test
sui move test

# Publish to testnet
sui client publish --gas-budget 100000000
```

### Post-Deployment

After publishing, save the package ID and object IDs:

```bash
# Example output:
# Package ID: 0x1234...
# GlobalRegistry ID: 0xabcd... (shared object from ContactRegistry init)
```

Update your `.env`:

```env
SMART_CONTRACT_PACKAGE_ID=0x1234...
CONTACT_REGISTRY_ID=0xabcd...
```

---

## Integration with Bot

### Adding Smart Contract Tools

Add these tool schemas to `src/services/llm/tools.ts`:

```typescript
// Batch transfer tool
{
  name: 'batch_send_sui',
  description: 'Send SUI to multiple recipients in one atomic transaction',
  parameters: {
    type: 'object',
    properties: {
      recipients: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of recipient addresses'
      },
      amounts: {
        type: 'array',
        items: { type: 'number' },
        description: 'Array of amounts in SUI for each recipient'
      }
    },
    required: ['recipients', 'amounts']
  }
}
```

### Bot Commands

The AI can now handle:

- "Send 5 SUI to alice, bob, and carol" → `batch_send_sui`
- "Add alice as 0x123..." → `add_contact` (on-chain)
- "Set my daily limit to 100 SUI" → `create_guard`
- "Freeze my account" → `freeze_account`

---

## Security Considerations

### BatchTransfer
- Maximum 100 recipients per batch (gas limit protection)
- All-or-nothing execution (atomic)
- Remainder always returned to sender

### ContactRegistry
- Personal books are owner-only modifiable
- Public names are first-come-first-served
- No name reclaiming (permanent registration)

### SpendingGuardian
- GuardianCap required for admin operations
- Daily counters reset automatically
- Whitelist bypasses all limits (use carefully)
- Freeze is immediate but reversible

---

## Future Enhancements

| Feature | Description | Priority |
|---------|-------------|----------|
| **Allowance System** | Delegated spending limits | High |
| **Multi-sig Support** | Team wallets with threshold signing | Medium |
| **Payment Channels** | Off-chain micropayments | Low |
| **NFT Marketplace** | On-chain listing/bidding | Low |
| **Scheduled Transfers** | Time-locked payments | Medium |

---

## References

- [Sui Move Documentation](https://docs.sui.io/concepts/sui-move-concepts)
- [Move Language Book](https://move-language.github.io/move/)
- [Sui Framework Source](https://github.com/MystenLabs/sui/tree/main/crates/sui-framework)
- [Move 2024 Edition](https://docs.sui.io/guides/developer/advanced/move-2024-migration)
