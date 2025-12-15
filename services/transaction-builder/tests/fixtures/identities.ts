/**
 * Test Identities and User Data Fixtures
 * 
 * Mock user data for testing zkLogin flows including:
 * - Telegram user identities
 * - Google OAuth subjects
 * - Linked wallet addresses
 */

// ============================================================================
// Telegram Test Users
// ============================================================================

export const TELEGRAM_USERS = {
  alice: {
    telegramId: '111111111',
    username: 'alice_test_user',
    firstName: 'Alice',
    lastName: 'Tester'
  },
  bob: {
    telegramId: '222222222',
    username: 'bob_test_user',
    firstName: 'Bob',
    lastName: 'Tester'
  },
  charlie: {
    telegramId: '333333333',
    username: 'charlie_test_user',
    firstName: 'Charlie',
    lastName: 'Tester'
  },
  unlinked: {
    telegramId: '999999999',
    username: 'unlinked_user',
    firstName: 'Unlinked',
    lastName: 'User'
  }
};

// ============================================================================
// Google OAuth Test Identities
// ============================================================================

export const GOOGLE_IDENTITIES = {
  alice: {
    sub: 'google_user_alice_123456789',
    email: 'alice@test.example.com',
    email_verified: true,
    name: 'Alice Test',
    picture: 'https://example.com/alice.jpg',
    given_name: 'Alice',
    family_name: 'Test'
  },
  bob: {
    sub: 'google_user_bob_987654321',
    email: 'bob@test.example.com',
    email_verified: true,
    name: 'Bob Test',
    picture: 'https://example.com/bob.jpg',
    given_name: 'Bob',
    family_name: 'Test'
  },
  charlie: {
    sub: 'google_user_charlie_555555555',
    email: 'charlie@test.example.com',
    email_verified: true,
    name: 'Charlie Test',
    picture: 'https://example.com/charlie.jpg',
    given_name: 'Charlie',
    family_name: 'Test'
  }
};

// ============================================================================
// Test Wallet Addresses
// ============================================================================

/**
 * Mock zkLogin addresses for testing
 * NOTE: These are NOT real derived addresses - they are placeholders
 * Real address derivation should be tested against @mysten/sui/zklogin
 */
export const TEST_ADDRESSES = {
  alice: {
    zkLoginAddress: '0x' + 'a'.repeat(64), // Mock zkLogin address for Alice
    salt: '150862062947206198448536405856390800536',
    derivedAt: new Date('2024-01-01T00:00:00Z')
  },
  bob: {
    zkLoginAddress: '0x' + 'b'.repeat(64), // Mock zkLogin address for Bob
    salt: '250862062947206198448536405856390800537',
    derivedAt: new Date('2024-01-02T00:00:00Z')
  },
  charlie: {
    zkLoginAddress: '0x' + 'c'.repeat(64), // Mock zkLogin address for Charlie
    salt: '350862062947206198448536405856390800538',
    derivedAt: new Date('2024-01-03T00:00:00Z')
  }
};

// ============================================================================
// Linked User Records (Full Identity Binding)
// ============================================================================

export interface LinkedUserRecord {
  telegramId: string;
  provider: string;
  subject: string;
  audience: string;
  salt: string;
  zkLoginAddress: string;
  keyClaimName: string;
  linkedAt: Date;
  lastUsed: Date;
}

export const LINKED_USERS: Record<string, LinkedUserRecord> = {
  alice: {
    telegramId: TELEGRAM_USERS.alice.telegramId,
    provider: 'https://accounts.google.com',
    subject: GOOGLE_IDENTITIES.alice.sub,
    audience: 'test_client_id.apps.googleusercontent.com',
    salt: TEST_ADDRESSES.alice.salt,
    zkLoginAddress: TEST_ADDRESSES.alice.zkLoginAddress,
    keyClaimName: 'sub',
    linkedAt: new Date('2024-01-01T00:00:00Z'),
    lastUsed: new Date('2024-06-01T00:00:00Z')
  },
  bob: {
    telegramId: TELEGRAM_USERS.bob.telegramId,
    provider: 'https://accounts.google.com',
    subject: GOOGLE_IDENTITIES.bob.sub,
    audience: 'test_client_id.apps.googleusercontent.com',
    salt: TEST_ADDRESSES.bob.salt,
    zkLoginAddress: TEST_ADDRESSES.bob.zkLoginAddress,
    keyClaimName: 'sub',
    linkedAt: new Date('2024-01-02T00:00:00Z'),
    lastUsed: new Date('2024-06-02T00:00:00Z')
  }
};

// ============================================================================
// Salt Test Data
// ============================================================================

export const SALT_TEST_CASES = {
  // Same identity should always produce same salt
  deterministic: {
    provider: 'https://accounts.google.com',
    audience: 'test_client_id.apps.googleusercontent.com',
    subject: 'consistent_subject_12345',
    expectedSaltPrefix: '' // Will be deterministic based on master secret
  },
  
  // Different subjects should produce different salts
  differentSubjects: [
    { subject: 'subject_a', expectedUniqueSalt: true },
    { subject: 'subject_b', expectedUniqueSalt: true },
    { subject: 'subject_c', expectedUniqueSalt: true }
  ],
  
  // Different providers should produce different salts
  differentProviders: [
    { provider: 'https://accounts.google.com', subject: 'same_subject' },
    { provider: 'https://appleid.apple.com', subject: 'same_subject' }
  ]
};

// ============================================================================
// Proof Request Test Data
// ============================================================================

export const PROOF_REQUEST_FIXTURES = {
  valid: {
    maxEpoch: 100,
    jwtRandomness: '123456789012345678901234567890',
    keyClaimName: 'sub',
    extendedEphemeralPublicKey: 'base64_encoded_ephemeral_pubkey_for_testing'
  },
  
  invalidMaxEpoch: {
    maxEpoch: -1,
    jwtRandomness: '123456789012345678901234567890',
    keyClaimName: 'sub',
    extendedEphemeralPublicKey: 'base64_encoded_ephemeral_pubkey_for_testing'
  },
  
  missingFields: {
    maxEpoch: 100
    // Missing required fields
  }
};

// ============================================================================
// Rate Limiting Test Data
// ============================================================================

export const RATE_LIMIT_TEST_IPS = [
  '192.168.1.1',
  '192.168.1.2',
  '10.0.0.1',
  '172.16.0.1'
];

export const RATE_LIMIT_CONFIG = {
  perIp: {
    windowMs: 60000,
    maxRequests: 10
  },
  perTelegramId: {
    windowMs: 60000,
    maxRequests: 5
  },
  global: {
    windowMs: 60000,
    maxRequests: 100
  }
};

// ============================================================================
// Database Mock Records
// ============================================================================

export const DB_MOCK_RECORDS = {
  zkloginSalts: [
    {
      id: 1,
      telegram_id: TELEGRAM_USERS.alice.telegramId,
      provider: 'google',
      subject: GOOGLE_IDENTITIES.alice.sub,
      audience: 'test_client_id.apps.googleusercontent.com',
      salt_encrypted: Buffer.from('encrypted_salt_alice'),
      encryption_iv: Buffer.from('random_iv_alice'),
      derived_address: TEST_ADDRESSES.alice.zkLoginAddress,
      key_claim_name: 'sub',
      created_at: new Date('2024-01-01T00:00:00Z'),
      updated_at: new Date('2024-01-01T00:00:00Z')
    },
    {
      id: 2,
      telegram_id: TELEGRAM_USERS.bob.telegramId,
      provider: 'google',
      subject: GOOGLE_IDENTITIES.bob.sub,
      audience: 'test_client_id.apps.googleusercontent.com',
      salt_encrypted: Buffer.from('encrypted_salt_bob'),
      encryption_iv: Buffer.from('random_iv_bob_12'),
      derived_address: TEST_ADDRESSES.bob.zkLoginAddress,
      key_claim_name: 'sub',
      created_at: new Date('2024-01-02T00:00:00Z'),
      updated_at: new Date('2024-01-02T00:00:00Z')
    }
  ]
};

// ============================================================================
// Test Scenario Builders
// ============================================================================

/**
 * Create a complete test identity binding
 */
export function createTestBinding(
  name: 'alice' | 'bob' | 'charlie'
): {
  telegram: typeof TELEGRAM_USERS.alice;
  google: typeof GOOGLE_IDENTITIES.alice;
  wallet: typeof TEST_ADDRESSES.alice;
  linked: LinkedUserRecord | undefined;
} {
  return {
    telegram: TELEGRAM_USERS[name],
    google: GOOGLE_IDENTITIES[name],
    wallet: TEST_ADDRESSES[name],
    linked: LINKED_USERS[name]
  };
}

/**
 * Create a salt request payload
 */
export function createSaltRequest(
  telegramId: string,
  jwt: string
): { telegramId: string; jwt: string; provider?: string } {
  return {
    telegramId,
    jwt,
    provider: 'google'
  };
}

/**
 * Create a proof request payload
 */
export function createProofRequest(
  jwt: string,
  salt: string,
  overrides: Partial<typeof PROOF_REQUEST_FIXTURES.valid> = {}
): Record<string, unknown> {
  return {
    jwt,
    salt,
    ...PROOF_REQUEST_FIXTURES.valid,
    ...overrides
  };
}

// ============================================================================
// Export Everything
// ============================================================================

export default {
  TELEGRAM_USERS,
  GOOGLE_IDENTITIES,
  TEST_ADDRESSES,
  LINKED_USERS,
  SALT_TEST_CASES,
  PROOF_REQUEST_FIXTURES,
  RATE_LIMIT_TEST_IPS,
  RATE_LIMIT_CONFIG,
  DB_MOCK_RECORDS,
  createTestBinding,
  createSaltRequest,
  createProofRequest
};
