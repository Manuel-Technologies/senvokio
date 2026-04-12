// ─── Auth Plugin ──────────────────────────────────────────────────────────────
// Registers JWT support and an `authenticate` decorator that validates both
// Bearer JWT tokens and API keys (snv_live_...).

import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { hashApiKey } from '../lib/crypto'
import { UnauthorizedError } from '../lib/errors'
import type { JwtPayload } from '../types'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    user: JwtPayload
  }
}

async function authPlugin(fastify: FastifyInstance) {
  // JWT is registered in server.ts via @fastify/jwt — we just add the decorator here.

  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const authHeader = request.headers.authorization

      if (!authHeader) {
        throw new UnauthorizedError('Missing Authorization header')
      }

      // ── API Key auth ──────────────────────────────────────────────────────
      if (authHeader.startsWith('Bearer snv_')) {
        const apiKey = authHeader.replace('Bearer ', '').trim()
        const keyHash = hashApiKey(apiKey)

        const record = await fastify.prisma.apiKey.findUnique({
          where: { keyHash },
          include: { user: true },
        })

        if (!record || record.revokedAt) {
          throw new UnauthorizedError('Invalid or revoked API key')
        }

        // Update last used timestamp (fire-and-forget)
        fastify.prisma.apiKey
          .update({ where: { id: record.id }, data: { lastUsed: new Date() } })
          .catch(() => {})

        request.user = {
          sub: record.userId,
          email: record.user.email,
        }
        return
      }

      // ── JWT auth ──────────────────────────────────────────────────────────
      try {
        await request.jwtVerify()
        // @fastify/jwt sets request.user after verify
      } catch {
        throw new UnauthorizedError('Invalid or expired token')
      }
    },
  )
}

export default fp(authPlugin, { name: 'auth', dependencies: ['prisma'] })
