// ─── Email Worker ─────────────────────────────────────────────────────────────
// BullMQ worker that processes the "email-sending" queue.
// Run this as a separate process: `npm run worker`
// In production, run multiple instances behind a process manager (PM2, ECS tasks).

import 'dotenv/config'
import { Worker, type Job } from 'bullmq'
import Redis from 'ioredis'
import { SendEmailCommand, type MessageTag } from '@aws-sdk/client-sesv2'
import { PrismaClient } from '@prisma/client'
import pino from 'pino'
import { sesClient } from '../config/aws'
import { env } from '../config/env'
import { QUEUE_NAME } from '../services/emailQueue'
import type { EmailJobData } from '../types'

const log = pino({ level: 'info' })
const prisma = new PrismaClient()

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

// ─── Worker ───────────────────────────────────────────────────────────────────

const worker = new Worker<EmailJobData>(
  QUEUE_NAME,
  async (job: Job<EmailJobData>) => {
    const { emailLogId, from, to, subject, html, text, configSetName, tags, replyTo } = job.data

    log.info({ jobId: job.id, emailLogId, to }, 'Processing email job')

    // Mark as SENDING
    await prisma.emailLog.update({
      where: { id: emailLogId },
      data: { status: 'SENDING' },
    })

    // Build SES message tags
    const messageTags: MessageTag[] = tags
      ? Object.entries(tags).map(([Name, Value]) => ({ Name, Value }))
      : []

    // Send via SES
    const command = new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: to },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
            ...(text ? { Text: { Data: text, Charset: 'UTF-8' } } : {}),
          },
        },
      },
      ConfigurationSetName: configSetName,
      EmailTags: messageTags,
      ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
    })

    const result = await sesClient.send(command)
    const sesMessageId = result.MessageId

    log.info({ jobId: job.id, emailLogId, sesMessageId }, 'Email sent via SES')

    // Mark as SENT and store SES message ID
    await prisma.emailLog.update({
      where: { id: emailLogId },
      data: { status: 'SENT', sesMessageId },
    })
  },
  {
    connection,
    concurrency: 10, // Respect SES sending rate; increase after warm-up
    limiter: {
      max: 14,    // SES default: 14 emails/sec in sandbox; 200/sec in production
      duration: 1000,
    },
  },
)

// ─── Event Handlers ───────────────────────────────────────────────────────────

worker.on('completed', (job) => {
  log.info({ jobId: job.id }, 'Job completed')
})

worker.on('failed', async (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, 'Job failed')

  if (job?.data.emailLogId) {
    const isFinalAttempt = (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 5)
    if (isFinalAttempt) {
      await prisma.emailLog
        .update({
          where: { id: job.data.emailLogId },
          data: { status: 'FAILED', errorMessage: err.message },
        })
        .catch(() => {})
    }
  }
})

worker.on('error', (err) => {
  log.error({ err }, 'Worker error')
})

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown() {
  log.info('Shutting down worker...')
  await worker.close()
  await prisma.$disconnect()
  await connection.quit()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

log.info(`🚀 Email worker started — listening on queue: ${QUEUE_NAME}`)
