/// Unit tests for BatchTransfer module
#[test_only]
module ai_copilot::batch_transfer_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use ai_copilot::batch_transfer;

    // Test addresses
    const SENDER: address = @0xA;
    const RECIPIENT1: address = @0xB;
    const RECIPIENT2: address = @0xC;
    const RECIPIENT3: address = @0xD;

    // ============ Helper Functions ============

    fun mint_sui(amount: u64, scenario: &mut Scenario): Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, ts::ctx(scenario))
    }

    // ============ batch_send_sui Tests ============

    #[test]
    fun test_batch_send_sui_single_recipient() {
        let mut scenario = ts::begin(SENDER);

        // Mint 100 SUI
        let coin = mint_sui(100_000_000_000, &mut scenario); // 100 SUI in MIST

        let recipients = vector[RECIPIENT1];
        let amounts = vector[50_000_000_000]; // 50 SUI

        batch_transfer::batch_send_sui(coin, recipients, amounts, ts::ctx(&mut scenario));

        // Check recipient received funds
        ts::next_tx(&mut scenario, RECIPIENT1);
        {
            let received = ts::take_from_address<Coin<SUI>>(&scenario, RECIPIENT1);
            assert!(coin::value(&received) == 50_000_000_000, 0);
            ts::return_to_address(RECIPIENT1, received);
        };

        // Check sender received remainder
        ts::next_tx(&mut scenario, SENDER);
        {
            let remainder = ts::take_from_address<Coin<SUI>>(&scenario, SENDER);
            assert!(coin::value(&remainder) == 50_000_000_000, 1);
            ts::return_to_address(SENDER, remainder);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_batch_send_sui_multiple_recipients() {
        let mut scenario = ts::begin(SENDER);

        let coin = mint_sui(100_000_000_000, &mut scenario);

        let recipients = vector[RECIPIENT1, RECIPIENT2, RECIPIENT3];
        let amounts = vector[20_000_000_000, 30_000_000_000, 40_000_000_000];

        batch_transfer::batch_send_sui(coin, recipients, amounts, ts::ctx(&mut scenario));

        // Verify each recipient
        ts::next_tx(&mut scenario, RECIPIENT1);
        {
            let received = ts::take_from_address<Coin<SUI>>(&scenario, RECIPIENT1);
            assert!(coin::value(&received) == 20_000_000_000, 0);
            ts::return_to_address(RECIPIENT1, received);
        };

        ts::next_tx(&mut scenario, RECIPIENT2);
        {
            let received = ts::take_from_address<Coin<SUI>>(&scenario, RECIPIENT2);
            assert!(coin::value(&received) == 30_000_000_000, 1);
            ts::return_to_address(RECIPIENT2, received);
        };

        ts::next_tx(&mut scenario, RECIPIENT3);
        {
            let received = ts::take_from_address<Coin<SUI>>(&scenario, RECIPIENT3);
            assert!(coin::value(&received) == 40_000_000_000, 2);
            ts::return_to_address(RECIPIENT3, received);
        };

        // Sender gets 10 SUI remainder
        ts::next_tx(&mut scenario, SENDER);
        {
            let remainder = ts::take_from_address<Coin<SUI>>(&scenario, SENDER);
            assert!(coin::value(&remainder) == 10_000_000_000, 3);
            ts::return_to_address(SENDER, remainder);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_batch_send_sui_exact_amount() {
        let mut scenario = ts::begin(SENDER);

        let coin = mint_sui(100_000_000_000, &mut scenario);

        let recipients = vector[RECIPIENT1, RECIPIENT2];
        let amounts = vector[50_000_000_000, 50_000_000_000];

        batch_transfer::batch_send_sui(coin, recipients, amounts, ts::ctx(&mut scenario));

        // No remainder should be sent back (coin destroyed)
        ts::next_tx(&mut scenario, RECIPIENT1);
        {
            let received = ts::take_from_address<Coin<SUI>>(&scenario, RECIPIENT1);
            assert!(coin::value(&received) == 50_000_000_000, 0);
            ts::return_to_address(RECIPIENT1, received);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = batch_transfer::ELengthMismatch)]
    fun test_batch_send_sui_length_mismatch() {
        let mut scenario = ts::begin(SENDER);

        let coin = mint_sui(100_000_000_000, &mut scenario);

        let recipients = vector[RECIPIENT1, RECIPIENT2];
        let amounts = vector[50_000_000_000]; // Only 1 amount for 2 recipients

        batch_transfer::batch_send_sui(coin, recipients, amounts, ts::ctx(&mut scenario));

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = batch_transfer::EEmptyRecipients)]
    fun test_batch_send_sui_empty_recipients() {
        let mut scenario = ts::begin(SENDER);

        let coin = mint_sui(100_000_000_000, &mut scenario);

        let recipients = vector::empty<address>();
        let amounts = vector::empty<u64>();

        batch_transfer::batch_send_sui(coin, recipients, amounts, ts::ctx(&mut scenario));

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = batch_transfer::EInsufficientBalance)]
    fun test_batch_send_sui_insufficient_balance() {
        let mut scenario = ts::begin(SENDER);

        let coin = mint_sui(50_000_000_000, &mut scenario); // Only 50 SUI

        let recipients = vector[RECIPIENT1, RECIPIENT2];
        let amounts = vector[40_000_000_000, 40_000_000_000]; // Need 80 SUI

        batch_transfer::batch_send_sui(coin, recipients, amounts, ts::ctx(&mut scenario));

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = batch_transfer::ERecipientLimitExceeded)]
    fun test_batch_send_sui_too_many_recipients() {
        let mut scenario = ts::begin(SENDER);

        let coin = mint_sui(1_000_000_000_000, &mut scenario);

        // Create 101 recipients (exceeds MAX_RECIPIENTS of 100)
        let mut recipients = vector::empty<address>();
        let mut amounts = vector::empty<u64>();
        let mut i: u64 = 0;
        while (i < 101) {
            vector::push_back(&mut recipients, @0x100);
            vector::push_back(&mut amounts, 1_000_000_000);
            i = i + 1;
        };

        batch_transfer::batch_send_sui(coin, recipients, amounts, ts::ctx(&mut scenario));

        ts::end(scenario);
    }

    // ============ split_equal_sui Tests ============

    #[test]
    fun test_split_equal_sui() {
        let mut scenario = ts::begin(SENDER);

        let coin = mint_sui(90_000_000_000, &mut scenario); // 90 SUI

        let recipients = vector[RECIPIENT1, RECIPIENT2, RECIPIENT3];

        batch_transfer::split_equal_sui(coin, recipients, ts::ctx(&mut scenario));

        // Each should get 30 SUI
        ts::next_tx(&mut scenario, RECIPIENT1);
        {
            let received = ts::take_from_address<Coin<SUI>>(&scenario, RECIPIENT1);
            assert!(coin::value(&received) == 30_000_000_000, 0);
            ts::return_to_address(RECIPIENT1, received);
        };

        ts::next_tx(&mut scenario, RECIPIENT2);
        {
            let received = ts::take_from_address<Coin<SUI>>(&scenario, RECIPIENT2);
            assert!(coin::value(&received) == 30_000_000_000, 1);
            ts::return_to_address(RECIPIENT2, received);
        };

        ts::next_tx(&mut scenario, RECIPIENT3);
        {
            let received = ts::take_from_address<Coin<SUI>>(&scenario, RECIPIENT3);
            assert!(coin::value(&received) == 30_000_000_000, 2);
            ts::return_to_address(RECIPIENT3, received);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_split_equal_sui_with_remainder() {
        let mut scenario = ts::begin(SENDER);

        let coin = mint_sui(100_000_000_000, &mut scenario); // 100 SUI

        let recipients = vector[RECIPIENT1, RECIPIENT2, RECIPIENT3]; // 3 recipients
        // 100 / 3 = 33.33... so each gets 33, sender gets 1 remainder

        batch_transfer::split_equal_sui(coin, recipients, ts::ctx(&mut scenario));

        // Sender should get remainder (100 - 33*3 = 1)
        ts::next_tx(&mut scenario, SENDER);
        {
            let remainder = ts::take_from_address<Coin<SUI>>(&scenario, SENDER);
            assert!(coin::value(&remainder) == 100_000_000_000 - (33_333_333_333 * 3), 0);
            ts::return_to_address(SENDER, remainder);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = batch_transfer::EEmptyRecipients)]
    fun test_split_equal_sui_empty_recipients() {
        let mut scenario = ts::begin(SENDER);

        let coin = mint_sui(100_000_000_000, &mut scenario);
        let recipients = vector::empty<address>();

        batch_transfer::split_equal_sui(coin, recipients, ts::ctx(&mut scenario));

        ts::end(scenario);
    }
}
