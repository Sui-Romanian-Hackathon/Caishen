/// SpendingGuardian Module
///
/// Rate-limited transfer protection for anti-theft and spending controls.
/// Enforces configurable spending limits over time windows.
///
/// Features:
/// - Daily/hourly/custom spending limits
/// - Per-transaction limits
/// - Cooldown periods between large transfers
/// - Emergency freeze functionality
/// - Whitelist for unlimited transfers
///
/// Use Cases:
/// - "Don't let me send more than 100 SUI per day"
/// - "Require cooldown for transfers over 50 SUI"
/// - Anti-theft protection for compromised accounts
/// - Parental controls for children's wallets
///
/// @author AI Copilot Wallet Team
/// @version 0.1.0
#[allow(lint(public_entry))]
module ai_copilot::spending_guardian {
    use sui::coin::Coin;
    use sui::sui::SUI;
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::Clock;

    // ============ Errors ============

    /// Daily limit exceeded
    const EDailyLimitExceeded: u64 = 0;
    /// Per-transaction limit exceeded
    const ETransactionLimitExceeded: u64 = 1;
    /// Cooldown period active
    const ECooldownActive: u64 = 2;
    /// Account is frozen
    const EAccountFrozen: u64 = 3;
    /// Not authorized
    const ENotAuthorized: u64 = 4;

    // ============ Constants ============

    /// One day in milliseconds
    const DAY_MS: u64 = 86_400_000;

    // ============ Objects ============

    /// Guardian configuration owned by user
    public struct SpendingGuard has key, store {
        id: UID,
        /// Owner of this guard
        owner: address,
        /// Maximum amount per transaction (in MIST)
        per_tx_limit: u64,
        /// Maximum amount per day (in MIST)
        daily_limit: u64,
        /// Cooldown period after large transfers (ms)
        cooldown_period: u64,
        /// Threshold that triggers cooldown
        cooldown_threshold: u64,
        /// Amount spent in current day
        spent_today: u64,
        /// Day start timestamp (ms)
        day_start: u64,
        /// Last transfer timestamp (ms)
        last_transfer_time: u64,
        /// Last transfer amount
        last_transfer_amount: u64,
        /// Whether account is frozen
        is_frozen: bool,
        /// Whitelisted addresses (unlimited transfers)
        whitelist: Table<address, bool>,
    }

    /// Capability to modify guard settings
    public struct GuardianCap has key, store {
        id: UID,
        guard_id: ID,
    }

    // ============ Events ============

    /// Emitted when guard is created
    public struct GuardCreated has copy, drop {
        owner: address,
        guard_id: ID,
        per_tx_limit: u64,
        daily_limit: u64,
    }

    /// Emitted when a guarded transfer occurs
    public struct GuardedTransfer has copy, drop {
        owner: address,
        recipient: address,
        amount: u64,
        daily_spent: u64,
        daily_remaining: u64,
    }

    /// Emitted when limit is exceeded (transfer blocked)
    public struct LimitExceeded has copy, drop {
        owner: address,
        requested_amount: u64,
        limit_type: vector<u8>,
        limit_value: u64,
    }

    /// Emitted when account is frozen/unfrozen
    public struct AccountFreezeChanged has copy, drop {
        owner: address,
        is_frozen: bool,
    }

    /// Emitted when limits are updated
    public struct LimitsUpdated has copy, drop {
        owner: address,
        per_tx_limit: u64,
        daily_limit: u64,
    }

    // ============ Entry Functions ============

    /// Create a new spending guard with default limits
    ///
    /// @param per_tx_limit - Max per transaction (in MIST, 0 = unlimited)
    /// @param daily_limit - Max per day (in MIST, 0 = unlimited)
    /// @param ctx - Transaction context
    public entry fun create_guard(
        per_tx_limit: u64,
        daily_limit: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        let guard_uid = object::new(ctx);
        let guard_id = guard_uid.to_inner();

        let guard = SpendingGuard {
            id: guard_uid,
            owner: sender,
            per_tx_limit,
            daily_limit,
            cooldown_period: 0,
            cooldown_threshold: 0,
            spent_today: 0,
            day_start: clock.timestamp_ms(),
            last_transfer_time: 0,
            last_transfer_amount: 0,
            is_frozen: false,
            whitelist: table::new(ctx),
        };

        let cap = GuardianCap {
            id: object::new(ctx),
            guard_id,
        };

        event::emit(GuardCreated {
            owner: sender,
            guard_id,
            per_tx_limit,
            daily_limit,
        });

        transfer::transfer(guard, sender);
        transfer::transfer(cap, sender);
    }

    /// Execute a guarded SUI transfer
    ///
    /// @param guard - The spending guard
    /// @param coin - SUI to transfer
    /// @param recipient - Destination address
    /// @param amount - Amount to send
    /// @param clock - Clock for timestamp
    /// @param ctx - Transaction context
    public entry fun guarded_send_sui(
        guard: &mut SpendingGuard,
        mut coin: Coin<SUI>,
        recipient: address,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(guard.owner == sender, ENotAuthorized);
        assert!(!guard.is_frozen, EAccountFrozen);

        let now = clock.timestamp_ms();

        // Reset daily counter if new day
        if (now - guard.day_start >= DAY_MS) {
            guard.spent_today = 0;
            guard.day_start = now;
        };

        // Check if recipient is whitelisted (skip limits)
        let is_whitelisted = guard.whitelist.contains(recipient);

        if (!is_whitelisted) {
            // Check per-transaction limit
            if (guard.per_tx_limit > 0 && amount > guard.per_tx_limit) {
                event::emit(LimitExceeded {
                    owner: sender,
                    requested_amount: amount,
                    limit_type: b"per_tx",
                    limit_value: guard.per_tx_limit,
                });
                abort ETransactionLimitExceeded
            };

            // Check daily limit
            if (guard.daily_limit > 0 && guard.spent_today + amount > guard.daily_limit) {
                event::emit(LimitExceeded {
                    owner: sender,
                    requested_amount: amount,
                    limit_type: b"daily",
                    limit_value: guard.daily_limit,
                });
                abort EDailyLimitExceeded
            };

            // Check cooldown
            if (guard.cooldown_period > 0 && guard.cooldown_threshold > 0) {
                if (guard.last_transfer_amount >= guard.cooldown_threshold) {
                    let time_since_last = now - guard.last_transfer_time;
                    if (time_since_last < guard.cooldown_period) {
                        event::emit(LimitExceeded {
                            owner: sender,
                            requested_amount: amount,
                            limit_type: b"cooldown",
                            limit_value: guard.cooldown_period - time_since_last,
                        });
                        abort ECooldownActive
                    }
                }
            };
        };

        // Execute transfer
        let payment = coin.split(amount, ctx);
        transfer::public_transfer(payment, recipient);

        // Update tracking
        guard.spent_today = guard.spent_today + amount;
        guard.last_transfer_time = now;
        guard.last_transfer_amount = amount;

        // Return remaining
        if (coin.value() > 0) {
            transfer::public_transfer(coin, sender);
        } else {
            coin.destroy_zero();
        };

        event::emit(GuardedTransfer {
            owner: sender,
            recipient,
            amount,
            daily_spent: guard.spent_today,
            daily_remaining: if (guard.daily_limit > guard.spent_today) {
                guard.daily_limit - guard.spent_today
            } else {
                0
            },
        });
    }

    // ============ Admin Functions ============

    /// Update spending limits
    public entry fun update_limits(
        guard: &mut SpendingGuard,
        cap: &GuardianCap,
        per_tx_limit: u64,
        daily_limit: u64,
        ctx: &mut TxContext
    ) {
        assert!(guard.owner == ctx.sender(), ENotAuthorized);
        assert!(cap.guard_id == guard.id.to_inner(), ENotAuthorized);

        guard.per_tx_limit = per_tx_limit;
        guard.daily_limit = daily_limit;

        event::emit(LimitsUpdated {
            owner: ctx.sender(),
            per_tx_limit,
            daily_limit,
        });
    }

    /// Set cooldown configuration
    public entry fun set_cooldown(
        guard: &mut SpendingGuard,
        cap: &GuardianCap,
        cooldown_period: u64,
        cooldown_threshold: u64,
        ctx: &mut TxContext
    ) {
        assert!(guard.owner == ctx.sender(), ENotAuthorized);
        assert!(cap.guard_id == guard.id.to_inner(), ENotAuthorized);

        guard.cooldown_period = cooldown_period;
        guard.cooldown_threshold = cooldown_threshold;
    }

    /// Freeze account (emergency stop)
    public entry fun freeze_account(
        guard: &mut SpendingGuard,
        cap: &GuardianCap,
        ctx: &mut TxContext
    ) {
        assert!(guard.owner == ctx.sender(), ENotAuthorized);
        assert!(cap.guard_id == guard.id.to_inner(), ENotAuthorized);

        guard.is_frozen = true;

        event::emit(AccountFreezeChanged {
            owner: ctx.sender(),
            is_frozen: true,
        });
    }

    /// Unfreeze account
    public entry fun unfreeze_account(
        guard: &mut SpendingGuard,
        cap: &GuardianCap,
        ctx: &mut TxContext
    ) {
        assert!(guard.owner == ctx.sender(), ENotAuthorized);
        assert!(cap.guard_id == guard.id.to_inner(), ENotAuthorized);

        guard.is_frozen = false;

        event::emit(AccountFreezeChanged {
            owner: ctx.sender(),
            is_frozen: false,
        });
    }

    /// Add address to whitelist
    public entry fun add_to_whitelist(
        guard: &mut SpendingGuard,
        cap: &GuardianCap,
        addr: address,
        ctx: &mut TxContext
    ) {
        assert!(guard.owner == ctx.sender(), ENotAuthorized);
        assert!(cap.guard_id == guard.id.to_inner(), ENotAuthorized);

        if (!guard.whitelist.contains(addr)) {
            guard.whitelist.add(addr, true);
        }
    }

    /// Remove address from whitelist
    public entry fun remove_from_whitelist(
        guard: &mut SpendingGuard,
        cap: &GuardianCap,
        addr: address,
        ctx: &mut TxContext
    ) {
        assert!(guard.owner == ctx.sender(), ENotAuthorized);
        assert!(cap.guard_id == guard.id.to_inner(), ENotAuthorized);

        if (guard.whitelist.contains(addr)) {
            guard.whitelist.remove(addr);
        }
    }

    // ============ View Functions ============

    /// Get current daily spending
    public fun get_daily_spent(guard: &SpendingGuard): u64 {
        guard.spent_today
    }

    /// Get daily limit
    public fun get_daily_limit(guard: &SpendingGuard): u64 {
        guard.daily_limit
    }

    /// Get remaining daily allowance
    public fun get_daily_remaining(guard: &SpendingGuard): u64 {
        if (guard.daily_limit > guard.spent_today) {
            guard.daily_limit - guard.spent_today
        } else {
            0
        }
    }

    /// Check if account is frozen
    public fun is_frozen(guard: &SpendingGuard): bool {
        guard.is_frozen
    }

    /// Check if address is whitelisted
    public fun is_whitelisted(guard: &SpendingGuard, addr: address): bool {
        guard.whitelist.contains(addr)
    }

    /// Get per-transaction limit
    public fun get_per_tx_limit(guard: &SpendingGuard): u64 {
        guard.per_tx_limit
    }
}
