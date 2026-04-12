// ─── Health Check Test ────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  // Set required env vars for test
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/senviok_test'
  process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long'
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

  app = await buildApp()
})

afterAll(async () => {
  await app.close()
})

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('senviok')
  })
})
