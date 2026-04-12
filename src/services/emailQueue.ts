// ─── Email Queue ──────────────────────────────────────────────────────────────
// BullMQ queue for reliable async email sending.
// Enqueues jobs; the worker (src/workers/emailWorker.ts) processes them.

import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { env } from '../config/env'
import type { EmailJobData } from '../types'

export const QUEUE_NAME = 'email-sending'

// Shared Redis connection for the queue (separate from the Fastify plugin instance)
let _queueConnection: Redis | null = null

function getQueueConnection(): Redis {
  if (!_queueConnection) {
    _queueConnection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
  }
  return _queueConnection
}

let _queue: Queue<EmailJobData> | null = null

export function getEmailQueue(): Queue<EmailJobData> {
  if (!_queue) {
    _queue = new Queue<EmailJobData>(QUEUE_NAME, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000, // 2s, 4s, 8s, 16s, 32s
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      },
    })
  }
  return _queue
}

/**
 * Enqueue an email job and return the BullMQ job ID.
 */
export async function enqueueEmail(data: EmailJobData): Promise<string> {
  const queue = getEmailQueue()
  const job = await queue.add('send-email', data, {
    jobId: data.emailLogId, // use emailLogId as jobId for easy lookup
  })
  return job.id ?? data.emailLogId
}
