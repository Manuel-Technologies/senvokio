// ─── SES Webhook Route ────────────────────────────────────────────────────────
// POST /webhooks/ses
//
// AWS SNS delivers SES event notifications here (bounces, complaints, delivery,
// opens, clicks). SNS sends a SubscriptionConfirmation on first setup — we
// auto-confirm it. Subsequent messages are Notification type.
//
// Setup: Create an SNS topic, subscribe this endpoint, and attach the topic
// to each tenant's SES Configuration Set (done automatically in domainService).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../config/env'

// ─── SNS Envelope Schema ─────────────────────────────────────────────────────
const snsEnvelopeSchema = z.object({
  Type: z.enum(['SubscriptionConfirmation', 'Notification', 'UnsubscribeConfirmation']),
  MessageId: z.string().min(1),
  TopicArn: z.string().min(1),
  Message: z.string(),
  SubscribeURL: z.string().url().optional(),
  Timestamp: z.string(),
})

// Status progression order — higher index = more advanced state.
// We only advance status forward, never backward.
const STATUS_PRIORITY: Record<string, number> = {
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  DELIVERED: 3,
  OPENED: 4,
  CLICKED: 5,
  BOUNCED: 10,    // terminal
  COMPLAINED: 10, // terminal
  FAILED: 10,     // terminal
}

export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/webhooks/ses',
    async (request, reply) => {
      // ── Validate SNS envelope ──────────────────────────────────────────────
      const parsed = snsEnvelopeSchema.safeParse(request.body)
      if (!parsed.success) {
        fastify.log.warn({ errors: parsed.error.flatten() }, 'Invalid SNS envelope')
        return reply.status(400).send({ error: 'Invalid SNS payload' })
      }

      const body = parsed.data

      // ── Verify TopicArn matches our configured topic ───────────────────────
      if (env.SES_SNS_TOPIC_ARN && body.TopicArn !== env.SES_SNS_TOPIC_ARN) {
        fastify.log.warn(
          { received: body.TopicArn, expected: env.SES_SNS_TOPIC_ARN },
          'SNS TopicArn mismatch — rejecting',
        )
        return reply.status(403).send({ error: 'Topic ARN mismatch' })
      }

      // ── SNS Subscription Confirmation ──────────────────────────────────────
      if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
        fastify.log.info({ topicArn: body.TopicArn }, 'Confirming SNS subscription')
        // Auto-confirm by fetching the SubscribeURL
        await fetch(body.SubscribeURL)
        return reply.status(200).send({ confirmed: true })
      }

      // ── SES Event Notification ─────────────────────────────────────────────
      if (body.Type === 'Notification') {
        let sesEvent
        try {
          sesEvent = JSON.parse(body.Message)
        } catch {
          fastify.log.warn('Failed to parse SNS message body')
          return reply.status(200).send({ ok: true })
        }

        await handleSesEvent(fastify, sesEvent)
      }

      return reply.status(200).send({ ok: true })
    },
  )
}

async function handleSesEvent(fastify: FastifyInstance, event: Record<string, unknown>) {
  const notificationType = event.notificationType as string
  const mail = event.mail as { messageId?: string; destination?: string[] } | undefined
  const messageId = mail?.messageId

  if (!messageId) return

  fastify.log.info({ notificationType, messageId }, 'SES event received')

  try {
    switch (notificationType) {
      case 'Delivery': {
        await advanceStatus(fastify, messageId, 'DELIVERED', { deliveredAt: new Date() })
        break
      }

      case 'Bounce': {
        const bounce = event.bounce as {
          bounceType?: string
          bouncedRecipients?: Array<{ emailAddress: string }>
        } | undefined

        // Add bounced addresses to suppression list
        const bounced = bounce?.bouncedRecipients ?? []
        for (const recipient of bounced) {
          await fastify.prisma.suppressionEntry
            .upsert({
              where: { email: recipient.emailAddress },
              create: { email: recipient.emailAddress, reason: 'BOUNCE' },
              update: {},
            })
            .catch((err) => fastify.log.error({ err, email: recipient.emailAddress }, 'Failed to upsert suppression entry'))
        }

        await advanceStatus(fastify, messageId, 'BOUNCED', { bouncedAt: new Date() })
        break
      }

      case 'Complaint': {
        const complaint = event.complaint as {
          complainedRecipients?: Array<{ emailAddress: string }>
        } | undefined

        // Add complained addresses to suppression list
        const complained = complaint?.complainedRecipients ?? []
        for (const recipient of complained) {
          await fastify.prisma.suppressionEntry
            .upsert({
              where: { email: recipient.emailAddress },
              create: { email: recipient.emailAddress, reason: 'COMPLAINT' },
              update: {},
            })
            .catch((err) => fastify.log.error({ err, email: recipient.emailAddress }, 'Failed to upsert suppression entry'))
        }

        await advanceStatus(fastify, messageId, 'COMPLAINED', { complainedAt: new Date() })
        break
      }

      case 'Open': {
        // Set openedAt timestamp but only advance status if not already at a higher level
        await advanceStatus(fastify, messageId, 'OPENED', { openedAt: new Date() })
        break
      }

      case 'Click': {
        await advanceStatus(fastify, messageId, 'CLICKED', { clickedAt: new Date() })
        break
      }

      default:
        fastify.log.info({ notificationType }, 'Unhandled SES event type')
    }
  } catch (err) {
    fastify.log.error({ err, messageId, notificationType }, 'Error processing SES event')
  }
}

/**
 * Only advance the email status forward — never overwrite a more-advanced status.
 * Always set the event-specific timestamp field regardless.
 */
async function advanceStatus(
  fastify: FastifyInstance,
  sesMessageId: string,
  newStatus: string,
  timestampData: Record<string, Date>,
) {
  const existing = await fastify.prisma.emailLog.findFirst({
    where: { sesMessageId },
    select: { id: true, status: true },
  })

  if (!existing) return

  const currentPriority = STATUS_PRIORITY[existing.status] ?? 0
  const newPriority = STATUS_PRIORITY[newStatus] ?? 0

  // Always set timestamp fields (e.g. openedAt, clickedAt) even if status doesn't advance
  const updateData: Record<string, unknown> = { ...timestampData }

  // Only advance the status enum if the new status is higher priority
  if (newPriority > currentPriority) {
    updateData.status = newStatus
  }

  await fastify.prisma.emailLog.update({
    where: { id: existing.id },
    data: updateData,
  })
}
