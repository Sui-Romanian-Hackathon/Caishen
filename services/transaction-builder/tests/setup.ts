/**
 * Test Setup for zkLogin Transaction Builder Tests
 * 
 * This file configures the test environment, mocks, and utilities
 * for all zkLogin-related tests.
 */

import { vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Environment Variables (Test Configuration)
// ============================================================================

process.env.NODE_ENV = 'test';
process.env.PORT = '3003';
process.env.ZKLOGIN_MASTER_SECRET = 'test_master_secret_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ZKLOGIN_ENCRYPTION_KEY = 'test_encryption_key_0123456789abcdef0123456789abcdef';
process.env.GOOGLE_CLIENT_ID = 'test_client_id.apps.googleusercontent.com';
process.env.PROVER_URL = 'http://localhost:9999/mock-prover';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/caishen_test';

// ============================================================================
// Global Test Utilities
// ============================================================================

/**
 * Creates a mock Express request object
 */
export function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    body: {},
    params: {},
    query: {},
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1'
    },
    ip: '127.0.0.1',
    ...overrides
  };
}

/**
 * Creates a mock Express response object
 */
export function createMockResponse(): MockResponse {
  const res: Partial<MockResponse> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as MockResponse;
}

// ============================================================================
// Type Definitions for Mocks
// ============================================================================

export interface MockRequest {
  body: Record<string, unknown>;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  ip: string;
}

export interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
}

// ============================================================================
// Global Mocks
// ============================================================================

// Mock fetch for JWKS and external API calls
export const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock database pool
export const mockDbPool = {
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn()
};

// Mock Mysten prover
export const mockProverResponse = {
  proofPoints: {
    a: ['mock_a_1', 'mock_a_2'],
    b: [['mock_b_1_1', 'mock_b_1_2'], ['mock_b_2_1', 'mock_b_2_2']],
    c: ['mock_c_1', 'mock_c_2']
  },
  issBase64Details: {
    value: 'aHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29t',
    indexMod4: 1
  },
  headerBase64: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2V5LWlkIn0'
};

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

beforeAll(() => {
  console.log('🧪 Starting zkLogin test suite...');
});

afterAll(() => {
  console.log('🧪 zkLogin test suite complete.');
});

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
  mockFetch.mockReset();
  mockDbPool.query.mockReset();
});

afterEach(() => {
  // Cleanup after each test
});

// ============================================================================
// Test Helper Functions
// ============================================================================

/**
 * Wait for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a random string for test data
 */
export function randomString(length: number = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create a mock JWT token for testing
 * NOTE: These are NOT valid JWTs - they are for structure testing only
 */
export function createMockJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT',
    kid: 'test-key-id'
  })).toString('base64url');
  
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'mock_signature_for_testing';
  
  return `${header}.${payloadB64}.${signature}`;
}

/**
 * Decode a JWT payload without verification (for testing)
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.');
  const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json);
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a response has a specific status code
 */
export function expectStatus(res: MockResponse, status: number): void {
  expect(res.status).toHaveBeenCalledWith(status);
}

/**
 * Assert that a response JSON contains specific fields
 */
export function expectJsonContains(res: MockResponse, expected: Record<string, unknown>): void {
  expect(res.json).toHaveBeenCalled();
  const calls = res.json.mock.calls;
  const lastCall = calls[calls.length - 1][0];
  expect(lastCall).toMatchObject(expected);
}

/**
 * Assert that a response JSON has an error field
 */
export function expectError(res: MockResponse, errorPattern: string | RegExp): void {
  expect(res.json).toHaveBeenCalled();
  const calls = res.json.mock.calls;
  const lastCall = calls[calls.length - 1][0];
  expect(lastCall).toHaveProperty('error');
  if (typeof errorPattern === 'string') {
    expect(lastCall.error).toContain(errorPattern);
  } else {
    expect(lastCall.error).toMatch(errorPattern);
  }
}

// ============================================================================
// Export Everything
// ============================================================================

export default {
  createMockRequest,
  createMockResponse,
  mockFetch,
  mockDbPool,
  mockProverResponse,
  sleep,
  randomString,
  createMockJwt,
  decodeJwtPayload,
  expectStatus,
  expectJsonContains,
  expectError
};
