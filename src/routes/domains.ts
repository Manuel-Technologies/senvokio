// ─── Domain Routes ────────────────────────────────────────────────────────────
// POST   /domains                    — register a domain
// GET    /domains                    — list user's domains
// GET    /domains/:domain/status     — poll verification status
// DELETE /domains/:domain            — remove domain

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { registerDomain, refreshDomainStatus, removeDomain } from '../services/domainService'
import { ok, created, fail } from '../lib/response'

const addDomainSchema = z.object({
  domain: z
    .string()
    .min(3)
    .regex(
      /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i,
      'Invalid domain format',
    ),
  mailFromSubdomain: z
    .string()
    .optional()
    .describe('Custom MAIL FROM subdomain, e.g. bounce.yourdomain.ng'),
})

export async function domainRoutes(fastify: FastifyInstance) {
  // ── Register Domain ─────────────────────────────────────────────────────────
  fastify.post(
    '/domains',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = addDomainSchema.safeParse(request.body)
      if (!body.success) {
        return fail(reply, 'VALIDATION_ERROR', 'Invalid input', 422, body.error.flatten())
      }

      const { domain, mailFromSubdomain } = body.data

      // Recommend subdomain for better deliverability isolation
      const dotCount = (domain.match(/\./g) ?? []).length
      const recommendation =
        dotCount < 2
          ? `💡 Tip: Consider using a subdomain like mail.${domain} or notifications.${domain} for better deliverability isolation.`
          : undefined

      const result = await registerDomain(
        fastify.prisma,
        request.user.sub,
        domain,
        mailFromSubdomain,
      )

      return created(reply, { ...result, recommendation })
    },
  )

  // ── List Domains ────────────────────────────────────────────────────────────
  fastify.get(
    '/domains',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const domains = await fastify.prisma.domain.findMany({
        where: { userId: request.user.sub },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          domain: true,
          verificationStatus: true,
          dkimStatus: true,
          mailFromStatus: true,
          configSetName: true,
          verifiedAt: true,
          createdAt: true,
        },
      })
      return ok(reply, { domains })
    },
  )

  // ── Poll Status ─────────────────────────────────────────────────────────────
  fastify.get(
    '/domains/:domain/status',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { domain } = request.params as { domain: string }
      const status = await refreshDomainStatus(fastify.prisma, request.user.sub, domain)
      return ok(reply, status)
    },
  )

  // ── Delete Domain ───────────────────────────────────────────────────────────
  fastify.delete(
    '/domains/:domain',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { domain } = request.params as { domain: string }
      const result = await removeDomain(fastify.prisma, request.user.sub, domain)
      return ok(reply, result)
    },
  )
}
