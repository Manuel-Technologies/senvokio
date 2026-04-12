// ─── Template Routes ──────────────────────────────────────────────────────────
// POST   /templates          — create template
// GET    /templates          — list templates
// GET    /templates/:id      — get template
// PUT    /templates/:id      — update template
// DELETE /templates/:id      — delete template
// POST   /templates/:id/preview — render preview

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { renderTemplate } from '../lib/templateRenderer'
import { ok, created, fail } from '../lib/response'
import { NotFoundError, ForbiddenError } from '../lib/errors'

const templateSchema = z.object({
  name: z.string().min(1).max(128),
  subject: z.string().min(1).max(998),
  htmlBody: z.string().min(1),
  textBody: z.string().optional(),
  variables: z.array(z.string()).default([]),
})

const previewSchema = z.object({
  variables: z.record(z.string()).default({}),
})

export async function templateRoutes(fastify: FastifyInstance) {
  // ── Create Template ─────────────────────────────────────────────────────────
  fastify.post(
    '/templates',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const body = templateSchema.safeParse(request.body)
      if (!body.success) return fail(reply, 'VALIDATION_ERROR', 'Invalid input', 422, body.error.flatten())

      const template = await fastify.prisma.template.create({
        data: { ...body.data, userId: request.user.sub },
      })

      return created(reply, { template })
    },
  )

  // ── List Templates ──────────────────────────────────────────────────────────
  fastify.get(
    '/templates',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const templates = await fastify.prisma.template.findMany({
        where: { userId: request.user.sub },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, subject: true, variables: true, createdAt: true, updatedAt: true },
      })
      return ok(reply, { templates })
    },
  )

  // ── Get Template ────────────────────────────────────────────────────────────
  fastify.get(
    '/templates/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const template = await fastify.prisma.template.findUnique({ where: { id } })
      if (!template) throw new NotFoundError('Template')
      if (template.userId !== request.user.sub) throw new ForbiddenError()
      return ok(reply, { template })
    },
  )

  // ── Update Template ─────────────────────────────────────────────────────────
  fastify.put(
    '/templates/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = templateSchema.partial().safeParse(request.body)
      if (!body.success) return fail(reply, 'VALIDATION_ERROR', 'Invalid input', 422, body.error.flatten())

      const existing = await fastify.prisma.template.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError('Template')
      if (existing.userId !== request.user.sub) throw new ForbiddenError()

      const template = await fastify.prisma.template.update({
        where: { id },
        data: body.data,
      })

      return ok(reply, { template })
    },
  )

  // ── Delete Template ─────────────────────────────────────────────────────────
  fastify.delete(
    '/templates/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const existing = await fastify.prisma.template.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError('Template')
      if (existing.userId !== request.user.sub) throw new ForbiddenError()

      await fastify.prisma.template.delete({ where: { id } })
      return ok(reply, { deleted: true })
    },
  )

  // ── Preview Template ────────────────────────────────────────────────────────
  fastify.post(
    '/templates/:id/preview',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = previewSchema.safeParse(request.body)
      if (!body.success) return fail(reply, 'VALIDATION_ERROR', 'Invalid input', 422, body.error.flatten())

      const template = await fastify.prisma.template.findUnique({ where: { id } })
      if (!template) throw new NotFoundError('Template')
      if (template.userId !== request.user.sub) throw new ForbiddenError()

      const { html, errors } = renderTemplate(template.htmlBody, body.data.variables)

      return ok(reply, { html, errors })
    },
  )
}
