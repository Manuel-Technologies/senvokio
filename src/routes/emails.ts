// ─── Email Sending Routes ─────────────────────────────────────────────────────
// POST /emails          — send an email (async, queued)
// GET  /emails          — list send history
// GET  /emails/:id      — get single email log

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sendEmail } from '../services/sendingService'
import { ok, created, fail } from '../lib/response'
import { NotFoundError, ForbiddenError } from '../lib/errors'

const sendEmailSchema = z.object({
  from: z.string().email('Invalid from address'),
  to: z.union([z.string().email(), z.array(z.string().email()).min(1).max(50)]),
  subject: z.string().min(1).max(998),
  html: z.string().optional(),
  text: z.string().optional(),
  templateId: z.string().uuid().optional(),
  variables: z.record(z.string()).optional(),
  replyTo: z.string().email().optional(),
  tags: z.record(z.string().max(256)).optional(),
}).refine(
  (d) => d.html || d.text || d.templateId,
  { message: 'Provide html, text, or templateId' },
)

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
})

export async function emailRoutes(fastify: FastifyInstance) {
  // ── Send Email ──────────────────────────────────────────────────────────────
  fastify.post(
    '/emails',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = sendEmailSchema.safeParse(request.body)
      if (!body.success) {
        return fail(reply, 'VALIDATION_ERROR', 'Invalid input', 422, body.error.flatten())
      }

      const result = await sendEmail(fastify.prisma, request.user.sub, body.data)
      return created(reply, result)
    },
  )

  // ── List Emails ─────────────────────────────────────────────────────────────
  fastify.get(
    '/emails',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const query = listQuerySchema.safeParse(request.query)
      if (!query.success) {
        return fail(reply, 'VALIDATION_ERROR', 'Invalid query', 422, query.error.flatten())
      }

      const { page, limit, status } = query.data
      const skip = (page - 1) * limit

      const [emails, total] = await Promise.all([
        fastify.prisma.emailLog.findMany({
          where: {
            userId: request.user.sub,
            ...(status ? { status: status as never } : {}),
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            fromAddress: true,
            toAddresses: true,
            subject: true,
            status: true,
            sesMessageId: true,
            createdAt: true,
            deliveredAt: true,
            openedAt: true,
            bouncedAt: true,
          },
        }),
        fastify.prisma.emailLog.count({
          where: {
            userId: request.user.sub,
            ...(status ? { status: status as never } : {}),
          },
        }),
      ])

      return ok(reply, {
        emails,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      })
    },
  )

  // ── Get Single Email ────────────────────────────────────────────────────────
  fastify.get(
    '/emails/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const email = await fastify.prisma.emailLog.findUnique({ where: { id } })
      if (!email) throw new NotFoundError('Email')
      if (email.userId !== request.user.sub) throw new ForbiddenError()

      return ok(reply, { email })
    },
  )
}
