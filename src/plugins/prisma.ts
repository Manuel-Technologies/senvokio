// ─── Prisma Plugin ────────────────────────────────────────────────────────────
// Registers PrismaClient as a Fastify decorator so all routes can access it
// via `fastify.prisma` or `request.server.prisma`.

import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

async function prismaPlugin(fastify: FastifyInstance) {
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

  await prisma.$connect()
  fastify.log.info('✅ Prisma connected')

  fastify.decorate('prisma', prisma)

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect()
    fastify.log.info('Prisma disconnected')
  })
}

export default fp(prismaPlugin, { name: 'prisma' })
