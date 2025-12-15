/**
 * Mock JWKS (JSON Web Key Set) Responses for Testing
 * 
 * These mock JWKS responses simulate Google's OAuth JWKS endpoint
 * for testing JWT signature verification logic.
 * 
 * NOTE: These keys are TEST FIXTURES ONLY and are NOT cryptographically valid.
 * Real JWKS verification should be tested against actual Google endpoints
 * in integration tests.
 */

// ============================================================================
// Mock RSA Public Keys (Test Only)
// ============================================================================

/**
 * Mock JWKS response matching Google's format
 * https://www.googleapis.com/oauth2/v3/certs
 */
export const MOCK_GOOGLE_JWKS = {
  keys: [
    {
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
      kid: 'test-key-id-google-2024',
      n: 'mock_modulus_base64url_encoded_value_for_testing_purposes_only_this_is_not_a_real_key_1234567890',
      e: 'AQAB'
    },
    {
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
      kid: 'test-key-id-google-2024-backup',
      n: 'mock_modulus_base64url_encoded_backup_key_for_testing_purposes_only_not_real_key_0987654321',
      e: 'AQAB'
    }
  ]
};

/**
 * JWKS response with rotated keys (for testing key rotation)
 */
export const MOCK_GOOGLE_JWKS_ROTATED = {
  keys: [
    {
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
      kid: 'test-key-id-google-2025-new',
      n: 'new_rotated_modulus_base64url_encoded_value_for_testing_key_rotation_scenarios',
      e: 'AQAB'
    },
    {
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
      kid: 'test-key-id-google-2024', // Keep one old key during rotation
      n: 'mock_modulus_base64url_encoded_value_for_testing_purposes_only_this_is_not_a_real_key_1234567890',
      e: 'AQAB'
    }
  ]
};

/**
 * Empty JWKS response (for error testing)
 */
export const MOCK_EMPTY_JWKS = {
  keys: []
};

/**
 * Malformed JWKS response (for error testing)
 */
export const MOCK_MALFORMED_JWKS = {
  error: 'Invalid response'
};

// ============================================================================
// JWKS Endpoint URLs
// ============================================================================

export const JWKS_URLS = {
  google: 'https://www.googleapis.com/oauth2/v3/certs',
  apple: 'https://appleid.apple.com/auth/keys',
  microsoft: 'https://login.microsoftonline.com/common/discovery/v2.0/keys'
};

// ============================================================================
// Mock Fetch Response Generators
// ============================================================================

/**
 * Create a mock fetch response for JWKS
 */
export function createMockJwksResponse(
  jwks: object,
  options: { status?: number; ok?: boolean } = {}
): Response {
  const { status = 200, ok = true } = options;
  
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: new Headers({
      'content-type': 'application/json',
      'cache-control': 'public, max-age=86400'
    }),
    json: async () => jwks,
    text: async () => JSON.stringify(jwks)
  } as unknown as Response;
}

/**
 * Create a mock fetch error response
 */
export function createMockJwksErrorResponse(
  status: number,
  errorMessage: string
): Response {
  return {
    ok: false,
    status,
    statusText: errorMessage,
    headers: new Headers({}),
    json: async () => ({ error: errorMessage }),
    text: async () => JSON.stringify({ error: errorMessage })
  } as unknown as Response;
}

/**
 * Create a network error (fetch throws)
 */
export function createNetworkError(): Error {
  const error = new Error('Network request failed');
  error.name = 'NetworkError';
  return error;
}

// ============================================================================
// Helper Functions for Tests
// ============================================================================

/**
 * Find a key by kid in a JWKS
 */
export function findKeyByKid(jwks: typeof MOCK_GOOGLE_JWKS, kid: string) {
  return jwks.keys.find(key => key.kid === kid);
}

/**
 * Get the primary signing key from a JWKS
 */
export function getPrimarySigningKey(jwks: typeof MOCK_GOOGLE_JWKS) {
  return jwks.keys.find(key => key.use === 'sig');
}

/**
 * Check if a kid exists in the JWKS
 */
export function hasKeyId(jwks: typeof MOCK_GOOGLE_JWKS, kid: string): boolean {
  return jwks.keys.some(key => key.kid === kid);
}

// ============================================================================
// Cache Testing Utilities
// ============================================================================

/**
 * Mock cache state for testing JWKS caching
 */
export interface MockJwksCache {
  keys: typeof MOCK_GOOGLE_JWKS.keys;
  fetchedAt: number;
  ttlMs: number;
  hits: number;
  misses: number;
}

/**
 * Create a fresh cache state
 */
export function createFreshCache(): MockJwksCache {
  return {
    keys: [...MOCK_GOOGLE_JWKS.keys],
    fetchedAt: Date.now(),
    ttlMs: 3600000, // 1 hour
    hits: 0,
    misses: 0
  };
}

/**
 * Create an expired cache state
 */
export function createExpiredCache(): MockJwksCache {
  return {
    keys: [...MOCK_GOOGLE_JWKS.keys],
    fetchedAt: Date.now() - 7200000, // 2 hours ago
    ttlMs: 3600000, // 1 hour TTL (so it's expired)
    hits: 5,
    misses: 1
  };
}

/**
 * Check if cache is expired
 */
export function isCacheExpired(cache: MockJwksCache): boolean {
  return Date.now() - cache.fetchedAt > cache.ttlMs;
}

// ============================================================================
// Export Everything
// ============================================================================

export default {
  MOCK_GOOGLE_JWKS,
  MOCK_GOOGLE_JWKS_ROTATED,
  MOCK_EMPTY_JWKS,
  MOCK_MALFORMED_JWKS,
  JWKS_URLS,
  createMockJwksResponse,
  createMockJwksErrorResponse,
  createNetworkError,
  findKeyByKid,
  getPrimarySigningKey,
  hasKeyId,
  createFreshCache,
  createExpiredCache,
  isCacheExpired
};
