// ─── Crypto Utilities ─────────────────────────────────────────────────────────

import { createHash, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Generate a secure API key with a readable prefix.
 * Format: snv_live_<32 random hex chars>
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
 * Simple password hash using SHA-256 + salt.
 * For production, swap with bcrypt or argon2.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = createHash('sha256').update(salt + password).digest('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  const attempt = createHash('sha256').update(salt + password).digest('hex')
  return safeCompare(attempt, hash)
}
