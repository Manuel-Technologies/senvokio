// ─── Redis Plugin ─────────────────────────────────────────────────────────────
// Registers an ioredis client as a Fastify decorator.
// Used by BullMQ queues and rate limiting.

import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import Redis from 'ioredis'
import { env } from '../config/env'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

async function redisPlugin(fastify: FastifyInstance) {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  })

  redis.on('connect', () => fastify.log.info('✅ Redis connected'))
  redis.on('error', (err) => fastify.log.error({ err }, 'Redis error'))

  fastify.decorate('redis', redis)

  fastify.addHook('onClose', async () => {
    await redis.quit()
    fastify.log.info('Redis disconnected')
  })
}

export default fp(redisPlugin, { name: 'redis' })
