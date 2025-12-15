/**
 * Test JWT Tokens for zkLogin Testing
 * 
 * ⚠️  WARNING: These are TEST FIXTURES ONLY
 * These JWTs are intentionally invalid/expired and should NEVER be used in production.
 * They are designed to test JWT parsing, validation logic, and error handling.
 */

// ============================================================================
// Test Identity Data
// ============================================================================

export const TEST_IDENTITIES = {
  alice: {
    sub: 'google_user_alice_123456789',
    email: 'alice@test.com',
    name: 'Alice Test'
  },
  bob: {
    sub: 'google_user_bob_987654321',
    email: 'bob@test.com',
    name: 'Bob Test'
  },
  charlie: {
    sub: 'google_user_charlie_555555555',
    email: 'charlie@test.com',
    name: 'Charlie Test'
  }
};

export const TEST_CONFIG = {
  validIssuer: 'https://accounts.google.com',
  validAudience: 'test_client_id.apps.googleusercontent.com',
  invalidIssuer: 'https://evil-issuer.com',
  invalidAudience: 'wrong_client_id.apps.googleusercontent.com',
  testNonce: 'zklogin_nonce_for_testing_12345',
  testKeyId: 'test-key-id-google-2024'
};

// ============================================================================
// JWT Token Generators
// ============================================================================

/**
 * Create a base64url encoded string
 */
function base64url(data: string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Create a mock JWT with specified claims
 */
function createJwt(header: object, payload: object, signature: string = 'mock_signature'): string {
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}.${signature}`;
}

// ============================================================================
// Valid Test JWTs
// ============================================================================

/**
 * Valid JWT for Alice - all claims correct, not expired
 */
export const VALID_JWT_ALICE = createJwt(
  {
    alg: 'RS256',
    typ: 'JWT',
    kid: TEST_CONFIG.testKeyId
  },
  {
    iss: TEST_CONFIG.validIssuer,
    aud: TEST_CONFIG.validAudience,
    sub: TEST_IDENTITIES.alice.sub,
    email: TEST_IDENTITIES.alice.email,
    name: TEST_IDENTITIES.alice.name,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000) - 60,   // 1 minute ago
    nonce: TEST_CONFIG.testNonce
  }
);

/**
 * Valid JWT for Bob - all claims correct, not expired
 */
export const VALID_JWT_BOB = createJwt(
  {
    alg: 'RS256',
    typ: 'JWT',
    kid: TEST_CONFIG.testKeyId
  },
  {
    iss: TEST_CONFIG.validIssuer,
    aud: TEST_CONFIG.validAudience,
    sub: TEST_IDENTITIES.bob.sub,
    email: TEST_IDENTITIES.bob.email,
    name: TEST_IDENTITIES.bob.name,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000) - 60,
    nonce: TEST_CONFIG.testNonce
  }
);

// ============================================================================
// Invalid Test JWTs - For Error Case Testing
// ============================================================================

/**
 * Expired JWT - exp claim is in the past
 */
export const EXPIRED_JWT = createJwt(
  {
    alg: 'RS256',
    typ: 'JWT',
    kid: TEST_CONFIG.testKeyId
  },
  {
    iss: TEST_CONFIG.validIssuer,
    aud: TEST_CONFIG.validAudience,
    sub: TEST_IDENTITIES.alice.sub,
    exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (EXPIRED)
    iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
    nonce: TEST_CONFIG.testNonce
  }
);

/**
 * JWT with wrong issuer
 */
export const WRONG_ISSUER_JWT = createJwt(
  {
    alg: 'RS256',
    typ: 'JWT',
    kid: TEST_CONFIG.testKeyId
  },
  {
    iss: TEST_CONFIG.invalidIssuer, // WRONG ISSUER
    aud: TEST_CONFIG.validAudience,
    sub: TEST_IDENTITIES.alice.sub,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000) - 60,
    nonce: TEST_CONFIG.testNonce
  }
);

/**
 * JWT with wrong audience
 */
export const WRONG_AUDIENCE_JWT = createJwt(
  {
    alg: 'RS256',
    typ: 'JWT',
    kid: TEST_CONFIG.testKeyId
  },
  {
    iss: TEST_CONFIG.validIssuer,
    aud: TEST_CONFIG.invalidAudience, // WRONG AUDIENCE
    sub: TEST_IDENTITIES.alice.sub,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000) - 60,
    nonce: TEST_CONFIG.testNonce
  }
);

/**
 * JWT with missing subject claim
 */
export const MISSING_SUB_JWT = createJwt(
  {
    alg: 'RS256',
    typ: 'JWT',
    kid: TEST_CONFIG.testKeyId
  },
  {
    iss: TEST_CONFIG.validIssuer,
    aud: TEST_CONFIG.validAudience,
    // sub is MISSING
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000) - 60,
    nonce: TEST_CONFIG.testNonce
  }
);

/**
 * JWT issued in the future (iat > now)
 */
export const FUTURE_IAT_JWT = createJwt(
  {
    alg: 'RS256',
    typ: 'JWT',
    kid: TEST_CONFIG.testKeyId
  },
  {
    iss: TEST_CONFIG.validIssuer,
    aud: TEST_CONFIG.validAudience,
    sub: TEST_IDENTITIES.alice.sub,
    exp: Math.floor(Date.now() / 1000) + 7200,
    iat: Math.floor(Date.now() / 1000) + 3600, // FUTURE (invalid)
    nonce: TEST_CONFIG.testNonce
  }
);

/**
 * Malformed JWT - not proper base64
 */
export const MALFORMED_JWT = 'not.a.valid.jwt.token';

/**
 * JWT with invalid structure (missing parts)
 */
export const INCOMPLETE_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';

/**
 * JWT with unknown algorithm
 */
export const UNKNOWN_ALG_JWT = createJwt(
  {
    alg: 'NONE', // Invalid algorithm
    typ: 'JWT',
    kid: TEST_CONFIG.testKeyId
  },
  {
    iss: TEST_CONFIG.validIssuer,
    aud: TEST_CONFIG.validAudience,
    sub: TEST_IDENTITIES.alice.sub,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000) - 60,
    nonce: TEST_CONFIG.testNonce
  }
);

// ============================================================================
// JWT Extraction Helpers
// ============================================================================

/**
 * Extract claims from a JWT without verification (for test assertions)
 */
export function extractJwtClaims(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Extract header from a JWT without verification (for test assertions)
 */
export function extractJwtHeader(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    
    const header = parts[0];
    const padded = header.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ============================================================================
// Test Data Collections
// ============================================================================

/**
 * All valid JWTs for iteration testing
 */
export const ALL_VALID_JWTS = [
  { name: 'alice', jwt: VALID_JWT_ALICE, identity: TEST_IDENTITIES.alice },
  { name: 'bob', jwt: VALID_JWT_BOB, identity: TEST_IDENTITIES.bob }
];

/**
 * All invalid JWTs for error testing
 */
export const ALL_INVALID_JWTS = [
  { name: 'expired', jwt: EXPIRED_JWT, expectedError: /expired/i },
  { name: 'wrong_issuer', jwt: WRONG_ISSUER_JWT, expectedError: /issuer/i },
  { name: 'wrong_audience', jwt: WRONG_AUDIENCE_JWT, expectedError: /audience/i },
  { name: 'missing_sub', jwt: MISSING_SUB_JWT, expectedError: /sub|subject/i },
  { name: 'future_iat', jwt: FUTURE_IAT_JWT, expectedError: /issued|iat/i },
  { name: 'malformed', jwt: MALFORMED_JWT, expectedError: /invalid|malformed/i },
  { name: 'incomplete', jwt: INCOMPLETE_JWT, expectedError: /invalid|malformed/i },
  { name: 'unknown_alg', jwt: UNKNOWN_ALG_JWT, expectedError: /algorithm|alg/i }
];

export default {
  TEST_IDENTITIES,
  TEST_CONFIG,
  VALID_JWT_ALICE,
  VALID_JWT_BOB,
  EXPIRED_JWT,
  WRONG_ISSUER_JWT,
  WRONG_AUDIENCE_JWT,
  MISSING_SUB_JWT,
  FUTURE_IAT_JWT,
  MALFORMED_JWT,
  INCOMPLETE_JWT,
  UNKNOWN_ALG_JWT,
  extractJwtClaims,
  extractJwtHeader,
  ALL_VALID_JWTS,
  ALL_INVALID_JWTS
};
