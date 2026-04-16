// ─── Crypto Utilities ─────────────────────────────────────────────────────────

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import bcrypt from 'bcrypt'

const BCRYPT_ROUNDS = 12

/**
 * Generate a secure API key with a readable prefix.
 * Format: snv_live_<48 random hex chars>
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(24).toString('hex')
  const key = `snv_live_${raw}`
  const prefix = `snv_live_${raw.slice(0, 8)}...`
  const hash = hashApiKey(key)
  return { key, prefix, hash }
}

/**
 * SHA-256 hash of an API key for safe DB storage.
 * API keys are already high-entropy, so SHA-256 is sufficient here
 * (unlike passwords, which need bcrypt).
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Timing-safe comparison of two strings (prevents timing attacks).
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Hash a password using bcrypt with a configurable cost factor.
 * bcrypt is intentionally slow to resist brute-force attacks.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

/**
 * Verify a password against a bcrypt hash.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return bcrypt.compare(password, stored)
}
