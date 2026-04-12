// ─── AWS SES v2 Client ────────────────────────────────────────────────────────
// Singleton SES client targeting af-south-1 (Africa — Cape Town) for lowest
// latency to Nigeria and West Africa. Uses IAM role credentials in production;
// falls back to explicit keys for local development.

import { SESv2Client } from '@aws-sdk/client-sesv2'
import { env } from './env'

const clientConfig: ConstructorParameters<typeof SESv2Client>[0] = {
  region: env.AWS_REGION,
}

// In production, prefer IAM roles (EC2 instance profile / ECS task role).
// Only inject explicit credentials when keys are provided (local dev / CI).
if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
  clientConfig.credentials = {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  }
}

export const sesClient = new SESv2Client(clientConfig)
