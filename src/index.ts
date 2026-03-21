// =============================================================================
// Security Hardening — Input Validation, Error Sanitization, Security Constants
// =============================================================================

/** Security constants */
const MAX_INPUT_LENGTH = 10_000;
const MAX_PUBKEY_LENGTH = 44;
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
const SENSITIVE_PATTERNS = /(?:api[_-]?key|secret|password|token|auth|credential|private[_-]?key)/i;

/** Validate and sanitize string input */
export function sanitizeString(input: unknown): string {
  if (typeof input !== 'string') {
    throw new SecurityError('Input must be a string');
  }
  if (input.length > MAX_INPUT_LENGTH) {
    throw new SecurityError(`Input exceeds maximum length of ${MAX_INPUT_LENGTH}`);
  }
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/** Validate Solana public key format */
export function validatePublicKey(key: string): string {
  const sanitized = sanitizeString(key).trim();
  if (sanitized.length > MAX_PUBKEY_LENGTH || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(sanitized)) {
    throw new SecurityError('Invalid public key format');
  }
  return sanitized;
}

/** Validate generic input with type checking */
export function validateInput<T>(
  input: unknown,
  validator: (val: unknown) => val is T,
  label = 'input'
): T {
  if (input === null || input === undefined) {
    throw new SecurityError(`${label} is required`);
  }
  if (!validator(input)) {
    throw new SecurityError(`${label} failed validation`);
  }
  return input;
}

/** Sanitize error objects to prevent information leakage */
export function sanitizeError(error: unknown): { message: string; code: string } {
  if (error instanceof SecurityError) {
    return { message: error.message, code: 'SECURITY_VIOLATION' };
  }
  const msg = error instanceof Error ? error.message : String(error);
  const sanitized = msg
    .replace(/\/[^\s:]+/g, '[path]')
    .replace(/at\s+.+\(.*\)/g, '[internal]')
    .replace(SENSITIVE_PATTERNS, '[redacted]');
  return { message: sanitized, code: 'INTERNAL_ERROR' };
}

/** Security-specific error class */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/** Rate limiter stub */
export function createRateLimiter(opts: { maxRequests: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || now > entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + opts.windowMs });
        return true;
      }
      if (entry.count >= opts.maxRequests) return false;
      entry.count++;
      return true;
    },
    reset(key: string) { hits.delete(key); },
  };
}

// =============================================================================
// Module Exports
// =============================================================================

export * from "./api";
export * as claimLinks from "./claimLinks";
export * from "./marketplace";
export * as programs from "./programs";
export * as rentals from "./rentals";
export * from "./transaction";
