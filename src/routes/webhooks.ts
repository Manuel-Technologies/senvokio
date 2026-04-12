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
import pino from 'pino'

const log = pino({ level: 'info' })

interface SnsEnvelope {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation'
  MessageId: string
  TopicArn: string
  Message: string
  SubscribeURL?: string
  Timestamp: string
}

export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/webhooks/ses',
    {
      config: { rawBody: true }, // needed for signature verification
    },
    async (request, reply) => {
      const body = request.body as SnsEnvelope

      // ── SNS Subscription Confirmation ──────────────────────────────────────
      if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
        log.info({ topicArn: body.TopicArn }, 'Confirming SNS subscription')
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
          log.warn('Failed to parse SNS message body')
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

  log.info({ notificationType, messageId }, 'SES event received')

  try {
    switch (notificationType) {
      case 'Delivery': {
        await fastify.prisma.emailLog.updateMany({
          where: { sesMessageId: messageId },
          data: { status: 'DELIVERED', deliveredAt: new Date() },
        })
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
            .catch(() => {})
        }

        await fastify.prisma.emailLog.updateMany({
          where: { sesMessageId: messageId },
          data: { status: 'BOUNCED', bouncedAt: new Date() },
        })
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
            .catch(() => {})
        }

        await fastify.prisma.emailLog.updateMany({
          where: { sesMessageId: messageId },
          data: { status: 'COMPLAINED', complainedAt: new Date() },
        })
        break
      }

      case 'Open': {
        await fastify.prisma.emailLog.updateMany({
          where: { sesMessageId: messageId },
          data: { status: 'OPENED', openedAt: new Date() },
        })
        break
      }

      case 'Click': {
        await fastify.prisma.emailLog.updateMany({
          where: { sesMessageId: messageId },
          data: { status: 'CLICKED', clickedAt: new Date() },
        })
        break
      }

      default:
        log.info({ notificationType }, 'Unhandled SES event type')
    }
  } catch (err) {
    log.error({ err, messageId, notificationType }, 'Error processing SES event')
  }
}
