// ─── Analytics Routes ─────────────────────────────────────────────────────────
// GET /analytics/overview   — aggregate send stats for the authenticated user

import type { FastifyInstance } from 'fastify'
import { ok } from '../lib/response'

export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/analytics/overview',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user.sub

      // Aggregate counts by status
      const statusCounts = await fastify.prisma.emailLog.groupBy({
        by: ['status'],
        where: { userId },
        _count: { status: true },
      })

      const stats = statusCounts.reduce<Record<string, number>>((acc, row) => {
        acc[row.status.toLowerCase()] = row._count.status
        return acc
      }, {})

      // Total sent in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const last30Days = await fastify.prisma.emailLog.count({
        where: { userId, createdAt: { gte: thirtyDaysAgo } },
      })

      // Delivery rate
      const total = Object.values(stats).reduce((a, b) => a + b, 0)
      const delivered = (stats['delivered'] ?? 0) + (stats['opened'] ?? 0) + (stats['clicked'] ?? 0)
      const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0

      return ok(reply, {
        total,
        last30Days,
        deliveryRate: `${deliveryRate}%`,
        breakdown: stats,
      })
    },
  )
}
