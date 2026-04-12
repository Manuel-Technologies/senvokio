// ─── Standardised API Response Helpers ───────────────────────────────────────

import type { FastifyReply } from 'fastify'
import type { ApiSuccess, ApiError } from '../types'

export function ok<T>(reply: FastifyReply, data: T, statusCode = 200): FastifyReply {
  const body: ApiSuccess<T> = { success: true, data }
  return reply.status(statusCode).send(body)
}

export function created<T>(reply: FastifyReply, data: T): FastifyReply {
  return ok(reply, data, 201)
}

export function fail(
  reply: FastifyReply,
  code: string,
  message: string,
  statusCode = 400,
  details?: unknown,
): FastifyReply {
  const body: ApiError = { success: false, error: { code, message, details } }
  return reply.status(statusCode).send(body)
}
