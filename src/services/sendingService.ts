// ─── Email Sending Service ────────────────────────────────────────────────────
// Validates send requests, checks domain ownership, renders templates,
// creates an EmailLog record, and enqueues the job.

import type { PrismaClient } from '@prisma/client'
import { renderTemplate } from '../lib/templateRenderer'
import { enqueueEmail } from './emailQueue'
import { AppError, NotFoundError, ForbiddenError, ValidationError } from '../lib/errors'
import type { SendEmailPayload, SendEmailResult } from '../types'

export async function sendEmail(
  prisma: PrismaClient,
  userId: string,
  payload: SendEmailPayload,
): Promise<SendEmailResult> {
  const { from, to, subject, html, text, templateId, variables, tags, replyTo } = payload

  // Normalise recipients
  const toAddresses = Array.isArray(to) ? to : [to]

  // ── Validate sender domain ────────────────────────────────────────────────
  const fromDomain = extractDomain(from)
  const domain = await prisma.domain.findFirst({
    where: { domain: fromDomain, userId },
  })

  if (!domain) {
    throw new ForbiddenError(
      `Sending domain "${fromDomain}" is not registered. Add it via POST /domains first.`,
    )
  }

  if (domain.verificationStatus !== 'VERIFIED') {
    throw new AppError(
      'DOMAIN_NOT_VERIFIED',
      `Domain "${fromDomain}" is not yet verified. Check DNS records and poll GET /domains/${fromDomain}/status.`,
      422,
    )
  }

  // ── Suppression list check ────────────────────────────────────────────────
  const suppressed = await prisma.suppressionEntry.findMany({
    where: { email: { in: toAddresses } },
  })
  if (suppressed.length > 0) {
    const emails = suppressed.map((s) => s.email).join(', ')
    throw new ValidationError(
      `The following addresses are on the suppression list: ${emails}`,
      { suppressed: suppressed.map((s) => ({ email: s.email, reason: s.reason })) },
    )
  }

  // ── Resolve template ──────────────────────────────────────────────────────
  let resolvedHtml = html
  let resolvedText = text
  let resolvedSubject = subject
  let templateDbId: string | undefined

  if (templateId) {
    const template = await prisma.template.findFirst({
      where: { id: templateId, userId },
    })
    if (!template) throw new NotFoundError('Template')

    const vars = variables ?? {}
    const rendered = renderTemplate(template.htmlBody, vars)
    resolvedHtml = rendered.html
    resolvedText = template.textBody ? renderTemplate(template.textBody, vars).html : undefined
    resolvedSubject = template.subject.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)
    templateDbId = template.id
  }

  if (!resolvedHtml && !resolvedText) {
    throw new ValidationError('Either html, text, or templateId must be provided')
  }

  // ── Create EmailLog ───────────────────────────────────────────────────────
  const emailLog = await prisma.emailLog.create({
    data: {
      userId,
      domainId: domain.id,
      templateId: templateDbId,
      fromAddress: from,
      toAddresses,
      subject: resolvedSubject,
      configSetName: domain.configSetName,
      status: 'QUEUED',
      tags: tags ?? {},
    },
  })

  // ── Enqueue ───────────────────────────────────────────────────────────────
  const jobId = await enqueueEmail({
    emailLogId: emailLog.id,
    userId,
    from,
    to: toAddresses,
    subject: resolvedSubject,
    html: resolvedHtml,
    text: resolvedText,
    configSetName: domain.configSetName,
    tags,
    replyTo,
  })

  // Update log with jobId
  await prisma.emailLog.update({
    where: { id: emailLog.id },
    data: { jobId },
  })

  return {
    id: emailLog.id,
    jobId,
    status: 'queued',
    message: 'Email queued for delivery',
  }
}

function extractDomain(email: string): string {
  const parts = email.split('@')
  if (parts.length !== 2 || !parts[1]) {
    throw new ValidationError(`Invalid from address: ${email}`)
  }
  return parts[1]
}
