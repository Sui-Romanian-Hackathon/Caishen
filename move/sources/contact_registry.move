/// ContactRegistry Module
///
/// On-chain contact registry for human-readable name to address mappings.
/// Enables users to send to "@alice" instead of "0x..." addresses.
///
/// Features:
/// - Personal contact books (per-user namespace)
/// - Global public registry (optional)
/// - Reverse lookups (address to name)
/// - Contact verification and trust scoring
///
/// Use Cases:
/// - "Send 5 SUI to alice" resolves alice from contacts
/// - Shared team contact directories
/// - Cross-wallet portable address books
///
/// @author AI Copilot Wallet Team
/// @version 0.1.0
#[allow(lint(public_entry))]
module ai_copilot::contact_registry {
    use sui::event;
    use sui::table::{Self, Table};
    use sui::table_with_length::{Self as table_with_length, TableWithLength};
    use std::string::{Self, String};

    // ============ Errors ============

    /// Contact name already exists
    const EContactExists: u64 = 0;
    /// Contact not found
    const EContactNotFound: u64 = 1;
    /// Invalid name (empty or too long)
    const EInvalidName: u64 = 2;
    /// Not authorized to modify
    const ENotAuthorized: u64 = 3;

    // ============ Constants ============

    /// Maximum contact name length
    const MAX_NAME_LENGTH: u64 = 32;

    // ============ Objects ============

    /// Personal contact book owned by a user
    public struct ContactBook has key, store {
        id: UID,
        /// Owner of this contact book
        owner: address,
        /// Name to address mapping
        contacts: TableWithLength<String, ContactEntry>,
        /// Address to name reverse lookup
        reverse_lookup: Table<address, String>,
    }

    /// Individual contact entry
    public struct ContactEntry has store, copy, drop {
        /// Wallet address
        address: address,
        /// Display name
        name: String,
        /// Optional notes/description
        notes: String,
        /// When contact was added (epoch)
        created_at: u64,
        /// Number of successful transfers to this contact
        transfer_count: u64,
        /// Whether this contact is verified
        is_verified: bool,
    }

    /// Global public registry (shared object)
    public struct GlobalRegistry has key {
        id: UID,
        /// Public name to address mapping
        names: Table<String, address>,
        /// Address to public name
        reverse: Table<address, String>,
        /// Registration count
        total_registrations: u64,
    }

    // ============ Events ============

    /// Emitted when a contact is added
    public struct ContactAdded has copy, drop {
        owner: address,
        name: vector<u8>,
        contact_address: address,
    }

    /// Emitted when a contact is removed
    public struct ContactRemoved has copy, drop {
        owner: address,
        name: vector<u8>,
        contact_address: address,
    }

    /// Emitted when a contact is updated
    public struct ContactUpdated has copy, drop {
        owner: address,
        name: vector<u8>,
        old_address: address,
        new_address: address,
    }

    /// Emitted when public name is registered
    public struct PublicNameRegistered has copy, drop {
        name: vector<u8>,
        address: address,
    }

    // ============ Init ============

    /// Initialize the global registry (called once on publish)
    fun init(ctx: &mut TxContext) {
        let registry = GlobalRegistry {
            id: object::new(ctx),
            names: table::new(ctx),
            reverse: table::new(ctx),
            total_registrations: 0,
        };
        transfer::share_object(registry);
    }

    #[test_only]
    /// Test-only function to initialize the global registry
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }

    // ============ Contact Book Functions ============

    /// Create a new personal contact book
    public entry fun create_contact_book(ctx: &mut TxContext) {
        let book = ContactBook {
            id: object::new(ctx),
            owner: ctx.sender(),
            contacts: table_with_length::new(ctx),
            reverse_lookup: table::new(ctx),
        };
        transfer::transfer(book, ctx.sender());
    }

    /// Add a contact to personal book
    public entry fun add_contact(
        book: &mut ContactBook,
        name: vector<u8>,
        contact_address: address,
        notes: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert!(book.owner == ctx.sender(), ENotAuthorized);

        let name_str = string::utf8(name);
        let name_len = name_str.length();

        assert!(name_len > 0 && name_len <= MAX_NAME_LENGTH, EInvalidName);
        assert!(!table_with_length::contains(&book.contacts, name_str), EContactExists);

        let entry = ContactEntry {
            address: contact_address,
            name: name_str,
            notes: string::utf8(notes),
            created_at: ctx.epoch(),
            transfer_count: 0,
            is_verified: false,
        };

        table_with_length::add(&mut book.contacts, name_str, entry);
        book.reverse_lookup.add(contact_address, name_str);

        event::emit(ContactAdded {
            owner: ctx.sender(),
            name,
            contact_address,
        });
    }

    /// Remove a contact from personal book
    public entry fun remove_contact(
        book: &mut ContactBook,
        name: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert!(book.owner == ctx.sender(), ENotAuthorized);

        let name_str = string::utf8(name);
        assert!(table_with_length::contains(&book.contacts, name_str), EContactNotFound);

        let entry = table_with_length::remove(&mut book.contacts, name_str);
        book.reverse_lookup.remove(entry.address);

        event::emit(ContactRemoved {
            owner: ctx.sender(),
            name,
            contact_address: entry.address,
        });
    }

    /// Update a contact's address
    public entry fun update_contact(
        book: &mut ContactBook,
        name: vector<u8>,
        new_address: address,
        ctx: &mut TxContext
    ) {
        assert!(book.owner == ctx.sender(), ENotAuthorized);

        let name_str = string::utf8(name);
        assert!(table_with_length::contains(&book.contacts, name_str), EContactNotFound);

        let entry = table_with_length::borrow_mut(&mut book.contacts, name_str);
        let old_address = entry.address;

        // Update reverse lookup
        book.reverse_lookup.remove(old_address);
        book.reverse_lookup.add(new_address, name_str);

        entry.address = new_address;

        event::emit(ContactUpdated {
            owner: ctx.sender(),
            name,
            old_address,
            new_address,
        });
    }

    /// Increment transfer count for a contact (called after successful transfer)
    /// Only the owner can update transfer counts
    public fun increment_transfer_count(
        book: &mut ContactBook,
        name: String,
        ctx: &TxContext
    ) {
        assert!(book.owner == ctx.sender(), ENotAuthorized);
        if (table_with_length::contains(&book.contacts, name)) {
            let entry = table_with_length::borrow_mut(&mut book.contacts, name);
            entry.transfer_count = entry.transfer_count + 1;
        }
    }

    // ============ View Functions ============

    /// Resolve a name to an address from personal book
    public fun resolve_contact(book: &ContactBook, name: String): address {
        assert!(table_with_length::contains(&book.contacts, name), EContactNotFound);
        table_with_length::borrow(&book.contacts, name).address
    }

    /// Get contact entry details
    public fun get_contact(book: &ContactBook, name: String): &ContactEntry {
        assert!(table_with_length::contains(&book.contacts, name), EContactNotFound);
        table_with_length::borrow(&book.contacts, name)
    }

    /// Check if contact exists
    public fun contact_exists(book: &ContactBook, name: String): bool {
        table_with_length::contains(&book.contacts, name)
    }

    /// Reverse lookup: get name from address
    public fun get_name_by_address(book: &ContactBook, addr: address): String {
        assert!(book.reverse_lookup.contains(addr), EContactNotFound);
        *book.reverse_lookup.borrow(addr)
    }

    /// Get total contacts count
    public fun get_contact_count(book: &ContactBook): u64 {
        table_with_length::length(&book.contacts)
    }

    // ============ Global Registry Functions ============

    /// Register a public name (first-come-first-served)
    public entry fun register_public_name(
        registry: &mut GlobalRegistry,
        name: vector<u8>,
        ctx: &mut TxContext
    ) {
        let name_str = string::utf8(name);
        let name_len = name_str.length();

        assert!(name_len > 0 && name_len <= MAX_NAME_LENGTH, EInvalidName);
        assert!(!registry.names.contains(name_str), EContactExists);

        let sender = ctx.sender();

        registry.names.add(name_str, sender);
        registry.reverse.add(sender, name_str);
        registry.total_registrations = registry.total_registrations + 1;

        event::emit(PublicNameRegistered {
            name,
            address: sender,
        });
    }

    /// Resolve a public name to address
    public fun resolve_public_name(registry: &GlobalRegistry, name: String): address {
        assert!(registry.names.contains(name), EContactNotFound);
        *registry.names.borrow(name)
    }

    /// Check if public name is available
    public fun is_name_available(registry: &GlobalRegistry, name: String): bool {
        !registry.names.contains(name)
    }

    /// Get public name for an address
    public fun get_public_name(registry: &GlobalRegistry, addr: address): String {
        assert!(registry.reverse.contains(addr), EContactNotFound);
        *registry.reverse.borrow(addr)
    }
}
