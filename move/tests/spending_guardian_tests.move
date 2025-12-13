/// Unit tests for SpendingGuardian module
#[test_only]
module ai_copilot::spending_guardian_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use ai_copilot::spending_guardian::{Self, SpendingGuard, GuardianCap};

    // Test addresses
    const OWNER: address = @0xA;
    const RECIPIENT: address = @0xB;
    const WHITELISTED: address = @0xC;
    const OTHER_USER: address = @0xD;

    // Test amounts (in MIST)
    const ONE_SUI: u64 = 1_000_000_000;
    const TEN_SUI: u64 = 10_000_000_000;
    const FIFTY_SUI: u64 = 50_000_000_000;
    const HUNDRED_SUI: u64 = 100_000_000_000;
    const FIVE_SUI: u64 = 5_000_000_000;

    // Time constants
    const ONE_HOUR_MS: u64 = 3_600_000;
    const ONE_DAY_MS: u64 = 86_400_000;

    // ============ Helper Functions ============

    fun mint_sui(amount: u64, scenario: &mut Scenario): Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, ts::ctx(scenario))
    }

    fun create_clock(scenario: &mut Scenario): Clock {
        clock::create_for_testing(ts::ctx(scenario))
    }

    fun setup_guard(scenario: &mut Scenario, clock: &Clock, per_tx_limit: u64, daily_limit: u64) {
        ts::next_tx(scenario, OWNER);
        spending_guardian::create_guard(per_tx_limit, daily_limit, clock, ts::ctx(scenario));
    }

    // ============ Guard Creation Tests ============

    #[test]
    fun test_create_guard() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        spending_guardian::create_guard(TEN_SUI, HUNDRED_SUI, &clock, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, OWNER);
        {
            let guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let cap = ts::take_from_sender<GuardianCap>(&scenario);

            assert!(spending_guardian::get_per_tx_limit(&guard) == TEN_SUI, 0);
            assert!(spending_guardian::get_daily_limit(&guard) == HUNDRED_SUI, 1);
            assert!(spending_guardian::get_daily_spent(&guard) == 0, 2);
            assert!(!spending_guardian::is_frozen(&guard), 3);

            ts::return_to_sender(&scenario, guard);
            ts::return_to_sender(&scenario, cap);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_create_guard_unlimited() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        // 0 means unlimited
        spending_guardian::create_guard(0, 0, &clock, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, OWNER);
        {
            let guard = ts::take_from_sender<SpendingGuard>(&scenario);
            assert!(spending_guardian::get_per_tx_limit(&guard) == 0, 0);
            assert!(spending_guardian::get_daily_limit(&guard) == 0, 1);
            ts::return_to_sender(&scenario, guard);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============ Guarded Transfer Tests ============

    #[test]
    fun test_guarded_send_within_limits() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, TEN_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(FIFTY_SUI, &mut scenario);

            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                FIVE_SUI,
                &clock,
                ts::ctx(&mut scenario)
            );

            assert!(spending_guardian::get_daily_spent(&guard) == FIVE_SUI, 0);

            ts::return_to_sender(&scenario, guard);
        };

        // Verify recipient received funds
        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let received = ts::take_from_address<Coin<SUI>>(&scenario, RECIPIENT);
            assert!(coin::value(&received) == FIVE_SUI, 1);
            ts::return_to_address(RECIPIENT, received);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = spending_guardian::ETransactionLimitExceeded)]
    fun test_guarded_send_exceeds_per_tx_limit() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, TEN_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(FIFTY_SUI, &mut scenario);

            // Try to send 20 SUI with 10 SUI per-tx limit
            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                20_000_000_000, // 20 SUI
                &clock,
                ts::ctx(&mut scenario)
            );

            ts::return_to_sender(&scenario, guard);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = spending_guardian::EDailyLimitExceeded)]
    fun test_guarded_send_exceeds_daily_limit() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        // Per-tx: 50 SUI, Daily: 30 SUI
        setup_guard(&mut scenario, &clock, FIFTY_SUI, 30_000_000_000);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(HUNDRED_SUI, &mut scenario);

            // First transfer: 20 SUI (within limits)
            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                20_000_000_000,
                &clock,
                ts::ctx(&mut scenario)
            );

            ts::return_to_sender(&scenario, guard);
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(FIFTY_SUI, &mut scenario);

            // Second transfer: 20 SUI (would exceed 30 SUI daily limit)
            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                20_000_000_000,
                &clock,
                ts::ctx(&mut scenario)
            );

            ts::return_to_sender(&scenario, guard);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_daily_limit_resets_after_24h() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, FIFTY_SUI, 30_000_000_000);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(HUNDRED_SUI, &mut scenario);

            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                25_000_000_000, // 25 SUI
                &clock,
                ts::ctx(&mut scenario)
            );

            assert!(spending_guardian::get_daily_spent(&guard) == 25_000_000_000, 0);

            ts::return_to_sender(&scenario, guard);
        };

        // Advance clock by 1 day
        clock::increment_for_testing(&mut clock, ONE_DAY_MS);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(FIFTY_SUI, &mut scenario);

            // Should succeed because daily counter resets
            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                25_000_000_000,
                &clock,
                ts::ctx(&mut scenario)
            );

            // Daily spent should be reset to just this transfer
            assert!(spending_guardian::get_daily_spent(&guard) == 25_000_000_000, 1);

            ts::return_to_sender(&scenario, guard);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============ Freeze Tests ============

    #[test]
    #[expected_failure(abort_code = spending_guardian::EAccountFrozen)]
    fun test_frozen_account_cannot_send() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, TEN_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let cap = ts::take_from_sender<GuardianCap>(&scenario);

            spending_guardian::freeze_account(&mut guard, &cap, ts::ctx(&mut scenario));
            assert!(spending_guardian::is_frozen(&guard), 0);

            ts::return_to_sender(&scenario, guard);
            ts::return_to_sender(&scenario, cap);
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(TEN_SUI, &mut scenario);

            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                ONE_SUI,
                &clock,
                ts::ctx(&mut scenario)
            );

            ts::return_to_sender(&scenario, guard);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_unfreeze_account() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, TEN_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let cap = ts::take_from_sender<GuardianCap>(&scenario);

            spending_guardian::freeze_account(&mut guard, &cap, ts::ctx(&mut scenario));
            assert!(spending_guardian::is_frozen(&guard), 0);

            spending_guardian::unfreeze_account(&mut guard, &cap, ts::ctx(&mut scenario));
            assert!(!spending_guardian::is_frozen(&guard), 1);

            ts::return_to_sender(&scenario, guard);
            ts::return_to_sender(&scenario, cap);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============ Whitelist Tests ============

    #[test]
    fun test_whitelist_bypasses_limits() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        // Very restrictive limits
        setup_guard(&mut scenario, &clock, ONE_SUI, ONE_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let cap = ts::take_from_sender<GuardianCap>(&scenario);

            // Add WHITELISTED to whitelist
            spending_guardian::add_to_whitelist(&mut guard, &cap, WHITELISTED, ts::ctx(&mut scenario));
            assert!(spending_guardian::is_whitelisted(&guard, WHITELISTED), 0);

            ts::return_to_sender(&scenario, guard);
            ts::return_to_sender(&scenario, cap);
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(HUNDRED_SUI, &mut scenario);

            // Should succeed despite exceeding limits because recipient is whitelisted
            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                WHITELISTED,
                FIFTY_SUI, // Way over 1 SUI limit
                &clock,
                ts::ctx(&mut scenario)
            );

            ts::return_to_sender(&scenario, guard);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_remove_from_whitelist() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, TEN_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let cap = ts::take_from_sender<GuardianCap>(&scenario);

            spending_guardian::add_to_whitelist(&mut guard, &cap, WHITELISTED, ts::ctx(&mut scenario));
            assert!(spending_guardian::is_whitelisted(&guard, WHITELISTED), 0);

            spending_guardian::remove_from_whitelist(&mut guard, &cap, WHITELISTED, ts::ctx(&mut scenario));
            assert!(!spending_guardian::is_whitelisted(&guard, WHITELISTED), 1);

            ts::return_to_sender(&scenario, guard);
            ts::return_to_sender(&scenario, cap);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============ Update Limits Tests ============

    #[test]
    fun test_update_limits() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, TEN_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let cap = ts::take_from_sender<GuardianCap>(&scenario);

            assert!(spending_guardian::get_per_tx_limit(&guard) == TEN_SUI, 0);
            assert!(spending_guardian::get_daily_limit(&guard) == HUNDRED_SUI, 1);

            spending_guardian::update_limits(&mut guard, &cap, FIFTY_SUI, 200_000_000_000, ts::ctx(&mut scenario));

            assert!(spending_guardian::get_per_tx_limit(&guard) == FIFTY_SUI, 2);
            assert!(spending_guardian::get_daily_limit(&guard) == 200_000_000_000, 3);

            ts::return_to_sender(&scenario, guard);
            ts::return_to_sender(&scenario, cap);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = spending_guardian::ENotAuthorized)]
    fun test_update_limits_not_owner() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, TEN_SUI, HUNDRED_SUI);

        // OTHER_USER tries to update limits
        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let mut guard = ts::take_from_address<SpendingGuard>(&scenario, OWNER);
            let cap = ts::take_from_address<GuardianCap>(&scenario, OWNER);

            spending_guardian::update_limits(&mut guard, &cap, FIFTY_SUI, 200_000_000_000, ts::ctx(&mut scenario));

            ts::return_to_address(OWNER, guard);
            ts::return_to_address(OWNER, cap);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============ Cooldown Tests ============

    #[test]
    fun test_set_cooldown() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, TEN_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let cap = ts::take_from_sender<GuardianCap>(&scenario);

            // Set 1 hour cooldown for transfers over 5 SUI
            spending_guardian::set_cooldown(&mut guard, &cap, ONE_HOUR_MS, FIVE_SUI, ts::ctx(&mut scenario));

            ts::return_to_sender(&scenario, guard);
            ts::return_to_sender(&scenario, cap);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = spending_guardian::ECooldownActive)]
    fun test_cooldown_blocks_transfer() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, FIFTY_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let cap = ts::take_from_sender<GuardianCap>(&scenario);

            // Set 1 hour cooldown for transfers over 5 SUI
            spending_guardian::set_cooldown(&mut guard, &cap, ONE_HOUR_MS, FIVE_SUI, ts::ctx(&mut scenario));

            ts::return_to_sender(&scenario, guard);
            ts::return_to_sender(&scenario, cap);
        };

        // First large transfer
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(HUNDRED_SUI, &mut scenario);

            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                TEN_SUI, // Over threshold
                &clock,
                ts::ctx(&mut scenario)
            );

            ts::return_to_sender(&scenario, guard);
        };

        // Second transfer immediately (should fail - cooldown active)
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(FIFTY_SUI, &mut scenario);

            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                ONE_SUI,
                &clock,
                ts::ctx(&mut scenario)
            );

            ts::return_to_sender(&scenario, guard);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun test_cooldown_expires() {
        let mut scenario = ts::begin(OWNER);
        let mut clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, FIFTY_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let cap = ts::take_from_sender<GuardianCap>(&scenario);

            spending_guardian::set_cooldown(&mut guard, &cap, ONE_HOUR_MS, FIVE_SUI, ts::ctx(&mut scenario));

            ts::return_to_sender(&scenario, guard);
            ts::return_to_sender(&scenario, cap);
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(HUNDRED_SUI, &mut scenario);

            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                TEN_SUI,
                &clock,
                ts::ctx(&mut scenario)
            );

            ts::return_to_sender(&scenario, guard);
        };

        // Advance clock past cooldown period
        clock::increment_for_testing(&mut clock, ONE_HOUR_MS + 1);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);
            let coin = mint_sui(FIFTY_SUI, &mut scenario);

            // Should succeed now
            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                ONE_SUI,
                &clock,
                ts::ctx(&mut scenario)
            );

            ts::return_to_sender(&scenario, guard);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============ View Function Tests ============

    #[test]
    fun test_get_daily_remaining() {
        let mut scenario = ts::begin(OWNER);
        let clock = create_clock(&mut scenario);

        setup_guard(&mut scenario, &clock, TEN_SUI, HUNDRED_SUI);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut guard = ts::take_from_sender<SpendingGuard>(&scenario);

            assert!(spending_guardian::get_daily_remaining(&guard) == HUNDRED_SUI, 0);

            let coin = mint_sui(FIFTY_SUI, &mut scenario);
            spending_guardian::guarded_send_sui(
                &mut guard,
                coin,
                RECIPIENT,
                TEN_SUI,
                &clock,
                ts::ctx(&mut scenario)
            );

            assert!(spending_guardian::get_daily_remaining(&guard) == HUNDRED_SUI - TEN_SUI, 1);

            ts::return_to_sender(&scenario, guard);
        };

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
