// ─── Senviok — Shared TypeScript Types ────────────────────────────────────────

import type { FastifyRequest } from 'fastify'

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string   // userId
  email: string
  iat?: number
  exp?: number
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: JwtPayload
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ApiSuccess<T = unknown> {
  success: true
  data: T
}

export interface ApiError {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError

// ─── Domain ───────────────────────────────────────────────────────────────────

export interface DnsRecord {
  type: 'CNAME' | 'TXT' | 'MX'
  name: string
  value: string
  ttl: number
  purpose: string
}

export interface DomainVerificationResult {
  domain: string
  configSetName: string
  dnsRecords: DnsRecord[]
  instructions: string
}

// ─── Email Sending ────────────────────────────────────────────────────────────

export interface SendEmailPayload {
  from: string
  to: string | string[]
  subject: string
  html?: string
  text?: string
  templateId?: string
  variables?: Record<string, string>
  tags?: Record<string, string>
  replyTo?: string
}

export interface SendEmailResult {
  id: string          // EmailLog ID
  jobId: string       // BullMQ job ID
  status: 'queued'
  message: string
}

// ─── Queue Jobs ───────────────────────────────────────────────────────────────

export interface EmailJobData {
  emailLogId: string
  userId: string
  from: string
  to: string[]
  subject: string
  html?: string
  text?: string
  configSetName: string
  tags?: Record<string, string>
  replyTo?: string
}

// ─── SES Events (SNS Webhook) ─────────────────────────────────────────────────

export interface SesNotificationMessage {
  notificationType: 'Bounce' | 'Complaint' | 'Delivery' | 'Open' | 'Click'
  mail: {
    messageId: string
    timestamp: string
    source: string
    destination: string[]
  }
  bounce?: {
    bounceType: string
    bounceSubType: string
    bouncedRecipients: Array<{ emailAddress: string }>
  }
  complaint?: {
    complainedRecipients: Array<{ emailAddress: string }>
  }
  delivery?: {
    timestamp: string
    recipients: string[]
  }
  open?: {
    timestamp: string
    ipAddress: string
  }
  click?: {
    timestamp: string
    link: string
  }
}
