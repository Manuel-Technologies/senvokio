// ─── Auth Routes ──────────────────────────────────────────────────────────────
// POST /auth/register
// POST /auth/login
// POST /auth/api-keys          (create API key)
// GET  /auth/api-keys          (list API keys)
// DELETE /auth/api-keys/:id    (revoke API key)

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { hashPassword, verifyPassword, generateApiKey } from '../lib/crypto'
import { ok, created, fail } from '../lib/response'
import { ConflictError, UnauthorizedError, NotFoundError, ForbiddenError } from '../lib/errors'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const createKeySchema = z.object({
  name: z.string().min(1).max(64),
})

export async function authRoutes(fastify: FastifyInstance) {
  // ── Register ────────────────────────────────────────────────────────────────
  fastify.post('/auth/register', async (request, reply) => {
    const body = registerSchema.safeParse(request.body)
    if (!body.success) return fail(reply, 'VALIDATION_ERROR', 'Invalid input', 422, body.error.flatten())

    const { email, password, name } = body.data

    const existing = await fastify.prisma.user.findUnique({ where: { email } })
    if (existing) throw new ConflictError('Email already registered')

    const user = await fastify.prisma.user.create({
      data: { email, passwordHash: await hashPassword(password), name },
    })

    const token = fastify.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '7d' })

    return created(reply, {
      token,
      user: { id: user.id, email: user.email, name: user.name },
    })
  })

  // ── Login ───────────────────────────────────────────────────────────────────
  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) return fail(reply, 'VALIDATION_ERROR', 'Invalid input', 422, body.error.flatten())

    const { email, password } = body.data

    const user = await fastify.prisma.user.findUnique({ where: { email } })
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password')
    }

    const token = fastify.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '7d' })

    return ok(reply, {
      token,
      user: { id: user.id, email: user.email, name: user.name },
    })
  })

  // ── Create API Key ──────────────────────────────────────────────────────────
  fastify.post(
    '/auth/api-keys',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = createKeySchema.safeParse(request.body)
      if (!body.success) return fail(reply, 'VALIDATION_ERROR', 'Invalid input', 422, body.error.flatten())

      const { key, prefix, hash } = generateApiKey()

      const record = await fastify.prisma.apiKey.create({
        data: {
          userId: request.user.sub,
          name: body.data.name,
          keyHash: hash,
          keyPrefix: prefix,
        },
      })

      // Return the full key ONCE — it cannot be retrieved again
      return created(reply, {
        id: record.id,
        name: record.name,
        key,   // ← show only on creation
        prefix,
        createdAt: record.createdAt,
        warning: 'Store this key securely. It will not be shown again.',
      })
    },
  )

  // ── List API Keys ───────────────────────────────────────────────────────────
  fastify.get(
    '/auth/api-keys',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const keys = await fastify.prisma.apiKey.findMany({
        where: { userId: request.user.sub, revokedAt: null },
        select: { id: true, name: true, keyPrefix: true, lastUsed: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
      return ok(reply, { keys })
    },
  )

  // ── Revoke API Key ──────────────────────────────────────────────────────────
  fastify.delete(
    '/auth/api-keys/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const key = await fastify.prisma.apiKey.findUnique({ where: { id } })
      if (!key) throw new NotFoundError('API key')
      if (key.userId !== request.user.sub) throw new ForbiddenError()

      await fastify.prisma.apiKey.update({
        where: { id },
        data: { revokedAt: new Date() },
      })

      return ok(reply, { revoked: true })
    },
  )
}
