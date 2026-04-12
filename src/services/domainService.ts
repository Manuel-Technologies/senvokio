// ─── Domain Verification Service ─────────────────────────────────────────────
// Handles SES identity creation, DKIM setup, custom MAIL FROM, and DNS record
// generation. Each tenant gets their own SES Configuration Set for event
// tracking isolation (bounces, complaints, opens per customer).

import {
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  DeleteEmailIdentityCommand,
  DkimSigningAttributesOrigin,
  EventType,
} from '@aws-sdk/client-sesv2'
import { sesClient } from '../config/aws'
import { env } from '../config/env'
import type { PrismaClient } from '@prisma/client'
import type { DnsRecord, DomainVerificationResult } from '../types'
import { ConflictError, SesError, NotFoundError, ForbiddenError } from '../lib/errors'

// ─── Create Domain Identity ───────────────────────────────────────────────────

export async function registerDomain(
  prisma: PrismaClient,
  userId: string,
  domain: string,
  mailFromSubdomain?: string,
): Promise<DomainVerificationResult> {
  // Check for existing domain
  const existing = await prisma.domain.findUnique({ where: { domain } })
  if (existing) {
    if (existing.userId !== userId) {
      throw new ConflictError(`Domain ${domain} is already registered by another account`)
    }
    throw new ConflictError(`Domain ${domain} is already registered`)
  }

  // Derive a unique config set name (SES has a 64-char limit)
  const safeDomain = domain.replace(/\./g, '-').slice(0, 40)
  const configSetName = `snv-${safeDomain}-${Date.now().toString(36)}`

  // 1. Create SES Configuration Set for this tenant
  await createConfigSet(configSetName)

  // 2. Create SES Email Identity (domain) with Easy DKIM
  let dkimTokens: string[] = []
  let sesIdentityArn: string | undefined

  try {
    const createResp = await sesClient.send(
      new CreateEmailIdentityCommand({
        EmailIdentity: domain,
        DkimSigningAttributes: {
          NextSigningKeyLength: 'RSA_2048_BIT',
        },
        ConfigurationSetName: configSetName,
        Tags: [
          { Key: 'senviok:userId', Value: userId },
          { Key: 'senviok:configSet', Value: configSetName },
        ],
      }),
    )

    dkimTokens = createResp.DkimAttributes?.Tokens ?? []
    sesIdentityArn = createResp.IdentityType // SES doesn't return ARN directly on create
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string }
    // AlreadyExistsException — domain already in SES (possibly from another account)
    if (error.name === 'AlreadyExistsException') {
      throw new ConflictError(
        `Domain ${domain} already exists in AWS SES. If you own it, delete it from SES first.`,
      )
    }
    throw new SesError(`Failed to register domain with SES: ${error.message}`, err)
  }

  // 3. Persist to DB
  const mailFrom = mailFromSubdomain ?? `bounce.${domain}`
  const dbDomain = await prisma.domain.create({
    data: {
      userId,
      domain,
      configSetName,
      dkimTokens,
      mailFromSubdomain: mailFrom,
      verificationStatus: 'PENDING',
      dkimStatus: 'PENDING',
      mailFromStatus: 'PENDING',
    },
  })

  // 4. Build DNS records for the user
  const dnsRecords = buildDnsRecords(domain, dkimTokens, mailFrom)

  return {
    domain: dbDomain.domain,
    configSetName,
    dnsRecords,
    instructions: buildInstructions(domain, dnsRecords),
  }
}

// ─── Poll Verification Status ─────────────────────────────────────────────────

export async function refreshDomainStatus(
  prisma: PrismaClient,
  userId: string,
  domain: string,
) {
  const dbDomain = await prisma.domain.findUnique({ where: { domain } })
  if (!dbDomain) throw new NotFoundError('Domain')
  if (dbDomain.userId !== userId) throw new ForbiddenError()

  let sesData
  try {
    sesData = await sesClient.send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string }
    throw new SesError(`Failed to fetch domain status from SES: ${error.message}`, err)
  }

  // Map SES statuses to our enums
  const dkimStatus = mapDkimStatus(sesData.DkimAttributes?.Status)
  const mailFromStatus = mapMailFromStatus(sesData.MailFromAttributes?.MailFromDomainStatus)
  const verificationStatus =
    sesData.VerifiedForSendingStatus === true ? 'VERIFIED' : 'PENDING'

  const updated = await prisma.domain.update({
    where: { domain },
    data: {
      dkimStatus,
      mailFromStatus,
      verificationStatus,
      verifiedAt: verificationStatus === 'VERIFIED' ? new Date() : undefined,
    },
  })

  const dnsRecords = buildDnsRecords(domain, updated.dkimTokens, updated.mailFromSubdomain ?? `bounce.${domain}`)

  return {
    domain: updated.domain,
    verificationStatus: updated.verificationStatus,
    dkimStatus: updated.dkimStatus,
    mailFromStatus: updated.mailFromStatus,
    verifiedAt: updated.verifiedAt,
    dnsRecords,
    readyToSend: verificationStatus === 'VERIFIED' && dkimStatus === 'SUCCESS',
  }
}

// ─── Delete Domain ────────────────────────────────────────────────────────────

export async function removeDomain(prisma: PrismaClient, userId: string, domain: string) {
  const dbDomain = await prisma.domain.findUnique({ where: { domain } })
  if (!dbDomain) throw new NotFoundError('Domain')
  if (dbDomain.userId !== userId) throw new ForbiddenError()

  // Remove from SES
  try {
    await sesClient.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain }))
  } catch {
    // Log but don't fail — DB cleanup is more important
  }

  await prisma.domain.delete({ where: { domain } })
  return { deleted: true }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createConfigSet(configSetName: string) {
  try {
    await sesClient.send(
      new CreateConfigurationSetCommand({ ConfigurationSetName: configSetName }),
    )

    // Attach SNS event destination if topic ARN is configured
    if (env.SES_SNS_TOPIC_ARN) {
      await sesClient.send(
        new CreateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: configSetName,
          EventDestinationName: 'senviok-sns',
          EventDestination: {
            Enabled: true,
            MatchingEventTypes: [
              EventType.SEND,
              EventType.DELIVERY,
              EventType.BOUNCE,
              EventType.COMPLAINT,
              EventType.OPEN,
              EventType.CLICK,
            ] as EventType[],
            SnsDestination: { TopicArn: env.SES_SNS_TOPIC_ARN },
          },
        }),
      )
    }
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string }
    if (error.name !== 'AlreadyExistsException') {
      throw new SesError(`Failed to create SES config set: ${error.message}`, err)
    }
  }
}

function buildDnsRecords(domain: string, dkimTokens: string[], mailFromSubdomain: string): DnsRecord[] {
  const records: DnsRecord[] = []

  // DKIM CNAME records (Easy DKIM — 3 tokens)
  for (const token of dkimTokens) {
    records.push({
      type: 'CNAME',
      name: `${token}._domainkey.${domain}`,
      value: `${token}.dkim.amazonses.com`,
      ttl: 1800,
      purpose: 'DKIM signing — proves emails are authentic',
    })
  }

  // Custom MAIL FROM — MX record
  records.push({
    type: 'MX',
    name: mailFromSubdomain,
    value: `feedback-smtp.${env.AWS_REGION}.amazonses.com`,
    ttl: 300,
    purpose: 'Custom MAIL FROM — improves deliverability & bounce handling',
  })

  // Custom MAIL FROM — SPF TXT record
  records.push({
    type: 'TXT',
    name: mailFromSubdomain,
    value: 'v=spf1 include:amazonses.com ~all',
    ttl: 300,
    purpose: 'SPF record — authorises Amazon SES to send on your behalf',
  })

  // DMARC recommendation (user must add this themselves)
  records.push({
    type: 'TXT',
    name: `_dmarc.${domain}`,
    value: 'v=DMARC1; p=none; rua=mailto:dmarc@' + domain,
    ttl: 300,
    purpose: 'DMARC policy — start with p=none, move to p=quarantine then p=reject',
  })

  return records
}

function buildInstructions(domain: string, records: DnsRecord[]): string {
  return `
Add the following DNS records to ${domain} to verify your domain and enable sending.

IMPORTANT:
- DKIM CNAMEs are required for email authentication. Add all 3.
- The MAIL FROM MX + SPF records improve deliverability significantly.
- DMARC is strongly recommended. Start with p=none to monitor, then tighten.
- DNS propagation can take up to 72 hours (usually < 30 min for most Nigerian registrars).
- After adding records, call GET /domains/${domain}/status to check verification.

Records to add:
${records.map((r) => `  [${r.type}] ${r.name} → ${r.value} (TTL: ${r.ttl}s)\n  Purpose: ${r.purpose}`).join('\n\n')}
`.trim()
}

function mapDkimStatus(status?: string): 'PENDING' | 'SUCCESS' | 'FAILED' | 'TEMPORARY_FAILURE' | 'NOT_STARTED' {
  switch (status) {
    case 'SUCCESS': return 'SUCCESS'
    case 'FAILED': return 'FAILED'
    case 'TEMPORARY_FAILURE': return 'TEMPORARY_FAILURE'
    case 'NOT_STARTED': return 'NOT_STARTED'
    default: return 'PENDING'
  }
}

function mapMailFromStatus(status?: string): 'PENDING' | 'SUCCESS' | 'FAILED' | 'TEMPORARY_FAILURE' | 'NOT_STARTED' {
  switch (status) {
    case 'SUCCESS': return 'SUCCESS'
    case 'FAILED': return 'FAILED'
    case 'TEMPORARY_FAILURE': return 'TEMPORARY_FAILURE'
    case 'NOT_STARTED': return 'NOT_STARTED'
    default: return 'PENDING'
  }
}
