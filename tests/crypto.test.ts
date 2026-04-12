// ─── Crypto Utility Tests ─────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey, hashPassword, verifyPassword } from '../src/lib/crypto'

describe('generateApiKey', () => {
  it('generates a key with snv_live_ prefix', () => {
    const { key } = generateApiKey()
    expect(key).toMatch(/^snv_live_[a-f0-9]{48}$/)
  })

  it('generates unique keys', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.key).not.toBe(b.key)
  })

  it('hash is deterministic', () => {
    const { key, hash } = generateApiKey()
    expect(hashApiKey(key)).toBe(hash)
  })
})

describe('password hashing', () => {
  it('verifies correct password', () => {
    const hash = hashPassword('mypassword123')
    expect(verifyPassword('mypassword123', hash)).toBe(true)
  })

  it('rejects wrong password', () => {
    const hash = hashPassword('mypassword123')
    expect(verifyPassword('wrongpassword', hash)).toBe(false)
  })

  it('produces different hashes for same password (salted)', () => {
    const h1 = hashPassword('same')
    const h2 = hashPassword('same')
    expect(h1).not.toBe(h2)
  })
})
