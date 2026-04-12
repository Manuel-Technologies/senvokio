# Senviok

> Developer-friendly email infrastructure for African startups — powered by AWS SES (af-south-1).

Senviok is a self-hosted, production-ready email sending API inspired by Resend and Postmark, built specifically for Nigerian and African developers. Send transactional emails, OTPs, and notifications with excellent deliverability, low latency, and a clean REST API.

---

## Why Senviok?

- **Low latency to Nigeria** — AWS SES `af-south-1` (Cape Town) is the closest SES region to West Africa
- **Deliverability-first** — Easy DKIM, custom MAIL FROM, SPF, DMARC guidance baked in
- **Multi-tenant** — Every user brings their own domain; isolated config sets per tenant
- **Developer-friendly** — Clean JSON API, async sending, reusable templates, webhooks
- **Affordable** — SES costs ~$0.10/1,000 emails. No per-seat pricing.

---

## Quick Start

### 1. Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- AWS account with SES access in `af-south-1`

### 2. Clone & Install

```bash
git clone https://github.com/yourorg/senviok
cd senviok
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/senviok"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-32-char-minimum-secret-here"
AWS_ACCESS_KEY_ID="AKIA..."
AWS_SECRET_ACCESS_KEY="..."
AWS_REGION="af-south-1"
```

### 4. Database Setup

```bash
npm run db:generate   # generate Prisma client
npm run db:migrate    # run migrations
```

### 5. Start the API

```bash
# Terminal 1 — API server
npm run dev

# Terminal 2 — Email worker (required for sending)
npm run worker
```

API is live at `http://localhost:3000`
Swagger docs at `http://localhost:3000/docs`

---

## Sending Your First Email

### Step 1 — Register an account

```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "securepassword", "name": "Your Name"}'
```

Response:
```json
{
  "success": true,
  "data": {
    "token": "eyJ...",
    "user": { "id": "...", "email": "you@example.com" }
  }
}
```

### Step 2 — Add your domain

```bash
curl -X POST http://localhost:3000/v1/domains \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"domain": "mail.yourcompany.ng"}'
```

Response includes DNS records to add:
```json
{
  "success": true,
  "data": {
    "domain": "mail.yourcompany.ng",
    "dnsRecords": [
      {
        "type": "CNAME",
        "name": "abc123._domainkey.mail.yourcompany.ng",
        "value": "abc123.dkim.amazonses.com",
        "purpose": "DKIM signing"
      },
      ...
    ],
    "instructions": "Add the following DNS records..."
  }
}
```

### Step 3 — Add DNS records

Add all returned DNS records to your domain registrar (Namecheap, GoDaddy, Qservers, etc.).

**Records to add:**
| Type | Name | Value |
|------|------|-------|
| CNAME | `token1._domainkey.mail.yourcompany.ng` | `token1.dkim.amazonses.com` |
| CNAME | `token2._domainkey.mail.yourcompany.ng` | `token2.dkim.amazonses.com` |
| CNAME | `token3._domainkey.mail.yourcompany.ng` | `token3.dkim.amazonses.com` |
| MX | `bounce.mail.yourcompany.ng` | `feedback-smtp.af-south-1.amazonses.com` |
| TXT | `bounce.mail.yourcompany.ng` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc.mail.yourcompany.ng` | `v=DMARC1; p=none; rua=mailto:dmarc@yourcompany.ng` |

### Step 4 — Check verification status

```bash
curl http://localhost:3000/v1/domains/mail.yourcompany.ng/status \
  -H "Authorization: Bearer eyJ..."
```

Wait for `"verificationStatus": "VERIFIED"` and `"dkimStatus": "SUCCESS"`. This usually takes 5–30 minutes after DNS propagation.

### Step 5 — Send an email

```bash
curl -X POST http://localhost:3000/v1/emails \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "hello@mail.yourcompany.ng",
    "to": "customer@gmail.com",
    "subject": "Welcome to our platform!",
    "html": "<h1>Welcome!</h1><p>Thanks for signing up.</p>"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "email-log-uuid",
    "jobId": "bullmq-job-id",
    "status": "queued",
    "message": "Email queued for delivery"
  }
}
```

---

## API Keys

For production use, create an API key instead of using JWT tokens:

```bash
curl -X POST http://localhost:3000/v1/auth/api-keys \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"name": "Production"}'
```

Use the returned key as `Authorization: Bearer snv_live_...` in all requests.

---

## Templates

Create reusable MJML or HTML templates with `{{variable}}` placeholders:

```bash
curl -X POST http://localhost:3000/v1/templates \
  -H "Authorization: Bearer snv_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "otp-email",
    "subject": "Your OTP is {{otp}}",
    "variables": ["name", "otp", "expiresIn"],
    "htmlBody": "<mjml>...</mjml>"
  }'
```

Send using a template:

```bash
curl -X POST http://localhost:3000/v1/emails \
  -H "Authorization: Bearer snv_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "otp@mail.yourcompany.ng",
    "to": "user@example.com",
    "subject": "Your OTP",
    "templateId": "template-uuid",
    "variables": { "name": "Chidi", "otp": "847291", "expiresIn": "10 minutes" }
  }'
```

---

## Webhooks (SES Events)

Senviok automatically handles bounce, complaint, delivery, open, and click events from SES via SNS.

### Setup

1. Create an SNS topic in AWS Console
2. Subscribe `https://yourapi.com/v1/webhooks/ses` to the topic (HTTP/HTTPS)
3. Set `SES_SNS_TOPIC_ARN` in your `.env`
4. Senviok auto-confirms the subscription and processes events

Events update the `EmailLog` status in real-time and add bounced/complained addresses to the suppression list automatically.

---

## Deliverability Checklist

Before going to production, verify:

- [ ] DKIM CNAMEs added and verified (`dkimStatus: SUCCESS`)
- [ ] Custom MAIL FROM MX record added (`mailFromStatus: SUCCESS`)
- [ ] SPF TXT record on MAIL FROM subdomain
- [ ] DMARC TXT record added (start with `p=none`)
- [ ] SES sandbox mode lifted (request production access in AWS Console)
- [ ] Sending quota increased (default sandbox: 200/day, 1/sec)
- [ ] SNS topic configured for bounce/complaint notifications
- [ ] Suppression list handling active (automatic via webhooks)
- [ ] Gradual warm-up plan in place (see below)

### Requesting SES Production Access

1. Go to AWS Console → SES → Account Dashboard
2. Click "Request production access"
3. Fill in use case (transactional emails, OTPs)
4. Mention: Nigerian/African market, low complaint rates, opt-in users
5. Approval usually takes 24–48 hours

### IP Warm-Up Schedule

Start slow to build sender reputation:

| Week | Daily Volume |
|------|-------------|
| 1 | 200 |
| 2 | 500 |
| 3 | 1,000 |
| 4 | 5,000 |
| 5+ | Scale as needed |

---

## NDPR Compliance Notes (Nigeria)

The Nigeria Data Protection Regulation (NDPR) applies to personal data of Nigerian residents:

- Only send to users who have explicitly opted in
- Include an unsubscribe link in all marketing emails
- Store minimal PII — Senviok only stores email addresses and send metadata
- Implement data retention policies (delete old logs after 90 days)
- Document your lawful basis for processing (consent for marketing, legitimate interest for transactional)

---

## Architecture

```
Client → Fastify API → BullMQ Queue → Email Worker → AWS SES (af-south-1)
                ↓                                           ↓
           PostgreSQL                              SNS → /webhooks/ses
```

- **API** handles auth, validation, domain management, and queuing
- **Worker** is a separate process that dequeues and calls SES (scale independently)
- **Webhooks** receive SES events (bounces, opens) and update the DB

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `JWT_SECRET` | ✅ | Min 32 chars, used to sign JWTs |
| `AWS_ACCESS_KEY_ID` | Dev only | Use IAM roles in production |
| `AWS_SECRET_ACCESS_KEY` | Dev only | Use IAM roles in production |
| `AWS_REGION` | ✅ | Default: `af-south-1` |
| `SES_SNS_TOPIC_ARN` | Recommended | For bounce/complaint webhooks |
| `PORT` | No | Default: `3000` |

---

## Production Deployment

### Docker (recommended)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY prisma ./prisma
RUN npx prisma generate
CMD ["node", "dist/server.js"]
```

Run the worker as a separate container/service with `CMD ["node", "dist/workers/emailWorker.js"]`.

### AWS ECS / Fargate

- API service: 1–N tasks, behind ALB
- Worker service: 1–N tasks, scale based on queue depth (CloudWatch metric)
- Use ECS Task Role instead of access keys
- RDS PostgreSQL + ElastiCache Redis

---

## Roadmap

- [ ] **SMS via Africa's Talking** — Nigerian SMS gateway integration
- [ ] **Next.js Dashboard** — visual domain management, analytics, template editor
- [ ] **JavaScript/TypeScript SDK** — `npm install senviok` client
- [ ] **Dedicated IPs** — for high-volume senders needing reputation isolation
- [ ] **Email campaigns** — bulk sending with list management
- [ ] **Inbound email** — receive and parse emails via SES receipt rules
- [ ] **Self-hosted SMTP** — Postfix/Haraka fallback for SES outages
- [ ] **NGN pricing** — local currency billing for Nigerian customers
- [ ] **Webhooks v2** — user-defined webhook endpoints per event type
- [ ] **Multi-region** — eu-west-1 fallback for European customers

---

## License

MIT
