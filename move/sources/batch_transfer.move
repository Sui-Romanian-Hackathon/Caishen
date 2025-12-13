/// BatchTransfer Module
///
/// Enables atomic multi-recipient SUI and token transfers in a single transaction.
/// This reduces gas costs and ensures all-or-nothing execution for batch payments.
///
/// Use Cases:
/// - Payroll: "Pay 10 employees in one transaction"
/// - Airdrops: "Send tokens to multiple addresses"
/// - Splitting: "Split this payment among 3 people"
///
/// @author AI Copilot Wallet Team
/// @version 0.1.0
#[allow(lint(public_entry))]
module ai_copilot::batch_transfer {
    use sui::coin::Coin;
    use sui::sui::SUI;
    use sui::event;
    use sui::tx_context;

    // ============ Errors ============

    /// Mismatched recipients and amounts arrays
    const ELengthMismatch: u64 = 0;
    /// Empty recipients list
    const EEmptyRecipients: u64 = 1;
    /// Insufficient balance for transfers
    const EInsufficientBalance: u64 = 2;
    /// Too many recipients (max 100)
    const ERecipientLimitExceeded: u64 = 3;

    // ============ Constants ============

    /// Maximum recipients per batch (gas limit protection)
    const MAX_RECIPIENTS: u64 = 100;

    // ============ Events ============

    /// Emitted when a batch transfer is executed
    public struct BatchTransferEvent has copy, drop {
        sender: address,
        recipient_count: u64,
        total_amount: u64,
        coin_type: vector<u8>,
    }

    /// Emitted for each individual transfer in a batch
    public struct TransferRecord has copy, drop {
        sender: address,
        recipient: address,
        amount: u64,
        /// Unique batch identifier (fresh object address per batch)
        batch_id: address,
    }

    // ============ Entry Functions ============

    /// Execute a batch transfer of SUI to multiple recipients
    ///
    /// @param coin - The SUI coin to split and distribute
    /// @param recipients - Vector of recipient addresses
    /// @param amounts - Vector of amounts (in MIST) for each recipient
    /// @param ctx - Transaction context
    public entry fun batch_send_sui(
        mut coin: Coin<SUI>,
        recipients: vector<address>,
        amounts: vector<u64>,
        ctx: &mut TxContext
    ) {
        let recipient_count = recipients.length();
        let amounts_count = amounts.length();

        // Validate inputs
        assert!(recipient_count == amounts_count, ELengthMismatch);
        assert!(recipient_count > 0, EEmptyRecipients);
        assert!(recipient_count <= MAX_RECIPIENTS, ERecipientLimitExceeded);

        // Calculate total and validate balance
        let mut total_amount: u64 = 0;
        let mut i: u64 = 0;
        while (i < amounts_count) {
            total_amount = total_amount + amounts[i];
            i = i + 1;
        };
        assert!(coin.value() >= total_amount, EInsufficientBalance);

        let sender = ctx.sender();
        // Generate a unique batch id per call using a fresh object address
        let batch_id = tx_context::fresh_object_address(ctx);

        // Execute transfers
        let mut j: u64 = 0;
        while (j < recipient_count) {
            let recipient = recipients[j];
            let amount = amounts[j];

            // Split and transfer
            let payment = coin.split(amount, ctx);
            transfer::public_transfer(payment, recipient);

            // Emit individual transfer record
            event::emit(TransferRecord {
                sender,
                recipient,
                amount,
                batch_id,
            });

            j = j + 1;
        };

        // Return remaining balance to sender
        if (coin.value() > 0) {
            transfer::public_transfer(coin, sender);
        } else {
            coin.destroy_zero();
        };

        // Emit batch event
        event::emit(BatchTransferEvent {
            sender,
            recipient_count,
            total_amount,
            coin_type: b"SUI",
        });
    }

    /// Execute a batch transfer of any coin type to multiple recipients
    ///
    /// @param coin - The coin to split and distribute
    /// @param recipients - Vector of recipient addresses
    /// @param amounts - Vector of amounts for each recipient
    /// @param ctx - Transaction context
    public entry fun batch_send_coin<T>(
        mut coin: Coin<T>,
        recipients: vector<address>,
        amounts: vector<u64>,
        ctx: &mut TxContext
    ) {
        let recipient_count = recipients.length();
        let amounts_count = amounts.length();

        // Validate inputs
        assert!(recipient_count == amounts_count, ELengthMismatch);
        assert!(recipient_count > 0, EEmptyRecipients);
        assert!(recipient_count <= MAX_RECIPIENTS, ERecipientLimitExceeded);

        // Calculate total and validate balance
        let mut total_amount: u64 = 0;
        let mut i: u64 = 0;
        while (i < amounts_count) {
            total_amount = total_amount + amounts[i];
            i = i + 1;
        };
        assert!(coin.value() >= total_amount, EInsufficientBalance);

        let sender = ctx.sender();
        // Generate a unique batch id per call using a fresh object address
        let batch_id = tx_context::fresh_object_address(ctx);

        // Execute transfers
        let mut j: u64 = 0;
        while (j < recipient_count) {
            let recipient = recipients[j];
            let amount = amounts[j];

            // Split and transfer
            let payment = coin.split(amount, ctx);
            transfer::public_transfer(payment, recipient);

            // Emit individual transfer record
            event::emit(TransferRecord {
                sender,
                recipient,
                amount,
                batch_id,
            });

            j = j + 1;
        };

        // Return remaining balance to sender
        if (coin.value() > 0) {
            transfer::public_transfer(coin, sender);
        } else {
            coin.destroy_zero();
        };

        // Emit batch event
        event::emit(BatchTransferEvent {
            sender,
            recipient_count,
            total_amount,
            coin_type: b"COIN",
        });
    }

    /// Execute equal split of SUI among recipients
    ///
    /// @param coin - The SUI coin to split equally
    /// @param recipients - Vector of recipient addresses
    /// @param ctx - Transaction context
    public entry fun split_equal_sui(
        mut coin: Coin<SUI>,
        recipients: vector<address>,
        ctx: &mut TxContext
    ) {
        let recipient_count = recipients.length();

        assert!(recipient_count > 0, EEmptyRecipients);
        assert!(recipient_count <= MAX_RECIPIENTS, ERecipientLimitExceeded);

        let total = coin.value();
        let amount_per_recipient = total / recipient_count;

        assert!(amount_per_recipient > 0, EInsufficientBalance);

        let sender = ctx.sender();
        // Generate a unique batch id per call using a fresh object address
        let batch_id = tx_context::fresh_object_address(ctx);

        // Transfer equal amounts to all recipients
        let mut i: u64 = 0;
        while (i < recipient_count) {
            let recipient = recipients[i];
            let payment = coin.split(amount_per_recipient, ctx);
            transfer::public_transfer(payment, recipient);

            event::emit(TransferRecord {
                sender,
                recipient,
                amount: amount_per_recipient,
                batch_id,
            });

            i = i + 1;
        };

        // Return remainder to sender
        if (coin.value() > 0) {
            transfer::public_transfer(coin, sender);
        } else {
            coin.destroy_zero();
        };

        event::emit(BatchTransferEvent {
            sender,
            recipient_count,
            total_amount: amount_per_recipient * recipient_count,
            coin_type: b"SUI",
        });
    }
}
