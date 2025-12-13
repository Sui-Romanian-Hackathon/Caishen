/// Unit tests for ContactRegistry module
#[test_only]
module ai_copilot::contact_registry_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use std::string;
    use ai_copilot::contact_registry::{Self, ContactBook, GlobalRegistry};

    // Test addresses
    const OWNER: address = @0xA;
    const CONTACT1_ADDR: address = @0xB;
    const CONTACT2_ADDR: address = @0xC;
    const OTHER_USER: address = @0xD;

    // ============ Helper Functions ============

    fun setup_with_contact_book(scenario: &mut Scenario) {
        ts::next_tx(scenario, OWNER);
        contact_registry::create_contact_book(ts::ctx(scenario));
    }

    // ============ ContactBook Creation Tests ============

    #[test]
    fun test_create_contact_book() {
        let mut scenario = ts::begin(OWNER);

        contact_registry::create_contact_book(ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, OWNER);
        {
            let book = ts::take_from_sender<ContactBook>(&scenario);
            assert!(contact_registry::get_contact_count(&book) == 0, 0);
            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    // ============ Add Contact Tests ============

    #[test]
    fun test_add_contact() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::add_contact(
                &mut book,
                b"alice",
                CONTACT1_ADDR,
                b"My friend Alice",
                ts::ctx(&mut scenario)
            );

            assert!(contact_registry::get_contact_count(&book) == 1, 0);

            let name = string::utf8(b"alice");
            assert!(contact_registry::contact_exists(&book, name), 1);
            assert!(contact_registry::resolve_contact(&book, name) == CONTACT1_ADDR, 2);

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_add_multiple_contacts() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::add_contact(&mut book, b"alice", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));
            contact_registry::add_contact(&mut book, b"bob", CONTACT2_ADDR, b"", ts::ctx(&mut scenario));

            assert!(contact_registry::get_contact_count(&book) == 2, 0);

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = contact_registry::EContactExists)]
    fun test_add_duplicate_contact() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::add_contact(&mut book, b"alice", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));
            // Try to add same name again
            contact_registry::add_contact(&mut book, b"alice", CONTACT2_ADDR, b"", ts::ctx(&mut scenario));

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = contact_registry::ENotAuthorized)]
    fun test_add_contact_not_owner() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        // Try to add contact as different user
        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let mut book = ts::take_from_address<ContactBook>(&scenario, OWNER);

            contact_registry::add_contact(&mut book, b"alice", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));

            ts::return_to_address(OWNER, book);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = contact_registry::EInvalidName)]
    fun test_add_contact_empty_name() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::add_contact(&mut book, b"", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = contact_registry::EInvalidName)]
    fun test_add_contact_name_too_long() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            // 33 characters (exceeds MAX_NAME_LENGTH of 32)
            let long_name = b"123456789012345678901234567890123";
            contact_registry::add_contact(&mut book, long_name, CONTACT1_ADDR, b"", ts::ctx(&mut scenario));

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    // ============ Remove Contact Tests ============

    #[test]
    fun test_remove_contact() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::add_contact(&mut book, b"alice", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));
            assert!(contact_registry::get_contact_count(&book) == 1, 0);

            contact_registry::remove_contact(&mut book, b"alice", ts::ctx(&mut scenario));
            assert!(contact_registry::get_contact_count(&book) == 0, 1);

            let name = string::utf8(b"alice");
            assert!(!contact_registry::contact_exists(&book, name), 2);

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = contact_registry::EContactNotFound)]
    fun test_remove_nonexistent_contact() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::remove_contact(&mut book, b"nonexistent", ts::ctx(&mut scenario));

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = contact_registry::ENotAuthorized)]
    fun test_remove_contact_not_owner() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);
            contact_registry::add_contact(&mut book, b"alice", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));
            ts::return_to_sender(&scenario, book);
        };

        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let mut book = ts::take_from_address<ContactBook>(&scenario, OWNER);
            contact_registry::remove_contact(&mut book, b"alice", ts::ctx(&mut scenario));
            ts::return_to_address(OWNER, book);
        };

        ts::end(scenario);
    }

    // ============ Update Contact Tests ============

    #[test]
    fun test_update_contact() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::add_contact(&mut book, b"alice", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));

            let name = string::utf8(b"alice");
            assert!(contact_registry::resolve_contact(&book, name) == CONTACT1_ADDR, 0);

            // Update to new address
            contact_registry::update_contact(&mut book, b"alice", CONTACT2_ADDR, ts::ctx(&mut scenario));

            assert!(contact_registry::resolve_contact(&book, name) == CONTACT2_ADDR, 1);

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = contact_registry::EContactNotFound)]
    fun test_update_nonexistent_contact() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::update_contact(&mut book, b"nonexistent", CONTACT1_ADDR, ts::ctx(&mut scenario));

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    // ============ Reverse Lookup Tests ============

    #[test]
    fun test_reverse_lookup() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::add_contact(&mut book, b"alice", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));

            let resolved_name = contact_registry::get_name_by_address(&book, CONTACT1_ADDR);
            assert!(resolved_name == string::utf8(b"alice"), 0);

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    // ============ Increment Transfer Count Tests ============

    #[test]
    fun test_increment_transfer_count() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);

            contact_registry::add_contact(&mut book, b"alice", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));

            let name = string::utf8(b"alice");
            let _entry = contact_registry::get_contact(&book, name);
            // Initial transfer count should be 0 (accessing through entry would require store trait)

            contact_registry::increment_transfer_count(&mut book, name, ts::ctx(&mut scenario));

            ts::return_to_sender(&scenario, book);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = contact_registry::ENotAuthorized)]
    fun test_increment_transfer_count_not_owner() {
        let mut scenario = ts::begin(OWNER);
        setup_with_contact_book(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut book = ts::take_from_sender<ContactBook>(&scenario);
            contact_registry::add_contact(&mut book, b"alice", CONTACT1_ADDR, b"", ts::ctx(&mut scenario));
            ts::return_to_sender(&scenario, book);
        };

        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let mut book = ts::take_from_address<ContactBook>(&scenario, OWNER);
            let name = string::utf8(b"alice");
            contact_registry::increment_transfer_count(&mut book, name, ts::ctx(&mut scenario));
            ts::return_to_address(OWNER, book);
        };

        ts::end(scenario);
    }

    // ============ Global Registry Tests ============

    fun setup_global_registry(scenario: &mut Scenario) {
        ts::next_tx(scenario, OWNER);
        contact_registry::init_for_testing(ts::ctx(scenario));
    }

    #[test]
    fun test_register_public_name() {
        let mut scenario = ts::begin(OWNER);

        // Initialize the GlobalRegistry first
        setup_global_registry(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut registry = ts::take_shared<GlobalRegistry>(&scenario);

            contact_registry::register_public_name(&mut registry, b"alice", ts::ctx(&mut scenario));

            let name = string::utf8(b"alice");
            assert!(!contact_registry::is_name_available(&registry, name), 0);
            assert!(contact_registry::resolve_public_name(&registry, name) == OWNER, 1);

            ts::return_shared(registry);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = contact_registry::EContactExists)]
    fun test_register_duplicate_public_name() {
        let mut scenario = ts::begin(OWNER);

        // Initialize the GlobalRegistry first
        setup_global_registry(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut registry = ts::take_shared<GlobalRegistry>(&scenario);
            contact_registry::register_public_name(&mut registry, b"alice", ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        ts::next_tx(&mut scenario, OTHER_USER);
        {
            let mut registry = ts::take_shared<GlobalRegistry>(&scenario);
            // Try to register same name as different user
            contact_registry::register_public_name(&mut registry, b"alice", ts::ctx(&mut scenario));
            ts::return_shared(registry);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_is_name_available() {
        let mut scenario = ts::begin(OWNER);

        // Initialize the GlobalRegistry first
        setup_global_registry(&mut scenario);

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut registry = ts::take_shared<GlobalRegistry>(&scenario);

            let name = string::utf8(b"newname");
            assert!(contact_registry::is_name_available(&registry, name), 0);

            contact_registry::register_public_name(&mut registry, b"newname", ts::ctx(&mut scenario));

            assert!(!contact_registry::is_name_available(&registry, name), 1);

            ts::return_shared(registry);
        };

        ts::end(scenario);
    }
}
